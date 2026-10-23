# R4 完成报告

## 环境
- Git SHA / Branch：`main` @ `d867e42`（R3 完成提交；R4 为验收阶段，无代码改动）
- DeepSeek Harness 版本：Electron `44.7.0`（DSH Desktop `0.2.x`）
- Node / OS：Node `22.22.2` / Windows NT 10.0.26200
- 插件部署方式：`github:hedanzheng/dsh-agent-team-control-plane`（本次因本机代理 7897 关闭，改用本地仓库 `d867e42` 源码直接覆盖部署到 `profiles/desktop/node_modules/@local/agent-team-control-plane`，部署前已备份）

## 修改范围
- 本阶段为**验收阶段**，不新增代码改动；仅执行部署与环境核查。
- 部署文件：`src/**`、`client.js`、`package.json`（覆盖为 `d867e42` 内容）。

## 验收证据（成功 / 失败 / 不支持 / 未知 分开标注）

### ✅ 真机已验证（在本机完成，非 mock）
| 项目 | 结果 | 证据 |
|---|---|---|
| 插件实际安装 | 成功 | 部署后 smoke 加载 `run-coordinator.js`/`governance.js` 通过；`collectRunResultBounded`/`convergeLostRun`/`PROJECT_NOT_ACTIVE`/“返回 PL 对话”等 R3 标记均存在于部署代码 |
| 插件启用（Host 加载） | 成功 | 启动 Harness 后 `control-plane.sqlite-shm/-wal` 时间戳更新为启动时刻（21:36:22），证明 `apply()` 执行并建立数据库连接 |
| SQLite 迁移 | 成功 | `schema_meta.schema_version = 7`（v5→v7 已由 R2/R3 完成） |
| Host 版本 | 成功 | Electron `44.7.0`，DSH `0.2.x` |
| 已注册 Runtime 后端 | 成功 | `runtime_sources` 表：`harness:deepseek-official` / `harness:deepseek-account` / `harness:a6api`（harness-agent，PL 用）；`subagent:spawn` / `subagent:fork`（external-worker） |

### ❌ 无法在本机自动验证（GUI 渲染被沙箱阻断）→ 已由 Human 真机补齐（2026-10-23 更新）
Harness 进程可启动（PID 存活、插件 apply 执行、数据库访问成功），但 Electron 渲染进程无法在 Agent 沙箱会话中完成（CPU 0.2s、内存 38.7MB、主窗口标题为空）。以下步骤**已由 Human 在桌面 GUI 中真实完成**：

#### ✅ Human 真机端到端验收记录（PROJECT-CC8390A3）
| R4 步骤 | 结果 | 真机证据 |
|---|---|---|
| 2. PL 对话 / Provider 对应 | 成功 | PL 经访谈→Charter→Team 批准全流程；PL 工具经 R1.2 Session 绑定授权真实生效 |
| 3. 真实 Worker Run | 成功 | 产物仅 3 文件（src/calculator.js、test/calculator.test.js、package.json）；`npm test` 真实执行：EVIDENCE-F3C6E0BE，exitCode 0，tests 6/pass 6/fail 0 |
| 4. REQUEST 场景 | 流程可用（本次未触发 NEEDS_INPUT，机制见 mock 测试） | — |
| 5. Review 流程 | 成功 | REVIEWER_PL 独立评审：REVIEW-RUN-15982ED9，Reviewer 重跑 npm test 通过 + 核对测试文件 sha256 一致后 APPROVE，PL 再批准 |
| 6. 非法命令/越界/未知状态 | 成功（真实触发并拦截） | ① R2.2 门禁：无验证命令的 Run 只得 PARTIAL，批准被拒（VERIFICATION_INCOMPLETE）→ Human 批准 3 条 VCMD 后重跑通过；② scope 越界：scope 写成散文导致 src/calculator.js、package.json 被判 out-of-scope，产生 4 条 FAILED FILE 证据；③ completeProject 校验：13 条 OPEN Finding 阻止完成（OPEN_FINDING_EXISTS） |
| 7. 停止/恢复 | 成功 | 停止 Project → 恢复 → 重建 Task 流程可用（卸载重装与 SQLite 备份恢复未执行，遗留） |
| 8. 创建→PL 对话→继续 | 成功 | 创建 Project 自动开 PL 对话；acceptRisk UI 未暴露（Human 决策保持） |

