# R2 完成报告

> **2026-10-23 复核补充**：原报告把符号链接/junction 反测列为遗留。后续 R0–R5 总复核已补齐：`verification.js` 现在对 workspace 与 artifact 执行 `realpath` 规范化并拒绝逃逸，`run-coordinator.js` 会把任务范围内新增/修改的链接同样记为 FAILED evidence；Windows junction 真机文件系统单元测试覆盖“禁止遍历外部目标”和“未申报链接也会把 SUCCESS 降为 PARTIAL”。因此下文该遗留项以本补充为准。

## 环境

```text
Branch: main
Base HEAD: 00bbcc2（R1 已提交并推送至 origin/main）
Package: @local/agent-team-control-plane@0.5.7
DeepSeek Harness Desktop: 0.2.1-rc.2
Host Node: 24.21.0
OS: Windows NT 10.0.26200.0
```

R0/R1 交付物原样保留，未执行 `git clean`。R2 改动为工作区变更，等待 Human 验收后再提交。

## 修改范围

### R2.1 Task 实际变更范围检查（封堵 E-01）

- `src/host/workspace-diff.js`（**新增**）：工作区文件事实的采集与比对模块。
  - `snapshotWorkspace(root)`：递归扫描工作区，返回 `Map<相对路径, { size, mtimeMs, sha256 }>`；符号链接/junction 以 `{ symlink, target }` 显式记录（不做目标哈希，避免逃逸）；排除 `.git` / `node_modules` / `.workbuddy` / `__pycache__` 以及 `.sqlite*` 数据库文件（数据库随状态变化，不是交付物）。
  - `diffWorkspace(before, after)`：对比两次快照，产出 `added / modified / deleted / unchanged` 四类路径列表。
  - `classifyWorkspaceChanges(root, diff, scope)`：把每一条实际变更对照 Task `scope.allowed` / `scope.forbidden` 分类为 `inScope / outOfScope / forbidden`。
- `src/host/verification.js`：导出 `pathMatchesScope()`，供范围分类复用（与既有 `inAllowedScope` 同源）。
- `src/host/run-coordinator.js`：
  - `startTaskRun()` 在 write Run 启动前对工作区做可信基线快照，写入 `task_runs.workspace_baseline_json`。
  - `auditWorkspace()` 在 Run 结束后重新扫描并 diff 实际变更集；`persistTerminal()` 把 forbidden / out-of-scope 路径生成为 `FAILED` evidence（`kind: FILE`），并把 `SUCCESS` 降级为 `PARTIAL`，同时写入 `unresolved` 与 `task_runs.workspace_diff_json`。
  - 构造函数注入 `workspaceSnapshooter / workspaceDiffer / workspaceClassifier`，便于测试隔离。
- `src/host/store.js`：schema v6→v7；`task_runs` 新增 `workspace_baseline_json`、`workspace_diff_json` 两列；`mapTaskRun` 返回 `workspaceBaseline` / `workspaceDiff`。

### R2.2 Review 合法性（封堵 E-02）

- `src/host/governance.js` `submitReview()`：
  - 新增 Result 存在性校验（`RESULT_NOT_FOUND`）。
  - 新增 Review 证据引用必须属于**当前 Result**（`REVIEW_EVIDENCE_INVALID`）。
  - 新增"Host 验证不完整"门槛：`result.outcome !== 'SUCCESS'` 或存在 `FAILED` evidence 时，PL/Reviewer 的 `APPROVE` 默认拒绝（`VERIFICATION_INCOMPLETE`）；仅 Human Owner 显式传 `acceptRisk: true` 才能接受"未完全验证交付"，此时 Task 状态事件 reason 标记为 `Human-accepted unverified risk`，与"通过技术验证"严格区分。
  - `verifyTask()` 增加 `riskAccepted` 参数，事件与 activity 区分两类事实。
- `src/host/control-plane.js` `transitionTask()` 的 `VERIFIED` 分支：新增完整证据门槛——Result 必须存在且 `outcome === 'SUCCESS'`、无 `FAILED` evidence、引用 evidence 必须属于当前 Result（`RESULT_NOT_FOUND` / `VERIFICATION_INCOMPLETE` / `REVIEW_EVIDENCE_INVALID`），封堵直达 VERIFIED 绕过治理的路径。

### R2.3 审核与协助的只读边界（封堵 E-03）

