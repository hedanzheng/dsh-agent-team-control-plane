# R7 · Text Stats Smoke Test 复盘修复报告

日期：2026-10-25

基线：`0.6.0` / schema v9

交付版本：`0.6.1` / schema v9（无数据库迁移）

## 1. 生产记录复核

已只读核对 `PROJECT-2A39AEAA`（Text Stats Smoke Test）在本机控制面数据库中的 Project、Task、Run 与 Request 记录：

- 原 T2 `TASK-7803D492` 停在 `SUBMITTED`，早期 Run 没有关联验证命令；
- 原 T3 `TASK-2E01C244` 因依赖未 VERIFIED 停在 `PENDING`；
- `REQUEST-2641C592` 记录了 T1 占位断言与 T2 最终实现互斥的问题；
- 后续承接 Task 使用批准的 `npm test` 命令完成验证。

结论：用户复盘中的 A1–C2 均有状态记录或源码路径支持，不是模型叙述偏差。

## 2. 本轮修复

### R7.1 Run 启动前强制验证命令

- Panel 没有批准命令时禁用“启动 Run”；不再提供“无命令继续并产生 PARTIAL”的选项。
- HTTP `start-task-run` 与 PL `agent_team_start_task_run` 双层拒绝空 `verification_command_ids`，错误码为 `VERIFICATION_COMMAND_REQUIRED`。
- Coordinator 的底层 PARTIAL 防线保留，用于旧记录、恢复路径和内部边界测试。

### R7.2 Human Owner 接受验证风险

- 对 `SUBMITTED` 且 Result 为 PARTIAL 或包含 FAILED evidence 的 Task，审批页显示“Owner 接受风险并验收”。
- 操作要求二次确认，并以 Human Owner 身份提交 `acceptRisk: true`。
- PL 的普通“通过”按钮在验证不完整时隐藏；“退回”仍可用。

### R7.3 PL 回复 NEEDS_INPUT

- 新增 `agent_team_respond_request`。
- 仅能以绑定 PL 身份回答发给当前 PL 的开放 Request。
- 成功应答后沿用治理层已有逻辑：Request → RESOLVED，源 Task WAITING → READY，原 Worker 绑定与审计记录保留。

### R7.4 取消/取代不可达 Task

- 新增 `agent_team_cancel_task`，支持取消 PENDING、READY、SUBMITTED Task。
- Panel 的 Task 卡片同步提供“取消 / 取代 Task”。
- 取消只改变状态并保留 Result、Evidence、Run 与 Activity；修正后的工作使用新 Task 表达。
- WAITING Task 要先回复开放 Request；RUNNING Task 要先取消 Run，避免悬空协作记录。

### R7.5 PL 状态输出瘦身

- `agent_team_project_state` 默认返回 summary，不再重复返回完整 Run/Evidence/Review 历史。
- 指定 `task_id` 返回单 Task 的 Run、Result、Evidence、Request、Response 与 Review 明细。
- `view: "full"` 保留完整读取能力。
- 所有 PL mutation 工具返回紧凑状态，减少连续编排的上下文占用。

### R7.6 Task 建模防错提示

PL policy 与工具描述新增三条硬提示：

1. 所有预期或可能上报的 artifact 必须落入 `scope_allowed`；
2. `scope_forbidden` 只表达绝对禁区，阶段性的“不修改”写入 goal；
3. 设计阶段不得把故意失败的占位实现写成后续阶段必须继承的测试断言。

## 3. 自动验证

- `test/unit/pl-bridge.test.mjs`：空验证命令拒绝、compact/focused state、PL Response、PL Task cancellation。
- `test/unit/r1-auth-boundaries.test.mjs`：HTTP 空验证命令拒绝且不触发 Coordinator。
- `test/unit/r2-evidence-gates.test.mjs`：取消 SUBMITTED Task 后仍保留 Result 历史。
- `test/unit/r7-recovery-ux.test.mjs`：Panel 必选验证命令、Owner 风险验收、Task 取消入口。
- 全量 `npm test`、示例测试与打包检查均作为发布门槛执行。

## 4. 保留边界

- 已存在的 PARTIAL/SUBMITTED 与旧依赖链不会被自动重写；由 Owner 验收风险、PL 退回或取消后新建承接 Task。
- Task 依赖保持不可变，避免事后改写审计事实；更正依赖仍通过新 Task 表达。
- `dependencies` 继续被明确拒绝，唯一参数名为 `dependency_ids`。