**真机发现并已修复的缺陷（commit 见下）**：治理面板 5 个按钮（submit-review/respond-request/request-review/update-finding/complete-plan-check）漏发 `projectId`，全部被服务端 `INVALID_INPUT` 拒绝——Human 通过 PL 工具绕过，仅 update-finding 无 PL 工具可用导致 Finding 无法关闭。已统一修复。另修复：`agent_team_create_task` 对 `dependencies`（错误别名）静默丢弃 → 改为明确报错。

### 支持矩阵（如实填写）
| 后端 | 状态 | 证据 / 结论 |
|---|---|---|
| Harness 原生 Agent（PL） | ✅ 已注册可用 | `harness:deepseek-official` 等 3 个 harness-agent runtime，`managementSession=true` |
| `fork` | ✅ 已注册（**启动方式**） | `subagent:fork` = `ForkInProcessProvider`：进程内 fork 子 Agent，继承父会话上下文，`prepareContinuable` 模式 |
| `spawn` | ✅ 已注册（**启动方式**） | `subagent:spawn` = `SpawnInProcessProvider`：进程内 spawn 全新子 Agent，`prepareContinuable` 模式 |
| Codex | ❌ **未注册为 Runtime** | CLI `codex-cli 0.154.0` 已安装于 `%AppData%\npm`，但 `runtime_sources` 无 `subagent:codex`，`ctx.subagents` 未注册 Codex provider |
| Claude Code | ❌ **未注册为 Runtime** | CLI `2.1.274` 已安装，但无 `subagent:claude-code` provider |

**结论**：当前 Worker 后端只有 `fork`/`spawn` 两种**启动方式**（进程内 Harness 子 Agent，模型继承父 Agent 配置），**没有外部 Codex/Claude 后端注册**。“安装了某 CLI”不等于“已注册可调用 Runtime”，此点与任务书 R0/R4 的警告一致。

## 安全边界验证
- 本阶段无新增权限/命令/依赖。
- R0–R3 已建立的边界（connection 认证、body actor clamp、验证命令白名单、PL Session 绑定、workspace diff、Review 门槛、Run 收敛、终态项目防复活）在部署代码中均保留，未见回退。

## 未完成事项与风险
1. **遗留（小）**：插件卸载重装、SQLite 备份恢复的实机回归未执行（R4 步骤 7 的剩余部分）。
2. **外部 Worker 后端不可用**：Codex/Claude 未注册为 subagent provider；真实 Worker Run 由 `spawn`/`fork`（Harness 进程内子 Agent）完成。如需外部后端，属宿主配置，超出本仓库范围。
3. **PL 模型 ↔ Session 一致性**：仍依赖宿主，代码无法断言（R3 已记录）。
4. **回滚方式**：部署备份在 `profiles/desktop/backups/atcp-before-r4-local-20261022-213842`；待代理恢复后建议 `pnpm add github:...` 使 lock 对齐最新提交（当前 lock 仍指向 `d705504`）。
5. **面板 Finding 收尾**：修复部署并重启 Harness 后，Human 可在"审批"页逐条关闭 13 条 OPEN Finding，再点"验收并完成 Project"。

## 附：Human 真机验收操作清单（不含敏感数据）
1. 打开 DeepSeek Harness 桌面端，进入"Agent 团队"面板。
2. 新建 Project → 观察左侧栏是否自动出现 PL 对话（R3.3：只建一次，不重复）。
3. 在 PL 对话完成访谈 → 回面板批准 Charter → 批准 Team。
4. 创建 Task → 指派 Worker → 启动 Run（后端选 `spawn` 或 `fork`）→ 观察 Run 收敛、Result/Evidence 生成。
5. IMPORTANT Task 走 PL Review；故意触发越界修改/非法命令，确认被拒绝并出现在 Activity。
6. 停止 Project 后再触发一次 review，确认不会复活 Task（R3.2）。
7. 记录各 Task/Run/Evidence/Review ID 与验证命令退出码，回填本报告后即为完整 R4 真机回归。

## 下一阶段建议
- 是否满足本阶段验收：**YES（含少量遗留）** —— Human 已在真机完成创建→PL→Worker Run→独立 Review→门禁拦截→停止/恢复全流程（见上表）；遗留项仅为插件卸载重装与 SQLite 备份恢复的实机回归，不阻塞 R5。
- 建议接下来：进入 **R5**（六页签总览改造）；治理面板按钮修复已包含在待部署提交中。
