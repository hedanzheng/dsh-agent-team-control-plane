# O6 交付与桌面验收记录（2026-10-26）

## 环境与版本

- O6 起点为 `main` @ `68b6cc1dcac893a49202c673e85de5d7f8690f4a`，开始时工作树干净；此前 O0–O5 分阶段提交均保留在 Git 历史。O6 仅补文档、合成复测与桌面安装记录，没有改 Host/Panel 业务代码。
- Windows 11，Node `v24.15.0`，npm `11.12.1`，DeepSeek Harness Desktop `0.2.1-rc.2`；插件仍为 `@local/agent-team-control-plane@0.6.1`，schema v9。由于真实 GUI Human 验收未完成，本轮**不发布稳定 tag、不提升包版本**；精确代码由 O5 Git pin `68b6cc1` 标识，不以任务书文件名 `v0.6.1` 推断包版本。
- 已安装的 O5 插件及完整回滚材料见 `O5_DESKTOP_DEPLOYMENT.md`；数据库升级前备份已完成，实际并无 schema 更改或数据重置。

## 自动化门槛

| 命令 | 结果 | 退出码 |
| --- | --- | ---: |
| `npm test` | 150 pass / 0 fail / 0 skipped；包含 O1–O5 新用例 | 0 |
| `npm run test:demo` | 2 pass / 0 fail / 0 skipped | 0 |
| `npm run pack:check` | 25 个包内文件，dry run 成功 | 0 |
| `node --check client.js`、`node --check src/host/index.js`、`node --check src/host/request-scheduler.js` | 语法检查通过 | 全部 0 |
| `git diff --check` | 无空白错误 | 0 |
| `node --expose-gc scripts/bench/optimization-baseline.mjs` | S/M/L 合成 SQLite 与工作区复测完成 | 0 |
| `node --expose-gc scripts/bench/workspace-o4.mjs` | 100/1,000/10,000 文件异步扫描复测完成 | 0 |

完整测试输出在 `D:\GPT-workspace\_backups\atcp-desktop-o5-20261026-220000\o6-*.log`；复测数据见 `optimization-o6-final.json`、`optimization-o6-workspace.json` 和汇总 `optimization-results.md`。R1 `r1-auth-boundaries`、R2 `r2-evidence-gates`、R3 `r3-recovery-consistency`、R5 `r5-panel-*`、R6 `r6-worker-runtime`、R7 `r7-recovery-ux` 测试文件仍在完整套件中且未跳过；另含 O1–O5 全部新增反测。测试使用临时数据库/工作区，不代表真实桌面点击。

## 已执行的桌面 Host 冒烟

O5 Profile 安装后启动 5 个 DSH 进程。安装目录的 `client.js`、`request-scheduler.js` SHA-256 与源码相同；Profile pin、lock 完整提交 SHA 与 codeload integrity 经逐项核对。运行中 Host 监听动态端口 `127.0.0.1:40423`；插件 GET 路由的未认证请求返回 `401 UNAUTHENTICATED`，表明路由与 R1 admission 启动。只读 SQLite：`PRAGMA integrity_check=ok`、schema v9、Project 数量 1。Host 缓存的 `runtime_sources` 只有 `harness:a6api`、`harness:deepseek-account`、`harness:deepseek-official` 与 `subagent:fork/spawn`；无 Codex/Claude Provider 记录。`fork/spawn` 是 Worker 启动方式，不据此声称独立模型已接入。

## Human 真机清单

