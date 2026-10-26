# O1 阶段完成报告

## 环境

- Git HEAD / Branch / 变更前基线：`8c2797e3a961696f1251958043de8caf260fd906` / `main`；开始时 `git status --short` 为空。O0 基线已存在并通过核对。
- DeepSeek Harness / OS / Node：已安装 Harness `0.2.1-rc.2`，Windows 11，Node `v24.15.0`；插件包仍为 `0.6.1`，数据库 schema 仍为 `9`。
- 未提交用户改动保护：改动前将 `client.js`、旧集成测试原样保存于 `D:\GPT-workspace\_backups\atcp-o1-20261026-160610`；没有重置分支、修改生产数据库或工作区。

## 完成内容

- 针对问题：UI-01（总览缺少“谁在做什么”）、UI-02（跨项目待办只切页签，不切 Project），以及 O1 的状态分类与小屏布局要求。
- 修改文件：`client.js`、`test/integration/phase5-taskflow-e2e.test.mjs`；新增 `test/unit/o1-dashboard.test.mjs`、`docs/optimization-o1-data.json` 和本报告。
- 总览改为当前项目 Mission/有效 Task 进度 → 活动团队 Agent/Task/Provider → Human 待审批、PL/Reviewer 队列、阻塞/异常三组 → 最近活动。取消原先把 Request、Finding、普通等待直接混成“用户待处理 N 项”的数字。RUNNING/WAITING 映射只使用 Host 的 Agent `currentTaskId`、Run/Task 与 waiting reason；身份或任务无法确认时显示“当前任务未知”。`fork` 仅作为 Provider/启动方式呈现，实际模型未报告时不猜测。
- 跨项目待办、项目选择器现在共用一次目标 Project 快照读取：读取期间暂时隐藏旧项目操作并显示“正在切换”，确认 Host 返回目标 ID 后才一起提交 `selectedProjectId`、Snapshot、目标页签。读取失败或返回错误 Project 时保留原项目。请求序号阻止晚到的旧项目轮询覆盖新项目；切换/操作期间停用活跃 Run 轮询。按钮有目标语义和 busy/切换禁用态。
- 保留兼容：六页签、Harness 左侧栏已有 PL Session、创建失败时原重试入口、全部 R1–R7 Host 鉴权/验证/风险门禁不变；本阶段没有创建新的 PL Session 或发出模型调用。

## 验收与证据

- `node --test test/unit/o1-dashboard.test.mjs`：6/6，通过，退出码 0。覆盖 A→B Charter 审批身份与提交 `projectId=B`、切换加载态、失败回退、错误 Project 响应、A 旧轮询晚到、RUNNING/WAITING/IDLE/REPLACED/PL/Reviewer 状态、真实进度与分组、已停止项目历史不误报待办、打开总览不创建 Session。
- `npm test`：112/112，通过，0 fail/skip，退出码 0；`npm run test:demo`：2/2，通过，退出码 0；`npm run pack:check`：23 文件 dry run，通过，退出码 0。
- 原 R5 静态测试中旧 `dashboard-pending-approvals` 选择器随 O1 的分组设计更新为 `dashboard-human-queue`；六页签、无重复 PL 入口等原断言仍保留，没有删除门禁测试。
- 性能实测：再次用 O0 的隔离 fixture 运行 `node --expose-gc scripts/bench/optimization-baseline.mjs`，退出码 0。L 档 full Snapshot 为 44.903 ms / 531 次 SQL prepare（O0：44.352 ms / 531）；PL 默认状态为 57.591 ms / 533 次（O0：55.398 ms / 533）；10,000 文件扫描 734.564 ms（O0：723.928 ms）。原始数据在 `docs/optimization-o1-data.json`。O1 没有改动这些 Host 路径，差异属于运行波动，**不申报性能提升**。实际 Panel 切页耗时、1280×720 像素布局和真实 Harness GUI 未测。
- 来源界限：新增交互测试使用本地伪 React/Host fetch 驱动真实 `client.js` 组件逻辑；不是 Desktop GUI 测试，也没有真实模型调用。

## 未完成、风险、回滚

- 待真机验收：双 Project 的实际桌面跨项目导航、1280×720 窗口首屏、按钮可点击区域与长名称换行。此项属于 O6 真机清单，本阶段仅有组件测试与样式静态核验。
- O1 继续读取旧 full Snapshot；O3 的轻量 API、O4 的扫描优化、O5 的刷新策略未提前实施。短时间内跨项目切换会再触发一次当前项目 GET，属于既有选中项目 effect 的刷新；没有增加 LLM 调用。
- 安全边界与数据库迁移：无 Host 业务门禁改动、无新依赖、无数据库迁移或生产 DB 写入。
- 回滚：可从上述备份恢复 `client.js`/原集成测试并删除本阶段新增文件；提交后可用非强制 `git revert` 撤销 O1 提交。Profile 仍运行上阶段安装包，无需数据库回滚。

## 阶段验收申请

- 满足本阶段验收：**YES（代码和自动化）；桌面 GUI / 1280×720 视觉：PENDING**。
- 下阶段建议：O2 收起 Task/审批技术历史并隔离每条 Request/Review 草稿。**按优化任务书，O1 完成后不自动实施 O2，等待 Human 明确批准。**