- `src/host/governance.js`：
  - `requestIndependentReview()` 在启动独立评审前检查工作区写锁（`workspace_locks`），有活跃 write Run 时拒绝（`WORKSPACE_BUSY`），避免 Reviewer 读到 Worker 写一半的状态。
  - `executeReviewRun()` 在评审 Run 前后做工作区快照比对（`detectReviewerWrites()`），Reviewer 意外写入任何文件时评审 Run 以 `FAILED` / `REVIEW_WRITE_DETECTED` 终止，不提交 Review、不进入 VERIFIED。此检测为**后验检测**，不声称强隔离，仅阻止意外写入被当作正常评审通过。
  - 构造函数注入 `workspaceSnapshooter / workspaceDiffer`。

### 测试

- `test/unit/r2-evidence-gates.test.mjs`（**新增**）：11 项反向测试，覆盖 R2 验收全部 5 条。
- `test/integration/phase2-workflow.test.mjs`：`transitionTask` 到 VERIFIED 现在要求真实 Result，新增 `seedVerifiedResult()` helper 构造完整 Result + Evidence + Run，保持 DAG 依赖测试语义不变。

## 验收证据

```text
npm test            81/81 passed（原 70 + 新增 11）
npm run test:demo   2/2 passed
npm run pack:check  passed（23 files，含新增 workspace-diff.js）
```

R2 反向测试逐项：

| 验收要求 | 测试 | 结果 |
|---|---|---|
| Worker 报告合法文件但暗改禁区文件 → 不能 VERIFIED | `R2.1 forbidden` | PARTIAL + FAILED evidence |
| Worker 新建越界/未跟踪文件 → 标记 | `R2.1 out-of-scope` | PARTIAL + FAILED evidence |
| Host 测试失败 + PL APPROVE → 默认拒绝 | `R2.2 PARTIAL + PL APPROVE` | VERIFICATION_INCOMPLETE |
| 仅 Human 可显式接受未验证风险 | `R2.2 acceptRisk` | 区分 risk-accepted |
| transitionTask 不能绕过 Result/Evidence 直达 VERIFIED | `R2.2 transition` | RESULT_NOT_FOUND / VERIFICATION_INCOMPLETE |
| CRITICAL 需独立 Reviewer，PL 不能跳过 | `R2.2 REVIEWER_PL` | REVIEWER_APPROVAL_REQUIRED |
| Reviewer 不能审自己 | `R2.2 self-review` | SELF_REVIEW_FORBIDDEN |
| 只读 Reviewer 改文件被阻止 | `R2.3 readonly` | REVIEW_WRITE_DETECTED |
| 快照排除结构目录与数据库文件 | 单元测试 | 通过 |
| diff 识别增/改/删 | 单元测试 | 通过 |

真实 Host 集成未执行（本阶段为证据反向测试，使用临时隔离 SQLite 与 mock 适配器）；`UNKNOWN` 项未用 mock 结果宣称通过。

## 安全边界验证

- 修复风险编号：**E-01**（Task 实际变更范围）、**E-02**（Review 合法性）、**E-03**（Reviewer 只读边界）。
- 反向测试证据：见上表（`test/unit/r2-evidence-gates.test.mjs`）。
- 新增权限/命令/依赖：**无**。无新增 npm 依赖，无新增后台轮询，无新增磁盘存储（仅 task_runs 表新增两列 JSON）。
- 数据库迁移为纯增量（`ALTER TABLE ADD COLUMN`），不可逆风险低；prune-only 权限迁移（R1）保持不变。

## 未完成事项与风险

- **符号链接/junction 边界校验**：快照会记录 symlink 并跳过目标哈希，但本机测试环境无法可靠创建符号链接（无管理员权限），symlink 记录的单元断言以"排除目录/数据库文件"替代覆盖；Windows 大小写/UNC 路径的专门用例未在 mock 层验证，留待 R4 真机验证。
- **后验检测的局限**：`detectReviewerWrites()` 只能检测、不能阻止写入副作用，任务书明确不谎称强隔离；强只读需依赖宿主只读运行能力（R0 未证实支持）。
- **接受风险的例外**：`acceptRisk` 机制已实现为 Human-only 显式标记，但尚未接入 Panel UI；是否需要在 UI 暴露"接受风险"入口由 Human 决定。
- 真实 Harness Desktop 上未执行 R2 相关冒烟（属 R4 范围）。

## 下一阶段建议

- 是否满足本阶段验收：**YES**（证据反向测试 11/11，全量回归 81/81）。
- 建议接下来进入 **R3**（运行异常、状态一致性与 PL Session）：超时收敛、Project 级 Session 绑定/恢复、真实模型一致性；R2 建立的"实际变更集 + 证据门槛 + 只读检测"边界不应回改，如需调整须同步更新 `r2-evidence-gates.test.mjs` 对应反向测试。
- 未经 Human 验收不自动开始 R3。
