# R0–R5 复核与补漏记录（2026-10-23）

## 复核基线

- 仓库：`D:\GPT-workspace\dsh-agent-team-control-plane`
- Branch / 起始 HEAD：`main` / `19441e0eab43bb648daa805baf3da8c7fb05830f`
- 复核前工作区：clean
- 统一要求：`Agent_Team_Control_Plane_Unified_Remediation_and_Panel_Plan_v0.6-1.md`
- 阅读范围：R0–R5 完成报告、兼容性/信任边界文档、README/Architecture/Installation/Testing、Host 源码、Panel 与全部测试。

## 阶段结论

| 阶段 | 复核结论 | 处理 |
|---|---|---|
| R0 | 调查材料与代码基线相符；`openSession` 已被 R0 证明支持，但后续 R3 报告错误地写成未确认 | 保留 R0 证据；以 R3 更正和当前实现消除矛盾 |
| R1 | admission、owner clamp、PL Session/Project 绑定、权限 prune、命令白名单和 Decision 权限反测存在且通过 | 移除 Panel 自由输入 Owner ID，继续只信 Host principal |
| R2 | 核心 diff/review gate 通过；报告明确遗漏 symlink/junction 真机反测，且 artifact canonical path 确有逃逸缺口 | 补 canonical path 校验、链接变更 FAILED evidence 和 Windows junction 反测 |
| R3 | 超时/失联收敛和终态防复活通过；Panel 没有使用已验证的 `openSession`，新 Session 绑定存在 submit 竞态 | 改为打开既有 Session；新 Session 先 bind 后 submit；增加可执行 Panel harness 测试 |
| R4 | Human 报告证明主要真实流程跑通，但报告自身仍列出卸载重装、SQLite 恢复和验收 Project 收尾遗留 | 不改写成已完成；继续列为真机运维遗留 |
| R5 | 原实现只有 Dashboard 增量，错误形成 7 页签；Decision、Activity 分页、Runtime 首屏语义和 Session 导航未完成 | 按任务书补为精确 6 页签及完整 R5 查询/UI/测试；旧 R5 报告被修订版取代 |

## 已补齐的可验证差异

1. **Panel 契约**：精确六页签；旧 PL 工作台、说明文字和重复入口已删除。
2. **PL Session**：绑定 Project 直接走 Host `openSession`；创建路径 bind-before-submit；重复进入不创建新 Session。
3. **身份**：Panel 不再接受自由文本 Owner ID。
4. **Runtime**：Provider、启动方式、实际模型分别展示；未知模型不猜测。
5. **Decision**：从审批移到项目决策记录，并保留 Human-only Charter 变更边界。
6. **Activity**：schema 8、结构化 Task 关联、项目隔离、50 条 keyset 分页、Agent/类型/Task 筛选、Load More、复合索引；snapshot 只返回最近 10 条。
7. **性能/刷新**：Activity 不再依赖前端加载全表；仅活动 Run 触发 3 秒状态刷新，隐藏窗口跳过。
8. **文件边界**：artifact 与实际 diff 都拒绝 symlink/junction 逃逸。
9. **文档一致性**：README、Architecture、Installation、Testing、R2/R3/R5 报告已同步当前行为与 schema。
10. **Project 生命周期补漏（0.5.8）**：增加非 ACTIVE Project 的永久删除；删除完整控制面关系图但不触碰工作目录和 PL 会话，并补版本、Project ID、活动 Run、DAG 外键与 runtime parent 清理测试。

## 测试证据

| 检查 | 结果 |
|---|---|
| 首次基线 `npm test` | 89/89 通过；同时证明旧测试没有覆盖大部分 R5 要求 |
| 补漏及 Project 删除后 `npm test` | 96/96 通过 |
| `npm run test:demo` | 2/2 通过 |
| `npm run pack:check` | 通过，dry-run，不生成 tarball |
| Activity 大数据量 | 单项目 1,205 条 + 第二项目 31 条；50 条分页无重复/遗漏/串项目，组合筛选通过，查询计划命中复合索引 |
| Session Panel harness | 既有绑定只 `openSession`；新建顺序为 openWorkspace → 初始化 draft → bind → submit |
| 链接边界 | Windows junction 不遍历；外部目标 artifact 失败；范围内未申报 junction 也把 SUCCESS 降为 PARTIAL |

## 未冒充完成的事项

- 当前工作区构建尚未重新安装进用户的 Harness Profile，本轮没有新的 Desktop 截图证据。
- R4 的卸载/重装、SQLite 备份恢复、`PROJECT-CC8390A3` 最终状态需要在真实 Profile 中核对。
- 实际 PL/Worker Model ID 仍只能由目标 Session projection/Host 报告；没有报告时 UI 显示“未报告/未知”。
- Codex/Claude CLI 的本机存在不等于 Host Provider 已注册；当前代码不会把它们伪显示成可用 Runtime。

