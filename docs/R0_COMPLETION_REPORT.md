# R0 完成报告

## 环境

- Git SHA / Branch：`35241d1bec2fef339468de39f174ffc41cad9305` / `main`；R0 开始时 `git status --short` 为空，正好等于任务书基线。
- DeepSeek Harness 版本：Desktop、CLI、活动运行时元数据均为 `0.2.1-rc.2`。
- 插件版本：仓库及 Desktop Profile 已安装的 `@local/agent-team-control-plane` 均为 `0.5.7`；本阶段不升级产品版本。
- Node / OS：Host Node `24.21.0`；执行测试的开发 Shell Node `24.15.0`；Windows NT `10.0.26200.0`。
- 实际审查的 Harness 包：`@deepseek-ai/dsh-host-webserver`、`dsh-client-connection`、`dsh-client-ui-workspace`、`dsh-tools`、`dsh-agent`、`dsh-subagent`，版本均为 `0.2.1-rc.2`。
- 真实 API：`ctx.connection.admit/rpc/fetch`、`ctx.sessions.create`、`ctx.uiWorkspace.openSession/openWorkspace`、Session `modelSelection.lastUsed` projection、`ctx.tools.register/restrict/guard`、`ctx.subagents.list/startActivation`、`ctx.skills.snapshot/list/get`。
- `sessionId`：**实际取得并验证过**一个隔离测试 Session，两轮对话保持同一 ID 且 projection 持久；仓库仅保存 `<redacted-session-id>`。尚未验证“Project 绑定后重启 Host 再打开同一 Session”，因为当前产品没有该绑定。

## 修改范围

- `docs/host-compatibility-matrix.md`
  - 固化每项能力的 `SUPPORTED / UNSUPPORTED / UNKNOWN`、证据等级、0.2.1 API、限制与最小回退。
- `docs/trust-boundary.md`
  - 记录 Panel、原始 HTTP、Host Connection、Tool/PL、Subagent、Reviewer、文件系统和 Skill 的当前/目标信任边界。
- `docs/evidence/r0/r0-evidence.redacted.json`
  - 保存环境、状态码、能力和证据分类；不保存响应正文、Cookie、Token、凭据、真实 Project 内容或未脱敏 Session/Run ID。
- `scripts/r0-probe-http-boundary.ps1`
  - 新增仅限 loopback 的最小 HTTP PoC；固定发送无凭据 GET、同源/跨源 GET、OPTIONS 与未知 action POST，只记录状态和响应元数据。
- `scripts/r0-validate-evidence.mjs`
  - 校验 PoC 输出 schema、固定请求集、安全开关、loopback 限制和敏感字段/值；报错不回显敏感值。
- `test/unit/r0-evidence.test.mjs`
  - 新增 6 个零依赖测试，覆盖合法证据、必需请求、敏感材料/正文拒绝、网络不可用证据、CLI 退出码和两端 loopback allowlist 一致性。
- `docs/R0_COMPLETION_REPORT.md`
  - 本报告。

没有修改产品 Host 逻辑、UI、数据库 schema、Panel 页签、Runtime adapter 或包版本；没有开始 R1–R5。

重要设计抉择：

1. 将 `TYPE`、`CURRENT_HOST`、`HISTORICAL_HOST`、`MOCK` 分开，避免把单元测试写成真机结论。
2. PoC 的 POST action 固定为不存在的 `__r0_probe_unknown_action_v1__`，只证明请求抵达 dispatcher，不执行任何业务变更。
3. 不让 PoC接收 Cookie/Token/Authorization；关闭自动 Cookie、默认凭据、代理和重定向；不持久化请求/响应正文。
4. `fork/spawn` 只记为 Provider/启动方式。没有相应 child Session 的 `modelSelection.lastUsed` 时，实际模型必须是 `UNKNOWN`。
5. `grill-me` 当前缺失，因此保留 fallback interview；数据库中的 `skills:['grill-me']` 不算加载或执行证据。

## 验收证据

### 执行的命令与退出码

