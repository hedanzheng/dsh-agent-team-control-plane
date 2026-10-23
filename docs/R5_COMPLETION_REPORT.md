# R5 完成报告（2026-10-23 复核修订版）

## 环境

- Git / Branch：`main`，复核起点 `19441e0eab43bb648daa805baf3da8c7fb05830f`；本报告对应其后的待验收工作区修订。
- 任务基线：`Agent_Team_Control_Plane_Unified_Remediation_and_Panel_Plan_v0.6-1.md`。
- DeepSeek Harness 兼容基线：Desktop `0.2.1-rc.2`；公开 Client API `ctx.uiWorkspace.openSession/openWorkspace`。
- 包版本保持 `@local/agent-team-control-plane@0.5.7`；没有新增第三方依赖。

## 复核发现

旧版 R5 报告把“总览”加在原六页签之前，实际形成 **7 页签**，并明确保留“PL 工作台”；这与任务书“总览替换 PL 工作台，最终仍为六页签”直接冲突。旧版同时没有实现 Decision 迁移、Activity 服务端分页/筛选/索引、既有 PL Session 导航、Runtime 首屏语义和大数据量测试。因此旧报告的 `YES` 结论撤销，由本修订版取代。

## 修改范围

### Panel 六页签与总览

- `client.js` 固定为六页签：**总览、项目、团队、任务、审批、活动**。
- 删除旧 `PL 工作台` 视图、长篇说明和两处重复的“打开/创建 PL 对话”入口。
- 总览展示当前 Project 名称、状态、目标、里程碑、验收进度、工作中 Agent、运行中 Run、待审核/等待 Task、Finding、Request、Plan Check、Runtime 与最近 6 条活动。
- Header 只在 Project 已绑定 Session 时显示一处“返回 PL 对话”；创建失败时项目页仅显示条件式“重试创建 PL 对话”。

### Project / Session

- 移除可编辑 Human Owner ID；负责人身份由 Host admission 确定，Panel 只读展示 Project 记录。
- 已绑定 Project 调用 `ctx.uiWorkspace.openSession(plSessionId)`，不再只提示用户自己找左侧栏，也不重复创建 Session。
- 新建 Session 时先完成 `bind-project-pl-session`，成功后才提交首条 PL prompt；绑定失败不会让尚未授权的 PL 抢先调用工具。
- 创建 Project 后重新读取刚创建的 Project 状态，确保 Panel 立即看到持久化的 Session 绑定。

### Runtime / Team

- 团队首屏直接显示 Agent 名称、角色、状态、当前 Task、真实 Provider 和来源。
- Worker 明确显示 `fork` / `spawn` 为启动方式而非模型；没有 Session projection 时统一显示“实际模型：未报告/未知”，不把可用模型目录冒充实际选择。
- 替换历史保留为默认折叠的审计记录，说明旧身份不占团队名额且不会再次运行。

### Decision

- Decision 历史与录入从“审批”移到“项目→项目决策记录”。
- UI 显式区分普通技术决策与 Mission/Scope/Constraints 影响；所有录入走已认证 Human Owner，继续受 R1 的服务端权限检查保护。

### Activity 与数据库

- schema `7 → 8`：`activities.task_id` 保存可由 Host 结构化解析的可靠 Task 关联。
- 新增 `(project_id, created_at DESC, id DESC)` 主分页索引，以及 Agent、类型、Task 过滤索引；旧数据仅在首次迁移时回填。
- 新增 authenticated GET Activity 查询：严格按 Project，默认 50、最大 100，使用 `(created_at,id)` 稳定 keyset cursor；支持 Agent、事件类型和可靠 Task 过滤。
- 普通 snapshot 只携带最近 10 条 Overview tail，不再为 Activity 页把全表送到浏览器。
- Activity UI 提供刷新、筛选、加载更多、中文摘要和折叠技术原文；切换 Project 清空游标与结果。
- 状态轮询仅在存在活动 Worker Run 时启用，窗口隐藏时跳过，间隔由 1 秒降为 3 秒；无活动 Run 时不轮询。

### R2 复核补漏

- Artifact 验证使用 canonical `realpath` 检查嵌套 symlink/junction，拒绝解析到 workspace 外的文件。
- workspace diff 对任务允许范围内新建/修改的链接也产生 FAILED evidence，防止 Worker 通过“允许目录中的链接”绕过范围检查。

## 自动化验收

- `npm test`：95/95 通过，0 fail/skip/cancel。
- `npm run test:demo`：2/2 通过。
- `npm run pack:check`：通过，未生成 tarball。
- 新增的关键反测：
  1. 六页签集合精确匹配，旧 PL 工作台和重复按钮不存在；
  2. 绑定 Session 只调用 `openSession`，不调用 `openWorkspace`；
  3. 新 Session 的 bind 严格发生在 prompt submit 之前；
  4. 两个 Project 活动隔离，1,205 条事件以 50 条 keyset 页读完且无重复/遗漏；
  5. Agent/类型/Task 组合筛选只返回匹配记录；
  6. `EXPLAIN QUERY PLAN` 使用 `activities_project_created_id`；
  7. Windows junction 不被递归读取，嵌套 artifact 逃逸被拒绝，未申报链接让 Result 降为 PARTIAL。

## 证据边界与剩余真机项

- 本次结果是源码、真实 Windows 文件系统、SQLite 与自动化 Panel harness 证据；没有把 mock Provider 当成已注册的 Codex/Claude。
- 本回合没有重装已部署插件，也没有操作用户生产数据库；schema 8 迁移在隔离临时库验证。
- 仍需在安装当前工作区构建后执行一次 Harness Desktop 真机 UI 冒烟：六页签导航、返回既有 PL Session、Activity 加载更多与筛选。该项完成前，**代码/自动化验收为 YES，部署真机验收为 PENDING**。
- R4 旧报告中的“插件卸载重装、SQLite 备份恢复、验收 Project 最终收尾”仍是独立的真机运维遗留，不能由本次单元测试代替。
