# O1 桌面插件部署记录（2026-10-26）

- 来源：`main` 提交 `c9677454d4ab16c43cf643be0d3c28d230be14a2`，包版本 `0.6.1`。
- 目标：`D:\DeepSeekHarnessData\.dsh\profiles\desktop\node_modules\@local\agent-team-control-plane`；DeepSeek Harness Desktop `0.2.1-rc.2`。
- 原插件、profile 的 `package.json`、`pnpm-lock.yaml` 与 SQLite 数据库/WAL/SHM 均备份在 `D:\GPT-workspace\_backups\atcp-desktop-o1-20261026-162447`。关闭旧进程后原子替换插件目录，再以隐藏窗口启动 Harness。
- profile 的插件 Git pin 和 lock integrity 已对齐 O1 提交；安装目录 `client.js` 与仓库来源 SHA-256 均为 `0270B33667E7CF75BC6477B3365C6E49631A56566993771057499868E3C6CFBD`。
- 关闭前后 SQLite 主文件 SHA-256 相同；重启后 schema `9`，`integrity_check=ok`，Project `PROJECT-2A39AEAA` 保留为 `ACTIVE` v11。Host 运行时扫描已更新；控制面 HTTP 路由对未认证请求返回 `401 UNAUTHENTICATED`，表明路由与鉴权边界已加载。
- Desktop 图形交互复核：**PENDING**。Computer Use 原生管道两次返回 `os error 2`，因此没有声称已完成真实窗口的点击/布局验证。O1 组件与 Host 回归见 `docs/O1_COMPLETION_REPORT.md`。

本次部署只更新 profile 插件及其版本 pin，不修改 Project 数据或工作目录。后续 O2 提交有独立部署记录。