| 命令/检查 | 结果 |
|---|---|
| `git status --short`、`git rev-parse HEAD`、`git branch --show-current` | 退出码 0；开始时 clean；HEAD/branch 与基线一致。 |
| Desktop 注册表、exe metadata、`D:\DeepSeekHarness\resources\runtime\cli\bin\dsh.cmd --version` | 退出码 0；三处均确认 `0.2.1-rc.2`。 |
| Host runtime `node.exe --version` 与 runtime JSON | 退出码 0；`v24.21.0`。 |
| 对活动 Host 的无凭据/Origin/Host/伪凭据 GET 矩阵 | 请求均完成；控制面路由均为 `200`，相同长度与 SHA-256；根 `/` 为 `401`。 |
| 跨源 `OPTIONS` | `405`、`Allow: GET, POST`、无 `Access-Control-Allow-Origin`。 |
| 跨源 `text/plain` + 空 JSON 的无副作用 POST | `400 UNKNOWN_ACTION`；已进入业务 dispatcher，未触发数据库动作。 |
| 只读 SQLite 查询 runtime/task-run/skill 状态 | 退出码 0；仅选择结构化字段，不读取 Result/Prompt 正文。 |
| 隔离 Phase-0 UI/Session、Codex one-shot/cancel/sandbox probe | 退出码 0；证据详见下方“Host 实测”。 |
| `scripts/r0-probe-http-boundary.ps1` 对临时 loopback mock Host | 退出码 0；5 个请求为 `200/200/200/204/400`；`probeStatus=COMPLETE`；响应正文未持久化。 |
| `node scripts/r0-validate-evidence.mjs <临时证据>` | 退出码 0；`ok=true`、5 个固定请求。 |
| Windows PowerShell 5.1 运行同一探针（Host 已关闭） | 退出码 0；正确产生 `NETWORK_UNAVAILABLE` 脱敏证据，validator 退出码 0；临时文件已删除。 |
| `npm test` | 退出码 0；47/47 通过，0 fail/skip/cancel。 |
| `npm run test:demo` | 退出码 0；2/2 通过。 |
| `npm run pack:check` | 退出码 0；dry-run 21 files，包大小 67.4 kB；未生成 tarball。 |

### Host 实测与 mock 的区别

**CURRENT_HOST：**

- 当前 Desktop Host 的 `/agent-team-control-plane/v1` 无凭据 GET、伪 Header、跨 Origin/Host 均返回 `200`；完整响应没有写入仓库。
- Live snapshot 报告：`subagent:fork`、`subagent:spawn` 可用且为 continuable backend；`harness:deepseek-official` 可用，目录含 `deepseek-flash` 和 `deepseek-v4-pro`；`a6api`、`deepseek-account` 当前未配置。
- 隔离 PL probe 创建了真实 Session，两轮保持同一 Session；该次实际 `lastUsed` 为 `deepseek-official / deepseek-flash / high`。具体 Session ID 已脱敏。
- 隔离 Codex external-provider probe 完成 one-shot；取消结果为 `aborted`；workspace 外写入未发生。该 probe 使用 direct provider `start`，**不是**当前 managed `startActivation` 流程。
- Skill scan `complete=true`，仅发现 `diagnose-windows-sandbox-acl`，`grillMeAvailable=false`。

**HISTORICAL_HOST：**

- 当前生产 SQLite 在 managed-activation 修复后保存 3 个真实 `subagent:fork` SUCCEEDED Run，均有 runtime Session reference；三个 child projection 的 `lastUsed` 均为历史的 `deepseek-account / deepseek-flash / high`。
- 另有 5 个修复前 `CANNOT_START` 记录。它们用于说明迁移前后事实，不能冒充本轮 fresh run。

**TYPE：**

- 官方 0.2.1-rc.2 实现确认 raw `webServer` 没有全局认证，`connection` 提供 admission/Peer，Tool exec 的 Agent 来自 live Registry，`openSession` 可定位既有 Session，`startActivation` 自动分流 local/external Provider。

**MOCK：**

- 安全内存 PoC 使用普通 `SESSION-ORDINARY` 调用桥接工具，证明当前代码会把它绑定到任意 `project_id`，并从数据库 Project 构造 PL/Human actor。PoC 没有连接真实 SQLite、没有写真实 Project。
- `npm test` 的工作流/适配器测试大多使用 fake scanner/adapter；本报告没有把它们记为 Host 集成验证。

### 失败或跳过的测试及原因

- post-fix `fork/spawn` managed-activation 取消：**未验证/UNKNOWN**。API 和 adapter 有 abort/dispose 路径，但生产 DB 没有对应取消记录；R0 没有为此创建会触碰真实项目的 Run。
- Reviewer 真机闭环和写入反测：**未验证/UNKNOWN**。生产 `review_runs` 为空；现有代码明确没有选择只读 sandbox，贸然让 Reviewer 写入不是安全的调查方法。预防性只读保证据静态配置判定为 **UNSUPPORTED**。
- Project PL Session 在 Host 重启后的自动定位：**未验证/UNKNOWN**。Host `openSession/resume` API 支持，但插件未保存 Project↔Session 绑定，无法进行产品路径复验。
- `grill-me` 实际调用：**未执行/UNSUPPORTED**，因为当前 skill discovery 明确报告该 Skill 不存在。
- 全量 `ctx` service registry 枚举：**UNKNOWN**。没有找到公开枚举 API；报告只列插件实际声明的 inject 和经类型核实的相关服务，不把其他插件的依赖当作本插件已注入。