| 任务书项目 | 状态 | 已有证据 / 缺口 |
| --- | --- | --- |
| 1. 双 Project、B 待审批、从总览进入 B | **PENDING** | O1 自动化验证身份切换及乱序；生产库仅 1 个 Project，未新建测试项目 |
| 2. Harness 左侧栏继续真实 PL Session，切页不创建会话 | **PENDING** | O1/R5 组件和会话绑定测试通过；未进行实际 GUI 点击 |
| 3. 已授权 Worker Run 与总览/Evidence 同步 | **PENDING** | 集成状态机测试通过；未对用户现有 Project 启动 Run |
| 4. Task/Run/Evidence、验证命令、取消、风险接受入口 | **PENDING** | R2/R7 自动化门禁通过；未实际点击控制台 |
| 5. 两 Request 与两待审 Task 草稿隔离 | **PENDING** | O2 组件测试通过；未实际 GUI 输入 |
| 6. 跨项目 Activity 筛选/加载更多无混入 | **PENDING** | R5/O5 20,000 条合成分页及跨项目测试通过；未实际 GUI 操作 |
| 7. 中型非敏感工作区真实 Run、扫描/切页、Worktree/CLI 注册 | **PENDING** | 仅本机合成扫描；未运行真实 Worker 或确认外部 CLI/worktree 配对 |
| 8. 外部 Codex/Claude 未注册时如实显示 | **PARTIAL** | Host SQLite 只读 runtime 源中无此 Provider，代码/测试不将 `fork/spawn` 冒充模型；Panel 实际显示未目视核验 |

按官方 Computer Use 初始化步骤尝试读取 DSH 窗口，原生管道返回 `系统找不到指定的文件 (os error 2)`。因此没有生成或假称任何真实 GUI 截图/点击结果；401、数据库、自动化不能替代以上 `PENDING` 项。

## 发布、未完成事项与回滚

- 阶段提交：O0 [`8c2797e`](https://github.com/hedanzheng/dsh-agent-team-control-plane/commit/8c2797e)、O1 [`c967745`](https://github.com/hedanzheng/dsh-agent-team-control-plane/commit/c967745)、O2 [`349c774`](https://github.com/hedanzheng/dsh-agent-team-control-plane/commit/349c774)、O3 [`7dfd1d4`](https://github.com/hedanzheng/dsh-agent-team-control-plane/commit/7dfd1d4)、O4-A [`9f6965e`](https://github.com/hedanzheng/dsh-agent-team-control-plane/commit/9f6965e)（桌面修正 [`7b8275f`](https://github.com/hedanzheng/dsh-agent-team-control-plane/commit/7b8275f)）、O5 [`68b6cc1`](https://github.com/hedanzheng/dsh-agent-team-control-plane/commit/68b6cc1)。O6 本轮修改文件：`README.md`、`README.zh-CN.md`、`CHANGELOG.md`、`docs/TESTING.md`、`docs/O5_DESKTOP_DEPLOYMENT.md`、本报告、`docs/optimization-results.md`、两份 `optimization-o6-*.json`。最终文档提交 SHA 以本阶段 Git 提交/交付回复为准；O5 桌面代码 pin 不随纯文档提交变化。
- `README.zh-CN.md`、`README.md`、`docs/TESTING.md`、`CHANGELOG.md` 已说明仅完成 O1–O5 的方案 A 优化、性能权衡与 GUI 待验收状态；未宣称方案 B、自动 Worktree/CLI 生命周期或未注册的模型 Provider。
- 发布包 dry run 成功，GitHub `main` 可作为 O1–O5 **候选交付**；因 Human 真机清单尚未完成，本阶段结论为 **PARTIAL**，不创建稳定 tag/GitHub Release，也不把候选说成最终桌面验收通过。
- 简明回滚：退出 DSH，将备份中的 `old-plugin-o4` 恢复至 Profile 插件目录，并恢复 `old-package.json`、`old-pnpm-lock.yaml`；若需要数据库回退，只能将同一次备份的主文件/WAL/SHM 作为一组恢复。保留当前数据是默认选择，未删除任何现有 Project/文件。
- 剩余 Human 操作是按上表在桌面端验收并记录结果。通过后再决定是否将兼容优化发布为新的 patch 版本与稳定 tag；失败则保留原始报错/截图定位修复。
