# O2 桌面插件部署记录（2026-10-26）

- 来源代码提交：`349c774d1820f5f49f6f8ec6a73af47e4b445505`（已推送 `origin/main`），插件包版本仍为 `0.6.1`。
- Desktop profile：`D:\DeepSeekHarnessData\.dsh\profiles\desktop`；安装插件：`node_modules\@local\agent-team-control-plane`。
- 部署前关闭 DeepSeek Harness 进程，备份原插件、profile `package.json`、`pnpm-lock.yaml`、控制面 SQLite 主文件及 WAL/SHM 至 `D:\GPT-workspace\_backups\atcp-desktop-o2-20261026-164647`。停机时数据库主文件 SHA-256 为 `E0F0FBA34B7E1343D0FE770311A053B81A3DC1A64C40A58E50FA861ACEBEFC50`。
- 从已提交源码 `npm pack`，确认包内 `client.js` 与仓库源码 SHA-256 同为 `B1CCA73D030EF3A20B5351266094913FBEA0DA93D61AB373FE2565120B5CC921`；包内 `client.js` 和 `src/host/governance.js` 语法检查通过。替换插件目录后，profile Git pin 更新为 `#349c774`，lock 的 Git tarball 与 SHA-512 integrity 更新为该提交对应值；配置文件通过临时文件加原子替换写入。
- 重启后 DeepSeek Harness 进程已运行；安装目录 `client.js` SHA-256 仍为上述值。SQLite `PRAGMA integrity_check=ok`，`PROJECT-2A39AEAA` 仍为 `ACTIVE` v11；Host `runtime_scan` 于 `2026-10-26T08:48:44.861Z` 更新，三类 Run recovery 均为 0。控制面路由对未认证请求返回 HTTP 401 `UNAUTHENTICATED`，说明插件路由与 Host 接入已加载且未放宽鉴权。
- 真实 Desktop GUI 点击/布局验证：**PENDING**。Computer Use 原生管道不可用（`os error 2`）；没有将路由/组件测试冒充为 GUI 验收。O2 自动化结果见 `docs/O2_COMPLETION_REPORT.md`。

回滚：停用 Harness 后，从上述备份恢复插件目录与 profile 配置；项目数据库未迁移，不需要回滚 schema。此记录仅描述本次实际部署和验证，不包含 O3。
