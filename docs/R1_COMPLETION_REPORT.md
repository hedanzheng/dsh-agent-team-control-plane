# R1 完成报告

## 环境

```text
Branch: main
Base HEAD: 35241d1bec2fef339468de39f174ffc41cad9305（R0 验收基线，未提交任何 Git commit）
Package: @local/agent-team-control-plane@0.5.7
DeepSeek Harness Desktop: 0.2.1-rc.2
Host Node: 24.21.0
OS: Windows NT 10.0.26200.0
```

R0 全部 7 个交付物原样保留，未执行 `git clean`。R1 改动全部为未提交工作区变更，等待 Human 验收后再决定提交方式。

## 修改范围

### R1.1 HTTP Human 身份边界（封堵 S-01）

- `src/host/http-router.js`（**新增**）：全部 Panel HTTP 业务分发从 `index.js` 迁出至独立路由层，作为身份边界的唯一入口。
  - Host `connection` 服务加入依赖注入（`src/host/index.js` 的 `inject` 新增 `'connection'`）。
  - GET 与 POST 都必须先通过 `connection.admit(request)` 认证，再读取 snapshot/body；认证失败返回 `401 UNAUTHENTICATED`，非 owner principal 返回 `403 FORBIDDEN`。
  - Human 权威**只**来自认证 owner `Peer`（单本地 Owner 模型：`ownerIdentity(peer)`）。HTTP body 中的 `actor` 不再具有认证作用，只能在目标项目记录内选择角色并被强制 clamp：
    - 缺省 / `human` → clamp 到 `project.ownerId`；
    - `pl` → 声明 ID 必须等于 `project.leadAgentId`，否则 403；
    - `agent` → 必须是该项目成员，否则 403。
  - `cancel-task-run` 经 `runScopedActor`（runId → task → project）解析后再 clamp，防止跨项目 run 伪造。
  - 全局动作（`rescan-runtimes` / `authorize-runtime` / `create-project`）一律使用认证 Peer 身份，忽略 body actor；`create-project` 强制 `ownerId = 认证 Peer ID`。
  - POST 强制 `Content-Type: application/json`（415）。
  - **Fail closed**：Host 无 `connection` 服务时，POST 全部返回 `503 AUTH_UNAVAILABLE`（Panel 只读），GET 保留只读 snapshot。
  - localhost 回环不作为身份替代。
- `src/host/index.js`：移除内联 dispatcher 与旧 `sendJson/readJson/errorPayload`，改为装配 `createControlPlaneHttpHandler`。

### R1.2 PL Tool 与 Project/Session 绑定（封堵 S-03）

- `src/host/pl-bridge.js`：
  - 新增 `authorizePlSession()`：每次 `agent_team_*` 调用前校验——`exec.agent` 存在（`PL_AGENT_REQUIRED`）→ 属于活跃 Host Agent registry（`PL_AGENT_NOT_LIVE`）→ 项目已绑定 PL Session（`PL_SESSION_NOT_BOUND`）→ `exec.agent.id === project.plSessionId`（`PL_SESSION_MISMATCH`）→ PL 记录仍为在任 PROJECT_LEAD（`PL_AGENT_REPLACED`）。授权失败发生在任何 parent binding 或业务副作用之前。
  - 7 个工具全部挂接 `services` 并在 `projectTool` wrapper 中先行授权。
- `src/host/control-plane.js`：
  - 新增 `bindProjectPlSession(input)`：Human-only，建立 `Project ↔ PL Session` 持久绑定（事件 `PL_SESSION_BOUND`）。
  - `answerInterview()` PL 路径改为"PL 提案"：actor 为 PL，`userConfirmed.source = 'pl-proposal-pending-human-approval'`，approval `payload.source = 'pl-proposal'`，activity 明确 "Human approval is still required"。PL 不再伪造 Human actor / 自动生成 Human 确认。
- `src/host/store.js`：schema v5→v6；`projects` 新增 `pl_session_id` 列；`setProjectPlSession()`；snapshot 返回 `project.plSessionId`。
- `client.js`：`openPLChat` 在取得 `sessionId` 后自动调用 `bind-project-pl-session`（Human/owner 委托路径），不再丢弃 Session ID。

