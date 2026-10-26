# O1–O5 优化测量结果（O6 汇总，2026-10-26）

- 当前代码基线：`68b6cc1dcac893a49202c673e85de5d7f8690f4a`（O5）。插件 `0.6.1`、DeepSeek Harness Desktop `0.2.1-rc.2`、Windows 11、Node `v24.15.0`、npm `11.12.1`。
- 合成数据：S=10 Task/20 Run/200 Activity；M=100/300/5,000；L=500/2,000/20,000。每个 Run 另有 Result/Evidence/Verification；隔离 SQLite 与临时工作区，不使用用户 Project、凭据或桌面 GUI。`scripts/bench/optimization-baseline.mjs` 各指标预热 2 次、测 5 次取中位数。原始 O0/O6 数据为 `optimization-baseline-data.json`、`optimization-o6-final.json`。
- 下表是本机 Store/PL 工具构造时间及等价 JSON 大小，**不是 HTTP 往返或 Panel 绘制时间**。前后使用同规格数据，但不同时刻运行；小幅耗时变化可能只是机器负载。

| L 档指标 | O0 优化前 | O6 当前 | 解读 |
| --- | ---: | ---: | --- |
| Panel 当前项目数据 JSON | full Snapshot 3,797,129 B | overview 598,625 B | 少约 84.2%；按需详情另取，不是数据丢失 |
| 相应 Store 调用中位数 | 44.352 ms / 531 SQL prepare | 6.974 ms / 28 SQL prepare | 少约 84.3% 耗时；仅本机函数调用 |
| PL 默认状态构造 | 55.398 ms / 533 SQL prepare | 7.364 ms / 30 SQL prepare | 输出仍为 254,894 B；少建完整 Snapshot |
| Task 列表 SQL prepare | 501 | 2 | 消除依赖查询 N+1 |
| Activity 首屏 50 条 | 0.203 ms / 1 SQL | 0.137 ms / 1 SQL | 原本已是 keyset 查询；差异不申报优化 |
| Activity facets | 首屏和每次加载更多均聚合 | 初次/变更筛选/明确刷新聚合；加载更多 0 次 | O5 组件测试与 20,000 条分页测试验证 |

S 档 overview 17,205 B / 0.894 ms，M 档 123,214 B / 1.886 ms；各档 Task 列表均为 2 次 SQL prepare。L 档 `getTaskDetail()` 和 50 条历史页在 O3 配对基准分别为 8,076 B / 1.547 ms、34,296 B / 2.152 ms；只在用户展开时获取。O3 更接近的配对对照见 `O3_COMPLETION_REPORT.md`，其 L 档 PL 构造 63.244→11.180 ms，避免把不同时刻的全部差异归因于源码。

## 工作区扫描

`scripts/bench/workspace-o4.mjs` 在同规格 100/1,000/10,000 个 256 B 文件工作区测量，5 次取中位数；原始 O4 前/后与 O6 复测为 `optimization-o4-before.json`、`optimization-o4-after.json`、`optimization-o6-workspace.json`。O4-A 仍逐文件完整 SHA-256，增加 canonical/变动检测并由短生命周期 Worker Thread 执行；因此覆盖与旧扫描不同，不宣称总耗时更快。

| 文件数 | O4 前同步总耗时 / 主线程最大延迟 | O6 当前异步总耗时 / 主线程最大延迟 | 基线 JSON |
| ---: | ---: | ---: | ---: |
| 100 | 8.790 / 8.709 ms | 52.740 / 7.075 ms | 13,491 B |
| 1,000 | 74.221 / 69.560 ms | 216.115 / 13.813 ms | 135,891 B |
| 10,000 | 882.320 / 892.496 ms | 1,925.297 / 13.883 ms | 1,377,891 B |

10,000 文件时主线程最大观测延迟下降约 98.4%，但完整扫描墙钟耗时上升约 118%，O6 当前进程扫描期间观测 RSS 为约 125.6 MiB。RSS 包含整个 Node/Worker 及缓存，不能当作算法独占内存。10,000 文件 SQLite 基线写入中位 5.474 ms；Run 前后都仍完整扫描，1,377,891 B 基线尚未压缩。O4-B 缓存/增量哈希/清理未获实施授权，也未做。

## Request 空闲成本与 Activity

`scripts/bench/o5-request-cost.mjs` 的临时 SQLite 模拟 59.999 秒无外部事件：空闲旧定时器约 60 次/120 SQL prepare，O5 为 2 次/6 SQL prepare；1 条待处理 Request 且收件者忙时旧约 60 次/420 SQL prepare，O5 为 4 次/32 SQL prepare。每次新 tick 增加一次 `COUNT/MIN(deadline_at)`，但事件唤醒、30 秒空闲/15 秒待处理兜底与精确截止时间减少无意义 tick。该数字是**模拟调度器**，不是桌面 Host 的 60 秒 CPU 遥测。`test/unit/o5-activity-pagination.test.mjs` 验证 20,000 条按 400 页×50 条无重漏且 facets 只计算一次；这不是 400 页 GUI 耗时测量。

## 正确性、未测量与结论

- R1–R3 鉴权/作用域/Evidence、R5 Activity、R6 Worker 选择和 schema v9、R7 强制验证/风险入口，以及 O1–O5 组件与 Host 反向测试仍在完整自动化套件中；O6 最终退出码与计数见 `O6_COMPLETION_REPORT.md`。
- 没有可信的订阅制模型 Token/费用计数，不填估算值；O1–O5 的 Panel/定时器刷新逻辑不直接调用 LLM。
- 未测已认证 Panel 总览 HTTP RTT、中型真实 Worker Run 的前后扫描时间、真实 GUI 切页/窗口隐藏行为、长期 Host CPU/RSS、Activity “加载更多” GUI 耗时与外部 CLI/worktree 配对。不能把本机合成 fixture 或未认证 401 路由当成这些真机结果。
- 实际收益集中在**减少数据库全量构造与主线程阻塞、降低闲时查询频率**。代价是完整文件扫描总墙钟时间和扫描期间内存可能升高；该权衡未被掩盖。
