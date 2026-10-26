# O5 刷新、Activity 与后台空闲成本验收（2026-10-26）

范围：按 `Agent_Team_Control_Plane_v0.6.1_UI_and_Performance_Optimization_Plan.md` 的 O5 实施；依赖 O3 的摘要 API。未启动 O6，也未引入事件总线、LLM 唤醒、数据库迁移或新依赖。

## 实施

- Panel 保持 O3 的 `view=overview` 摘要读取；初次进入只取一次。仅在当前 ACTIVE Project 有 Worker、Review、Request Run 或未结束 Request 时，每 3 秒轮询；隐藏窗口暂停，重新可见立即取一次。用户切页与手动“刷新”均触发摘要查询。相同 Project 的在途查询复用 Promise，后发/跨 Project 的旧结果被序号拒绝，避免 A 覆盖 B。
- Activity 延续 Host 的 keyset cursor 与每页 50 条。初次加载、筛选变化和明确点击“刷新”时获取 facets；“加载更多”及活动自动刷新不重复聚合。筛选/Project 切换时取消旧请求，并用序号与 Project ID 双重检查；卸载时取消请求并移除副作用。
- Request 后台调度从固定每秒扫描改为一个短生命周期 timer：启动/恢复后即时扫描，Request 创建与 Worker/Review/Request 运行释放 Agent 后唤醒，空闲 30 秒兜底，有待处理 Request 时 15 秒兜底；若截止时间更近，则按最近截止时间安排。最短 1 秒防止异常逾期记录形成紧密循环。唤醒合并，同一 tick 内唤醒不会丢失；Host 原有数据库幂等门禁继续防止重复 Request Run。
- 该机制只调用本地 Host/SQLite；刷新不启动 PL 或其他模型，因此没有新增 LLM Token 请求。

## 成本测量

Node v24.15.0 / Windows，临时 SQLite 合成夹具（10 Task、20 Run、200 Activity），脚本 `scripts/bench/o5-request-cost.mjs`；原始结果 `docs/optimization-o5-before.json`、`docs/optimization-o5-after.json`。这是**定时器模拟与 SQLite 调用计数**，不是桌面 Host 真实运行 60 秒的遥测；单次执行耗时受机器负载影响，不用于宣称同次查询变快。

| 59.999 秒、无主动事件 | 旧固定 1 秒估算 | O5 模拟 |
| --- | ---: | ---: |
| 空闲定时回调 | 约 60 次 | 2 次 |
| 空闲 SQL prepare | 约 120 次 | 6 次 |
| 1 条待处理、收件者忙：定时回调 | 约 60 次 | 4 次 |
| 同场景 SQL prepare | 约 420 次 | 32 次 |

旧路径 1000 次 tick：空闲 2000 次 SQL prepare，待处理 7000 次；O5 仍保留原有派发/超时逻辑，每次 tick 另加一次轻量的 `COUNT/MIN(deadline_at)` 查询。节省来自大幅减少无事件 tick，而非声称单次 tick 加速。原始计时分别为旧 17.039/140.877 ms、O5 29.313/256.305 ms（空闲/待处理 1000 tick），存在跨运行噪声；不得直接比较为速度回归或提升。

## 正确性验证

- `test/unit/o1-dashboard.test.mjs`：空闲不持续轮询；仅 Review/Request（无 Worker）可刷新；隐藏/恢复；A/B 乱序；Activity 末次筛选优先、旧 Project 不混入、facets 分页不重复。
- `test/unit/o5-activity-pagination.test.mjs`：20,000 条连续 400 页×50，ID 不重复、不遗漏，facets 只执行一次；筛选后翻页不再聚合。
- `test/unit/o5-request-scheduler.test.mjs`、`test/integration/phase4-governance.test.mjs`：闲时节流、临近截止时间、接收者释放立即唤醒、同时唤醒不重复、真实状态机只启动一个 Request Run。
- 完整 `npm test`：**150/150 通过，退出码 0**；`npm run test:demo`：**2/2 通过，退出码 0**；`npm run pack:check`：**25 个包内文件，退出码 0**。`node --check`（Client、Host、Scheduler）及 `git diff --check` 均退出码 0。完整输出保存在 `D:\GPT-workspace\_backups\atcp-o5-20261026-210200`。

源码编辑前的逐文件快照亦在该备份目录。此报告只记录自动化与模拟测量；真实桌面已认证点击、窗口隐藏行为及长期 Host 资源监测属于 O6 验收，目前未完成，不标记为通过。O4-B 仍未实施。