### R1.3 最小权限与迁移

- `src/host/control-plane.js` `normalizeTeam()`：权限必须是 `DEFAULT_ROLE_PERMISSIONS[role]` 的子集，越界抛 `INVALID_PERMISSIONS`（403）；Skill 不贡献权限。
- `src/host/store.js` `migrate()`：删除"自动合并默认权限"逻辑，改为 **prune-only**——只修剪角色模板之外的权限，永不把默认权限补回已缩权 Agent。
- `src/shared/contracts.js`：新增 `CHARTER_IMPACT`、`VERIFICATION_COMMAND_STATUS` 枚举。
- `src/host/governance.js` `recordDecision()`：新增 `charterImpact`（NONE/MISSION/SCOPE/CONSTRAINTS）；非 NONE 且 actor 非 Human 时抛 `CHARTER_CHANGE_REQUIRES_HUMAN`（403）。普通 Decision 不能改变 Mission/Scope/不可协商约束。

### R1.4 Host 验证命令白名单

- `src/host/control-plane.js`：
  - `approveVerificationCommand(input)`：Human-only 批准项目级命令（命令文本 1–4000 字符、timeoutMs 1000–300000），写入 `verification_commands` 表（状态 APPROVED/REVOKED），事件 `VERIFICATION_COMMAND_APPROVED`。
  - `revokeVerificationCommand(input)`：Human-only 撤销。
  - `resolveVerificationCommands(projectId, commandIds)`：ID → 白名单解析；未知 404、非 APPROVED 403。
- `src/host/pl-bridge.js` `agent_team_start_task_run`：参数改为 `verification_command_ids`（字符串数组）；出现自由文本 `verification_commands` 直接抛 `VERIFICATION_COMMANDS_REJECTED`；真实命令文本只来自白名单解析。
- `src/host/http-router.js` `start-task-run`：同样只接受 `verification_command_ids`，自由文本 400；解析失败时不产生任何 Run。
- `src/host/store.js`：新增 `verification_commands` 表及 CRUD；snapshot 返回 `verificationCommands`。
- `client.js`：任务启动表单的自由文本 PowerShell 输入框替换为"验证命令白名单（Human 批准）"表单 + 已批准命令 ID 选择器；批准/撤销动作走新 HTTP 路由；ACTIVITY 标签新增三个事件。
- 真实退出码语义不变（`src/host/verification.js` 的 `exitCode`/PASSED/FAILED/TIMED_OUT），空命令因 `requireString min:1` 无法被批准，不会算成功。

## 验收证据

```text
npm test            70/70 passed（含 R0 既有 6 项 + R1 新增/更新 22 项）
npm run test:demo   2/2 passed
npm run pack:check  passed（22 files，package 73.3 kB）
```

测试全部使用隔离临时目录（`node:os.tmpdir()`）+ 独立 SQLite 文件，未触碰用户生产控制面数据库；PowerShell 验证命令仅执行 `Write-Output ok` / `exit 3` 等无副作用命令。

### R1 反向测试清单（14 项）

