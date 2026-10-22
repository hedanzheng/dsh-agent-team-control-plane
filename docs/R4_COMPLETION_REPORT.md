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

### ❌ 无法在本机自动验证（GUI 渲染被沙箱阻断）
Harness 进程可启动（PID 存活、插件 apply 执行、数据库访问成功），但 **Electron 渲染进程无法在 Agent 沙箱会话中完成**（CPU 0.2s、内存 38.7MB、主窗口标题为空），因此以下端到端步骤**需 Human 在桌面 GUI 中手动完成**：

1. 真实 PL 对话：创建 Project → 左侧栏自动出现 PL 对话 → 访谈 → 批准 Charter/Team。
2. 真实 Worker Run：用 `subagent:spawn`/`subagent:fork` 执行简单 Task、生成文件、跑预批准验证命令、保存 Evidence。
3. 真实 Request：Worker 返回 `NEEDS_INPUT` → Request → 空闲 Agent 回答 → 下一次 one-shot Run 收 Checkpoint。
4. 真实 Review：IMPORTANT 的 PL Review、CRITICAL 的独立 Review、Reject→Rework→Approve。
5. 非法命令/越界修改/未知状态的拒绝与 Activity 展示。
6. 插件卸载重装、Host 重启、SQLite 备份恢复的实机回归。

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
1. **GUI 端到端验收未完成**：受沙箱限制，步骤 2–8 的实机流程无法由本 Agent 自动执行，需 Human 在桌面 Harness GUI 中完成（见下方操作清单）。
2. **外部 Worker 后端不可用**：Codex/Claude 未注册为 subagent provider；如需真实外部后端，需在 Harness 配置中注册 `codex`/`claude-code` provider（超出本仓库代码范围，属宿主配置）。
3. **PL 模型 ↔ Session 一致性**：仍依赖宿主，代码无法断言（R3 已记录）。
4. **回滚方式**：本次部署为本地源码覆盖，备份在 `profiles/desktop/backups/atcp-before-r4-local-20261022-213842`；待代理恢复后建议重新 `pnpm add github:...` 使 lock 指向 `d867e42`（当前 lock 仍指向 `d705504`）。

## 附：Human 真机验收操作清单（不含敏感数据）
1. 打开 DeepSeek Harness 桌面端，进入“Agent 团队”面板。
2. 新建 Project → 观察左侧栏是否自动出现 PL 对话（R3.3：只建一次，不重复）。
3. 在 PL 对话完成访谈 → 回面板批准 Charter → 批准 Team。
4. 创建 Task → 指派 Worker → 启动 Run（后端选 `spawn` 或 `fork`）→ 观察 Run 收敛、Result/Evidence 生成。
5. IMPORTANT Task 走 PL Review；故意触发越界修改/非法命令，确认被拒绝并出现在 Activity。
6. 停止 Project 后再触发一次 review，确认不会复活 Task（R3.2）。
7. 记录各 Task/Run/Evidence/Review ID 与验证命令退出码，回填本报告后即为完整 R4 真机回归。

## 下一阶段建议
- 是否满足本阶段验收：**NO（部分）** —— 环境/部署/后端矩阵已真机核实，但端到端流程因 GUI 沙箱限制未完成，需 Human 手动执行操作清单补齐。
- 建议接下来：Human 完成真机清单（或确认 GUI 端到端通过）后，再进入 **R5**（六页签总览改造）；R4 未补齐前不应开始 R5 的大规模 UI 改造。
