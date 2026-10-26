# O3 读取契约盘点

## 当前调用与依赖

`store.snapshot(projectId)` 当前被 `control-plane.js` 的生命周期/Task/验证命令 mutation、`governance.js` 的 Request/Review/Finding mutation、`run-coordinator.js` 的启动/取消以及 `controlPlane.snapshot()` 使用。HTTP GET 默认返回 full Snapshot，HTTP POST 将上述返回值原样发送；9 个 PL 工具中，`agent_team_project_state` 默认先调用 full Snapshot 再由 `compactState()` 裁剪，其他 8 个 mutation 默认也先构造 full Snapshot 后裁剪。

| Panel 页签 | 首屏必需字段 | 明细按需读取 |
| --- | --- | --- |
| 总览 | projects、runtimes、当前 project/charter、agents、Task 摘要与最新/活跃 Run、pending approval/request/review/finding/plan check/proposal、最近 activity | 技术事件及历史 |
| 项目 | projects、runtimes、project/charter/interview、pending approval、approved decisions、当前阻塞 | 已完成决策历史 |
| 团队 | agents（含已替换身份）、runtimes、project | Agent 历史 |
| 任务 | Task 列表及依赖、每 Task 最新 Run、批准的验证命令、pending proposals | 单 Task 全部 Run/Result/Evidence/Request/Review |
| 审批 | pending approval、SUBMITTED Task 当前 Result/Evidence/Reviewer 状态、open Request/Finding、pending Plan Check | 已处理 Approval/Request/Review/Finding/Plan Check 历史 |
| 活动 | project、Task/Agent 名称、最近 activity | keyset 活动页、首屏 facets |

| PL 工具 | 必需字段/响应 |
| --- | --- |
| `agent_team_project_state` | 默认项目摘要；`task_id` 为单 Task 聚合；`view=full` 为授权后诊断路径 |
| `agent_team_record_interview` | 新 Charter/审批及项目版本摘要 |
| `agent_team_create_task` | 新 Task、依赖及项目版本 |
| `agent_team_assign_task` | Task 指派与版本 |
| `agent_team_start_task_run` | 新 Run 状态与 Task 版本 |
| `agent_team_respond_request` | Request/Response 与返回 READY 的 Task |
| `agent_team_cancel_task` | Task CANCELLED 与版本 |
| `agent_team_request_review` | Review Run 状态 |
| `agent_team_review_task` | Review 决议与 Task 状态 |

## O3 新契约与兼容边界

- `GET ?view=overview&projectId=...` → 与旧外层 Snapshot 兼容的轻量结构，但只含当前页所需的当前/活跃记录及每 Task 最新 Run 摘要，明确标记 `view: 'overview'`；正常总览不扫描全部历史 Run/Evidence/Verification。`taskRuns` 的摘要不包含 Workspace 基线或 Diff；完整记录在 Task 明细/legacy full 中。
- `GET ?view=task-detail&projectId=...&taskId=...` → 仅该 Project 的单 Task 聚合；跨项目 Task 必须 404。
- `GET ?view=history&projectId=...&kind=task-runs|reviews|evidence|approvals|requests|findings|plan-checks&limit=...&cursorCreatedAt=...&cursorId=...` → 按项目与 `(createdAt,id)` keyset 分页，返回 `kind/projectId/items/hasMore/nextCursor`；单页最大 100 条。`requests` 历史附带对应 Response 摘要。
- `GET ?view=activity` 保留 R5 keyset；facets 仅首屏/显式刷新请求，加载更多不重复 `GROUP BY`。
- 无 `view` 或 `view=full` 的旧 GET、`agent_team_project_state(view=full)` 保留授权后的 full 只读诊断路径；既有直接业务调用默认返回语义维持。Panel/PL 的 mutation 携带 `responseView: 'overview'`，Host 返回最新项目版本与足够当前页面继续操作的摘要；Panel 当即以该响应替换状态。未指定 `responseView` 的旧调用仍返回 full Snapshot。
- `listTasks()` 的依赖批量聚合；Run 上下文只查询当前 Task 及明确依赖、最近 Request/Review，Charter 和必要 Approved Decisions 保留。

所有新明细以 `projectId` 校验归属；HTTP 仍先走 R1 admission，PL 仍先验证绑定的真实会话。新增索引须有 `EXPLAIN QUERY PLAN` 证据；优先使用现有索引。