## 安全边界验证

### 调查的风险编号

- 修复的风险编号：**无**。R0 只调查、复现和分类，不在未完成 Host 身份确认前改产品边界。
- `S-01`：确认。HTTP body actor 不是认证；raw exact route 也没有 Host admission。
- `S-03`：确认。任意 live Agent 可按 caller-supplied `project_id` 绑定，桥接层随后构造高权限 actor。
- `R-02`：确认。`agentPreset:'standard'` 与 Project 选择的 PL runtime 没有一致性校验。
- `X-03`：确认。当前只做 Skill discovery，且 `grill-me` 实际不存在；发现本身也不等于调用。
- `U-01`：确认。`openWorkspace` callback 得到的新 Session ID 被丢弃，产品没有 Project↔Session 绑定/恢复。
- `U-02`：确认。当前扫描只能证明 `fork/spawn` Provider；缺 child Session projection 时不能展示真实模型。

R0 是调查阶段，以上风险**尚未修复**。本阶段没有新增权限、命令白名单或认证机制。

### 反向测试证据

1. 根 `/` 无凭据为 `401`，但插件 exact route 为 `200`，证明 Host fallback 登录没有保护该路由。
2. foreign Origin、`Sec-Fetch-Site: cross-site`、foreign Host、伪 Cookie/Authorization/CSRF header 均未改变 `200` 结果。
3. `text/plain` 未知 action POST 到达 dispatcher，证明当前没有先做 Content-Type/Origin/身份门禁。
4. 普通 Agent 的 in-memory Tool 调用产生 Project parent 绑定，并被桥接为目标 Project 的 PL/Human actor。
5. 当前 Reviewer spec 使用真实可写 `cwd`，限制仅出现在 Prompt；没有技术只读策略可供正向证明。
6. 生产 Profile 的 `ctx.subagents.list()` 不含 Codex/Claude；本机 CLI 或隔离 Profile 的 Provider 不能被包装成“生产已注册”。

### 新增权限/命令/依赖

- 新增权限：无。
- 新增可执行 Host 业务命令：无。PoC 只有固定、无副作用的未知 action。
- 新增 npm/第三方依赖：无。
- 新增后台轮询：无。
- 新增运行时磁盘存储开销：无；仅新增仓库文档、证据、脚本和测试文件。PoC 的可选输出采用临时文件后原子替换。

## 未完成事项与风险

- 当前 raw HTTP route 的读写均未认证；在 R1 完成前，不应把 Panel body 中的 Human Owner ID 当安全边界。
- 全局 PL Tools 没有 Project/Session 授权。知道 Project ID 的普通会话可能读取或改变该 Project。
- Session API 可用，但当前无持久绑定。重复点击会继续创建/复用 blank Session，不能承诺“返回原 PL 对话”。
- 实际模型必须从目标 Session 的 `modelSelection.lastUsed` 获取；未运行或 Host 未报告时保留 `UNKNOWN`。
- managed fork/spawn 取消、真实独立 Reviewer 闭环、Host 重启后的 Project Session 恢复仍需后续隔离真机测试。
- Reviewer/Request 目前没有预防性只读隔离；Prompt-only 不构成文件或命令权限。
- `grill-me` 缺失，访谈只能继续 fallback；安装后仍需可信 invocation 证据。

仍需 Human 批准的决定：R1 是否采用推荐的 authenticated Host Connection + 单一 owner principal 模式；若 composition 无法注入 `connection`，是否接受“Panel 只读、敏感 HTTP/PL 操作禁用”的受限兼容模式。

回滚方式：删除本阶段新增的 7 个文件即可；没有数据库迁移、产品代码改动、安装项或后台服务需要回滚。

## 下一阶段建议

- 是否满足本阶段验收：**YES（R0 调查与证据交付）**。
- 这不表示产品安全问题已经修复，也不表示 R1–R5 已完成。
- 建议下一阶段仅做 **R1**：
  1. 注入并使用官方 `connection`，在读取 snapshot/body 前 admission，Human 操作只接受 owner `Peer`；
  2. 建立 Project↔PL Session 持久绑定，对每个 `agent_team_*` 校验 exact live Agent、Session、Project、角色和替换状态；
  3. `record_interview` 改为 PL 提案 + authenticated Human 确认，不再伪造 Human actor；
  4. 无可信 connection 时 fail closed，启用只读受限模式，而不是把 localhost 当身份。

R0 到此停止，**未自动开始 R1**。
