# R3 完成报告

## 环境
- Git SHA / Branch：`main`（基于 `d705504`，本次改动待提交）
- DeepSeek Harness 版本：`0.2.x`（Electron `44.7.0`，`app.asar` 内 `@deepseek-ai/dsh-client-connection` 已实机解包核对）
- Node / OS：Node 24.x / Windows NT 10.0.26200

## 修改范围
- `src/host/run-coordinator.js`
  - 构造器新增 `gracePeriodMs`（默认 30000）。
  - `execute()` 的 `collectRunResult` 改为经 `collectRunResultBounded()`：超时触发取消后，Runtime 在 `timeoutMs + gracePeriodMs` 内仍不返回时，合成 `unresponsive` 终态 → `UNKNOWN`，不再永久 `RUNNING`。
  - 新增 `convergeLostRun(runId)`：运行时句柄失联（watchdog 判定 `SUSPECTED_LOST`）时收敛为 `UNKNOWN`，`Task → WAITING`、释放写锁、写入审计证据，不自动重跑。
  - `startWatchdog()`：`SUSPECTED_LOST` 触发 `convergeLostRun`（幂等，与自然结束互斥）。
- `src/host/governance.js`
  - `submitReview()` 开头增加 `project.status !== 'ACTIVE'` 校验，晚到审核不再复活终态 Project 的 Task。
  - `executeReviewRun()` 成功分支重查 Project 状态，非 ACTIVE 时标记 `REVIEW_RUN_ABANDONED` 并丢弃评审结果，不改 Task。
  - `verifyTask()` / `returnForRework()` 增加防御性 Project 状态检查。
- `client.js`
  - `openPLChat()` 幂等：Project 已绑定 `plSessionId` 且宿主会话仍存在时复用、不重复 `openWorkspace`；仅当无绑定或原会话已失效时才新建一次并重绑。
  - `act()` 的 `create-project` 分支：PL 对话打开失败时给出可恢复提示（“Project 已创建，但 PL 对话未打开”），不会因重试而重复创建 Project。
  - 两处“打开新的 PL 工作对话”按钮按绑定状态改为“返回 PL 对话 / 创建 PL 对话”。
- `test/unit/r3-recovery-consistency.test.mjs`（新增 7 项反向测试）

## 验收证据
- `npm test`：**88/88 passed**（原 81 + 新增 7）
- `npm run test:demo`：通过
- `npm run pack:check`：通过（23 files）
- 新增反向测试覆盖：
  1. Runtime 永不 resolve → grace 后收敛 `UNKNOWN`、`Task → WAITING`、锁释放、单一 Result；
  2. 失联句柄 `convergeLostRun` 收敛且幂等（第二次不产生第二个 Result）；
  3. `recoverInterruptedRuns` 将宿主重启遗留的活动 Run 标记 `UNKNOWN` 且不重放；
  4. 晚到 review 决策无法复活已 STOPPED Project 的 Task（`PROJECT_NOT_ACTIVE`）；
  5. `verifyTask` 拒绝在 COMPLETED Project 中 VERIFY；
  6. PL Session 绑定按 Project 隔离、重绑幂等；
  7. STOPPED Project 拒绝 PL Session 绑定。
- Host 实测 vs mock 区别：以上均为 mock/单元与集成测试；真实 Harness 的 Session 定位/模型绑定见“未完成事项”。

## 安全边界验证
- 修复风险编号：R-01（Run 永久 RUNNING 无收敛闭环）、R3.2（终态 Project 被晚到回调复活）。
- 反向测试证据：见上 7 项。
- 新增权限/命令/依赖：**无**（未新增依赖、未新增执行命令、未扩大权限）。

## 未完成事项与风险
- **PL 模型与实际 Session 模型一致性（R3.3 任务书第 251 行）无法在本机以代码断言**：`openWorkspace(workspaceId, cb, { agentPreset: 'standard' })` 的 Provider/Model 选择由宿主决定，插件无法读到已绑定 Session 的实际 Model ID。R0 已记录此限制；结论为“显式阻断报告”，不伪造“已一致”。
- **宿主“定位已有会话”API 未确认**：`ctx.sessions.list` 能读快照（据此实现“复用不重复建”），但未发现可靠的 `focus/switchToSession` 接口。因此“返回 PL 对话”仅做幂等提示（引导走左侧栏），不做无效的定位按钮。
- **grace 收敛是后验处理**：对已写入文件但结果未收集的 `UNKNOWN` Run，一律不自动重跑，需 Human 检查工作区后再决定（符合任务书要求）。
- 回滚方式：本次改动可整体 revert 至 `d705504`；无 schema 变更（未新增表/列，无需迁移）。

## 下一阶段建议
- 是否满足本阶段验收：**YES**（R3.1 收敛、R3.2 状态一致性、R3.3 会话幂等与隔离均落地并测试）。
- 建议接下来：进入 **R4 真实 Harness 端到端验收**（创建→PL→Worker→Review→恢复真机流程，不含敏感数据），分别报告真机结果与 mock 结果；R4 前不得开始 R5 的六页签 UI 改造。