| # | 要求 | 测试位置 |
|---|------|----------|
| 1 | 匿名 GET/POST 被拒绝 | `r1-auth-boundaries.test.mjs`：anonymous GET and POST are rejected |
| 2 | 错误 Host/跨站 Origin 被拒绝 | `r1-auth-boundaries.test.mjs`：cross-site Origin and foreign Host headers are rejected |
| 3 | 伪造 Human actor 不提权 | `r1-auth-boundaries.test.mjs`：forged Human actor is clamped to the project owner |
| 4 | 普通 Session 调 PL Tool 被拒绝 | `pl-bridge.test.mjs`：an ordinary Session that is not the bound PL Session is rejected |
| 5 | Project A PL 操作 Project B 被拒绝 | `pl-bridge.test.mjs`：another Project's bound PL Session cannot operate this Project |
| 6 | 过期/已替换 PL 被拒绝 | `pl-bridge.test.mjs`：a replaced Project Lead Session is rejected |
| 7 | 缺失 exec.agent 被拒绝 | `pl-bridge.test.mjs`：missing executing Agent context is rejected |
| 8 | 拒绝调用不会产生 parent binding | `pl-bridge.test.mjs`：上述 4/5/6/7 用例均断言 `calls.length === 0`（无 bindProjectParent、无业务调用） |
| 9 | record_interview 不再自动生成 Human 确认 | `r1-auth-boundaries.test.mjs`：PL recording interview answers creates a proposal pending Human approval |
| 10 | 任意权限字符串不能扩权 | `r1-auth-boundaries.test.mjs`：arbitrary permission strings cannot expand a role template |
| 11 | 升级迁移不会恢复已删除权限 | `r1-auth-boundaries.test.mjs`：migration prunes out-of-template permissions and never restores narrowed ones |
| 12 | 未批准 PowerShell 不执行 | `r1-auth-boundaries.test.mjs`：unknown or revoked verification command IDs start no Run + free-text verification commands are refused at the HTTP boundary + unapproved PowerShell never executes（前半段） |
| 13 | 批准的安全命令真实执行并保存退出码 | `r1-auth-boundaries.test.mjs`：unapproved PowerShell never executes...（后半段：真实执行 `Write-Output ok`→exitCode 0 / `exit 3`→exitCode 3） |
| 14 | 无 connection 时 fail closed / Content-Type 强制 / 全局动作忽略 body actor | `r1-auth-boundaries.test.mjs`：POST fails closed without connection、POST requires application/json、global actions use the authenticated owner identity |

补充：`bindProjectPlSession` Human-only（PL actor 403）与绑定持久化（`PL_SESSION_BOUND`）亦已覆盖。

## 安全边界验证

```text
HTTP 身份        认证 = Host connection.admit + owner Peer；body actor 仅角色选择并 clamp 到项目记录
Fail closed     无 connection：POST 全禁（503），GET 只读
PL 工具边界      exec.agent 必须是 Project 绑定的活跃 PL Session；拒绝先于一切副作用
验证命令        只有 Human 批准的白名单 ID 可执行；自由文本在 HTTP 与 PL 两层均被拒绝
权限边界        角色模板子集校验；迁移只剪不补；Skill 不扩权
重大变更        charterImpact ≠ NONE 必须 authenticated Human
审计            PL_SESSION_BOUND / VERIFICATION_COMMAND_APPROVED / VERIFICATION_COMMAND_REVOKED 全部入活动审计
```

## 未完成事项与风险

1. **connection.admit 的 Origin/Host/CSRF 具体校验语义属于 Host 内部实现**：R1 测试用 mock connection 模拟了跨站 Origin/foreign Host 拒绝（401）路径；真实 Host 行为已在 R0 实测（无 connection 时全 200），真实 Host 端到端回归需要在 Host 环境手工验收，mock 与真实集成测试分别报告。
2. **单本地 Owner 模型**：认证 owner Peer 映射为单一本地 Owner（`OWNER_FALLBACK_ID='local-owner'`），多用户区分推迟到后续阶段（与 R0 结论一致）。
3. **PL Session 绑定的 UI 引导**：目前绑定依赖 `openPLChat` 打开工作区时自动绑定 + 失败时 console.error；尚未提供 Panel 手动绑定/解绑表单（R3 的 Session 恢复体验范围内）。
4. **Reviewer 只读 sandbox、Runtime watchdog、post-fix fork/spawn 取消实测**仍为 `UNKNOWN`，属 R4/R5 范围，R1 未触碰。
5. **历史数据库升级**：schema v6 迁移对已有 `pl_session_id` 缺失记录返回 `null`（PL_SESSION_NOT_BOUND fail closed），旧项目需要 Human 重新打开 PL 会话完成绑定后 PL 工具才可用。

## 下一阶段建议

1. Human 验收 R1 后提交 Git（建议提交信息：`R1: authenticated HTTP identity boundary, PL session binding, least-privilege migration, and verification command whitelist`）。
2. R2 开始前建议先做一次真实 Host 集成冒烟：加载插件 → 匿名 GET/POST 应 401/503 → 登录后 GET 200 → 打开 PL 会话确认自动绑定 → PL 调用 `agent_team_project_state` 成功、普通会话调用被拒。
3. R2 按任务书继续（Dashboard/总览 UI 与六页签重构），不要回改 R1 边界语义；如需调整身份/绑定规则，必须先更新本报告对应的反向测试。
