# O3 桌面端部署记录（2026-10-26）

- 安装来源：已推送的 `7dfd1d495371a19d98938226704d638c1554f4cc`；Desktop Profile 为 `D:\DeepSeekHarnessData\.dsh\profiles\desktop`，插件路径为 `node_modules\@local\agent-team-control-plane`。Host 兼容版本和插件包版本未变。
- 停止旧 Host 后，将原插件目录、Profile `package.json` / `pnpm-lock.yaml`、SQLite 主文件及存在的 WAL/SHM 备份到 `D:\GPT-workspace\_backups\atcp-desktop-o3-20261026-182838`。备份 SQLite 主文件 SHA-256：`E0F0FBA34B7E1343D0FE770311A053B81A3DC1A64C40A58E50FA861ACEBEFC50`。
- 从源码 `npm pack` 解包 23 个文件，包内 `client.js` 与已提交源码 SHA-256 均为 `0B445A7675C844F85CD88F911EE45017731183F3841AF8924AC8F432F2C0C7A6`；安装后该哈希相同。Profile Git pin 更新为 `#7dfd1d4`，lock 中完整提交及下载包 SHA-512 integrity 与实际 GitHub codeload tarball 一致。原安装目录移动到了上述备份内，配置文本经临时文件替换。
- 重启后 5 个 DeepSeek Harness 进程运行；只读 SQLite `PRAGMA integrity_check=ok`、schema `9`、Project 数量 `1`。本地 Host 插件路由 `GET ?view=overview` 的未认证请求返回 HTTP `401 UNAUTHENTICATED`，说明新路由已载入且 R1 边界未放宽。真实已认证 Panel 读取及 GUI 点击尚未验证；Computer Use 原生管道返回 `os error 2`，不将哈希/路由检查冒充图形验收。
- O3 自动化与合成性能证据见 `docs/O3_COMPLETION_REPORT.md`。本次未修改 Project 数据库 schema；回滚可在停止 Host 后从上述备份恢复旧插件与两份 Profile 配置。
