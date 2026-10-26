# O2 阶段完成报告

## 范围与实现

- 依据 `Agent_Team_Control_Plane_v0.6.1_UI_and_Performance_Optimization_Plan.md` 的 O2，仅修改 TaskBoard、GovernancePanel、项目切换的组件身份以及 Host 复核风险门禁；未进入 O3 按需 Snapshot API。
- Task 页：默认显示任务摘要；创建 Task 和验证命令白名单各自默认折叠；Task 支持“进行中/等待/待审核/已验证/已取消或失败/全部”筛选，每页 30 条。停止/完成项目默认显示全部历史。技术 ID、scope、Result/Evidence、全部 Run 在每个 Task 的详情中按需渲染；展开后最新 Run 默认展开、旧 Run 折叠。旧 Task 取消、Worker 分配、失败 Run 的 PL 诊断与取消 Run 入口保留。
- 启动 Run 的按钮只在 READY 且已指派的 Task 上出现；没有已批准、已选择的验证命令时禁用，点击处理函数也不提交请求。Host 原有 R7 白名单门禁未放松。
- 审批页：按 Human 待处理/风险、PL/Reviewer 审核、待处理 Request、未关闭 Finding、待处理 Plan Check、折叠历史排序。历史内容只有打开详情时才渲染。
- Request 回复草稿按 `requestId`、退回原因按 `taskId`、Plan Check 备注按 `planCheckId` 隔离；提交成功只清理对应项，失败保留草稿。TaskBoard/GovernancePanel 以 Project ID 作为 React key，切换项目时重置草稿与运行命令选择。
- Owner 风险卡明确列出 PARTIAL、缺失的已验证 Host 命令证据、缺失引用、FAILED/未验证文件 Evidence；保留二次确认。Host `submitReview` 也按当前 Result 的真实证据复核，普通 PL 不可通过仅标记 `SUCCESS` 的缺失/失败 Evidence；只有 Human Owner 的显式 `acceptRisk` 可通过。

## 验证

- `node --check client.js`、`node --check src/host/governance.js`：通过。
- `npm test`：**117/117** 通过，0 fail/skip，退出码 0。新增 O2 组件交互测试覆盖两个 Request 草稿与清理、跨 Project 隔离、两个 Task 退回原因/Actor/ID、无验证命令的 Run 门禁及批准命令后提交、缺失/FAILED Evidence 风险按钮、80 Task 分页与 120 Run 的延迟详情；R1/R2/R7 既有门禁测试保留。
- `npm run test:demo`：**2/2** 通过，退出码 0；`npm run pack:check`：23 文件 dry-run 通过，退出码 0；`git diff --check` 通过。
- 新增测试以伪 React 树与模拟 Host 调用驱动真实 `client.js` 组件，验证请求载荷和局部状态；不是桌面 GUI 点击测试，不代表真实模型执行。

## 边界与回滚

- 改写前已备份 `client.js`、`src/host/governance.js`、R2/R7 测试于 `D:\GPT-workspace\_backups\atcp-o2-20261026-163209`。
- 无数据库迁移、无新增依赖。真实 Desktop 的 1280×720 布局与交互复核仍待 Computer Use 管道恢复，作为后续 O6 真机验收项；不能把组件测试称为 GUI 验收。
- O3 的轻量查询/全量 Snapshot 裁剪没有在 O2 实施。本阶段完成后停止，不自动进入 O3。

## 阶段结论

**O2 自动化与打包验收通过；Desktop 图形交互验收待复核。**
