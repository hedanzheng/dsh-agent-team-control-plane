# O0 优化前基线（2026-10-26）

## 口径与环境

- 仓库 `main` @ `6be8616da14c50be39dab9ad5ffd98d0885fd366`；开始时 `git status --short` 为空，插件包版本 `0.6.1`。本阶段不修改业务实现或数据库 schema。
- Windows 11 家庭中文版、Node `v24.15.0`、npm `11.12.1`。Windows 卸载注册表显示已安装 DeepSeek Harness `0.2.1-rc.2`；Desktop Profile 的插件包为 `0.6.1`。生产控制面 SQLite **仅以只读连接**核对 `schema_meta=9`，未运行迁移/写入/采样其内容。
- 数据来源：`scripts/bench/optimization-baseline.mjs` 新建的临时 SQLite 与临时工作区；是**本机 Node/SQLite/Windows 文件系统实测，但数据为合成 fixture**。不是 Harness GUI 或真实 Worker Run 的耗时。原始数字见 `docs/optimization-baseline-data.json`。
- 每个指标预热 2 次，再测 5 次，表中为中位数；扫描同样预热 2 次、测 5 次。SQL 次数统计 `DatabaseSync.prepare()` 调用数，不代表 SQLite 内部执行步数。字节数是 UTF-8 JSON；PL 一栏按工具返回的文本计算，不重复 JSON 字符串转义。
- RSS 是同一基准进程在操作后采集的进程总驻留内存，经过显式 GC，但会受到前一规模 fixture 与 SQLite 缓存影响；**不是单次操作增量，也不是 Host 峰值内存**。同步扫描调用耗时代表基准进程的连续 JS 阻塞时段；未测真实 Host 事件循环延迟/CPU 峰值。

运行方法（不会读取真实 Project）：

```powershell
Set-Location 'D:\GPT-workspace\dsh-agent-team-control-plane'
node --expose-gc .\scripts\bench\optimization-baseline.mjs
```

脚本使用系统临时目录下的 `atcp-o0-bench-*` 独立实例，结束后验证路径并清理；不依赖/修改真实用户工作区、Profile 数据库或模型凭据。无新第三方依赖。

## 合成数据库规模

| 档位 | Task | Run / Result / Evidence / Verification | Activity | Review | Request / Response | Task 依赖 | SQLite + WAL bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| S | 10 | 20 / 20 / 20 / 20 | 200 | 5 | 2 / 2 | 9 | 1,186,568 |
| M | 100 | 300 / 300 / 300 / 300 | 5,000 | 75 | 20 / 20 | 99 | 8,941,080 |
| L | 500 | 2,000 / 2,000 / 2,000 / 2,000 | 20,000 | 500 | 100 / 100 | 499 | 34,648,944 |

每档另含正式 Project、Charter、PL/Worker/Reviewer、Task 状态事件及 Run 状态事件；Run 含基线/差分字段。因此不是只用空 Task 测速度。所有对象属于临时 `PROJECT-BENCH`。

## SQLite / PL 读取基线

表格单元为 `中位耗时 ms / SQL prepare 次数 / UTF-8 bytes`：

| 操作 | S | M | L |
|---|---:|---:|---:|
| `store.snapshot(projectId)` | 1.399 / 41 / 46,518 | 7.785 / 131 / 588,467 | 44.352 / 531 / 3,797,129 |
| PL 默认 `agent_team_project_state` | 1.449 / 43 / 7,516 | 7.959 / 133 / 52,381 | 55.398 / 533 / 254,894 |
| `store.listTasks(projectId)` | 0.191 / 11 / 4,376 | 1.219 / 101 / 43,896 | 6.258 / 501 / 221,484 |
| Activity 首次 50 条 keyset 页 | 0.170 / 1 / 12,282 | 0.169 / 1 / 12,533 | 0.203 / 1 / 12,784 |
| `activityFacets(projectId)` | 0.092 / 2 / 176 | 0.639 / 2 / 181 | 6.407 / 2 / 184 |

进程 RSS 中位数：`snapshot` S/M/L 为 44.9/54.2/92.5 MiB；PL 默认状态读取 S/M/L 为 45.0/57.3/114.3 MiB。数值仅说明这次**整进程**内存环境，不能归因为某个方法的独占开销。

