# O3 完成报告：按需读取

## 范围

按 `Agent_Team_Control_Plane_v0.6.1_UI_and_Performance_Optimization_Plan.md` 的 O3 实施；未进入 O4/O5。改写前源码快照保存在 `D:\GPT-workspace\_backups\atcp-o3-20261026-171208`。独立 GitHub 仓库备份在 `E:\E-gptwork\github-agent-backup`，备份 HEAD 为 `3db4d5586bfdd753e3d03de2c59dc3953b75f4cb`；该目录保持实施前状态。

- `store.getProjectOverview` 只读取当前 Project 的 Task、依赖、每 Task 最新 Run 摘要、当前 Result 与待审核 Evidence、待处理治理记录和最近 Activity；Run 摘要不解析 Workspace 基线/Diff。`getTaskDetail` 按单 Task 取完整 Run/Result/Evidence/Request/Response/Review；`getProjectHistoryPage` 为 7 类历史提供项目隔离的 `(createdAt,id)` keyset 分页。原 `snapshot()` 保留为明确的 full 诊断路径。
- `listTasks` 改为 Task 和依赖各一次查询；`buildTaskRunContext` 只查当前 Task 与依赖的最新 Result、当前 Task 最近 Request/Review、有限条 Approved Decision。
- PL 默认 `agent_team_project_state` 直接读 overview，`task_id` 读单 Task，`view=full` 走旧路径。Panel GET 改读 overview；Task 和治理历史展开时按需读取。Panel/PL mutation 请求 `responseView=overview`，响应含更新后的 Project/Task 版本；旧直接调用仍返回 full。Activity 加载更多不重复计算 facets。
- HTTP GET 新视图仍走原 R1 admission；明细在 Host 验证 Project 与 Task 归属。没有数据库迁移、依赖升级或新增索引；`EXPLAIN QUERY PLAN` 回归确认最新 Run 使用既有 `task_runs_task` 索引。

API 字段与兼容约定见 `docs/O3_API_CONTRACT.md`。

## 可复现性能证据

运行 `node --expose-gc scripts/bench/optimization-baseline.mjs`；同一机器、同一 S/M/L 合成数据，2 次预热后 5 次采样取中位数。原始数据：`docs/optimization-o3-before.json`、`docs/optimization-o3-after.json`。JSON 字节数是等价序列化大小，`httpOverview` 还包括 `{ok:true,data}` 包装；时间是本地 Store/Tool 函数耗时，**不是实测网络 RTT**。

| 规模（Task/Run/Activity） | 旧 full Snapshot | 新 overview | PL 默认前 → 后 | Task 列表 SQL 前 → 后 |
| --- | --- | --- | --- | --- |
| S（10/20/200） | 41 SQL；46,518 B；1.612 ms | 28 SQL；17,205 B；1.015 ms | 1.782 → 1.057 ms；Tool JSON 均 7,516 B | 11 → 2 |
| M（100/300/5,000） | 131 SQL；588,467 B；8.456 ms | 28 SQL；123,214 B；2.346 ms | 10.692 → 2.710 ms；Tool JSON 均 52,381 B | 101 → 2 |
| L（500/2,000/20,000） | 531 SQL；3,797,129 B；52.206 ms | 28 SQL；598,625 B；10.154 ms | 63.244 → 11.180 ms；Tool JSON 均 254,894 B | 501 → 2 |

L 规模下 `httpOverview` 为 598,644 B、28 SQL、11.393 ms；单 Task 明细为 8,076 B、10 SQL、1.547 ms；50 条 Run 历史为 34,296 B、1 SQL、2.152 ms。PL 端最终 JSON 沿用旧字段语义与大小，但构建它的 SQL 从 533 次降为 30 次。RSS 数值受 GC 与调用顺序影响，本报告不将其作为改善结论。

## 回归与边界

- 500 Task/2,000 Run + 第二 Project：总览只含 500 个最新 Run，单 Task 取 4 次完整 Run/Evidence；Run、Review、Evidence、Request 历史分页无重漏；跨项目 Task 返回 404，历史和 Activity 无跨项目记录。
- 固定 10 Task 额外增加 500 历史 Run 后，overview JSON 增幅小于 10%，full Snapshot 随历史显著增长。`listTasks` 恒为 2 次 SQL。Run 上下文 spy 禁止全量 `listResults/listRequests/listReviews/listDecisions`，仍保留已批准 Charter、依赖结果、必要 Decision/Request/Review。
- GET 新视图的未认证请求 401；legacy full 可读；Activity 后续页不调用 facets；mutation 新版本可用于紧接着第二次操作，旧版本被拒绝。
- Panel 组件测试证明 Task 完整 Run 历史与治理历史仅在用户展开时请求；原 O1/O2 跨项目切换、草稿隔离和风险门禁测试仍通过。
- 最终 `npm test`：**126/126** 通过，0 fail，退出码 0；`npm run test:demo`：**2/2** 通过，退出码 0；`npm run pack:check`：23 个包内文件 dry-run 通过，退出码 0；`node --check client.js`、`node --check src/host/store.js`、`node --check src/host/http-router.js` 与 `git diff --check` 通过。
- 自动化结果以最终验收命令为准；Desktop GUI 的视觉与实际点击验收尚未在 O3 完成，不能由组件/路由测试代替。当前 Desktop Profile 仍安装 O2 版本；O3 的源代码与 GitHub 提交完成后，真机发布属于后续阶段。
