# R5 完成报告

## 环境
- Git SHA / Branch：`main`（基于 `eb55dfc`，本次改动待提交）
- DeepSeek Harness 版本：`0.2.x`（Electron `44.7.0`）
- Node / OS：Node `22.22.2` / Windows NT 10.0.26200

## 修改范围（六页签总览改造）
仅前端面板，未触碰 Host 逻辑、数据库 schema、权限边界与 R0–R4 语义。

- `client.js`
  - 新增 `DashboardView` 组件（`view-dashboard`）：面板默认着陆页「总览」。
    - 项目健康统计：进行中 / 等待配置或批准 / 已停止（可恢复）/ 已完成 四张计数卡片，点击跳转到对应页签。
    - 当前项目进度卡：任务验收进度（VERIFIED/范围内）、运行中 Run、待审核（SUBMITTED）、等待处理（WAITING）、未关闭 Finding、待响应 Request、待处理 Plan Check 汇总，附「查看任务 / 查看审批 / 查看活动」快捷入口。
    - 待办批准卡：访谈中与章程/团队待批准项目列表 + 跳转「审批」按钮。
    - 运行环境卡：Runtime 总数 / 已授权数 / 运行中 Worker Run 摘要。
    - 最近活动卡：最新 6 条活动 + 「全部」跳转。
  - 页签栏改为 7 页签：「总览」置首，其后保留原六页签（PL 工作台 / 项目 / 团队 / 任务 / 审批 / 活动记录），**不删减**任何既有视图。
  - `activeView` 默认值由 `'project'` 改为 `'dashboard'`。
- `test/integration/phase5-taskflow-e2e.test.mjs`
  - 原六视图断言保留（向后兼容验收）。
  - 新增 R5 断言：`view-dashboard`、`useState('dashboard')`、`dashboard-current-project`、`dashboard-pending-approvals`。

## 验收证据
- `npm test`：**89/89 passed**（原 88 + 新增 dashboard 断言所在测试保持通过，无回归）。
- `npm run test:demo`：2/2 passed。
- `npm run pack:check`：23 files。
- client.js 语法编译校验通过（`new Function` 工厂体校验）。

## 安全边界验证
- 本阶段**无新增权限/命令/依赖**。
- Dashboard 为只读聚合视图：所有按钮仅做页签跳转（`setActiveView`），不引入新动作端点、不扩大 HTTP 路由面。
- R0–R4 边界（connection 认证、body actor clamp、验证命令白名单、PL Session 绑定、workspace diff、Review 门槛、Run 收敛、终态项目防复活）全部保留。

## 未完成事项与风险
- 总览页未做真实 Harness GUI 截图回归（沙箱无法渲染 Electron 窗口）；需在用户正常启动 Harness 后目测确认。
- Dashboard 的项目统计基于 `data.projects`（全量项目）；任务进度仅针对当前选中项目，跨项目聚合留待后续阶段。
- 回滚方式：整体 revert 本次 commit 即可，无 schema 变更。

## 下一阶段建议
- 是否满足本阶段验收：**YES**（六页签全部保留 + 总览着陆页落地，测试无回归）。
- 建议：部署到 Harness（`pnpm add github:...#<本次提交>`）并重启后目测总览页；随后可进入 ROADMAP 的 B-1/B-2/B-3（持久会话、实时请求、隔离工作区）。