解释：Activity 页本身已是有界查询，50 条首页的字节数/耗时在三档相近；但 `activityFacets()` 仍每次运行两个 `GROUP BY`。`listTasks()` 的查询数正好为 `Task 数 + 1`，符合逐 Task 查依赖的 N+1。PL 虽然输出文本比完整 Snapshot 小，实际先构建全量 Snapshot，所以其 533 次 SQL prepare 与 55.398 ms 随历史规模增长。**上述是优化机会，不是本阶段已实现的改善。**

## 同步工作区扫描基线

每个文件为 256 字节的本地合成文本；目录内每 100 文件分一层目录。测量 `snapshotWorkspace()` 完整调用与 `JSON.stringify([...snapshot])` 基线体积：

| 文件数 | 文件内容总量 | 中位耗时 | 单次基线 JSON | 测后进程 RSS 中位数 |
|---|---:|---:|---:|---:|
| 100 | 25,600 B | 9.326 ms | 13,491 B | 111.4 MiB |
| 1,000 | 256,000 B | 76.521 ms | 135,891 B | 111.5 MiB |
| 10,000 | 2,560,000 B | 723.928 ms | 1,377,891 B | 162.3 MiB |

扫描为同步递归、逐文件 `readFileSync` + SHA-256；本表不含第二次扫描、SQLite 持久化、Worker/Host 其他负载，也未测大文件、不可读文件与 junction 的性能。后续 O4 必须先补正确性反测，不能据此直接缓存或忽略工作区文件。

## 源码/UI 核验及已有能力

以下为**源码静态确认**，不是桌面手工 UI 测试：

1. `client.js:780-862` 总览已有当前 Project、任务进度、近期活动；但活动 Agent 只显示数量，活跃 Run 只列 ID，且 `needsAttention` 把 Finding、Request、待审 Task、跨项目批准混算。`client.js:845-849` 的跨项目按钮只调用 `onNavigate('approvals')`，没有切换 `selectedProjectId`；`client.js:1017` 的导航处理仅为页签状态。
2. `client.js:383-560` Task 创建表单、运行入口与技术历史同页；创建表单默认展开。`client.js:563-656` 审批历史优先渲染，`responseBody`/`reviewIssue` 是页面级共享草稿，不按 Request/Task 隔离。
3. `src/host/store.js:1117-1159` Snapshot 对 Activity 只取 10 条，但仍读全部 Task State Event、Run/Event、Result、Evidence、Verification、Request/Review 等；`src/host/pl-bridge.js:188-190` PL 默认状态先调用 full Snapshot。`src/host/store.js:995-998` 每个 Task 再查询依赖；`src/host/context-builder.js:13-34` 读全项目 Result/Request/Review 后筛选。
4. `src/host/control-plane.js:1095` Activity 每次取页都附 `activityFacets()`；`client.js:725-737` 加载更多时再次读取并设置 facets。`client.js:875-892` 有活动 Run 时每 3 秒读取完整 Snapshot，隐藏窗口跳过；`src/host/index.js:54-58` 每秒执行 Request 超时/派发检查。
5. 已存在并继续保留：六页签、Project 绑定单一 PL Session、已停止 Project 的历史查询/恢复、项目隔离的 Activity keyset 50 条分页、Runtime `fork/spawn` 与模型身份区分、R1–R3 鉴权/文件审计/验证门禁、R7 强制验证命令/Owner 风险入口/Request 回复/Task 取消。不能把它们再算作 O1–O5 的新优化成果。

## 自动测试、CI 与未测项

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `npm test` | 106 passed / 0 failed / 0 skipped | 0 |
| `npm run test:demo` | 2 passed / 0 failed / 0 skipped | 0 |
| `npm run pack:check` | 23 个打包文件，dry run 成功 | 0 |
| `node --expose-gc scripts/bench/optimization-baseline.mjs` | S/M/L 数据库与 100/1,000/10,000 文件全部跑完 | 0 |

仓库有 `.github/workflows/test.yml`（Windows + Node 24 的 `push`/`pull_request`），但本机无 `gh` CLI，GitHub Actions 状态接口经浏览工具不可达；**当前远端 CI 运行结论未核实**。没有运行桌面 GUI 测试、真实 Worker Run、HTTP 往返基准、Host 事件循环/CPU 峰值测量或准确 Token 计数；相应 O6 真机项为 `PENDING`，不能把合成基线写作 GUI 改善。

后续 O1 应先针对跨项目审批导航与总览状态语义补回归测试；O3/O4/O5 用同一脚本/fixture 复测，与本文口径对照。O0 本身**没有**运行效率优化后的结果。
