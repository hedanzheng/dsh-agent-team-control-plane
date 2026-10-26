# O4-A 桌面端部署记录（2026-10-26）

- 最终安装来源：已推送的修正提交 `7b8275fd2c8527b79b0dc55d0e6d7f33599ce16d`，Profile pin 为 `github:hedanzheng/dsh-agent-team-control-plane#7b8275f`。没有改变插件版本 `0.6.1`、DSH 要求 `0.2.1-rc.2` 或数据库 schema。
- 第一次从 O3 更新到 O4 时，先停止 5 个 DeepSeek Harness 进程；旧 O3 插件、Profile `package.json` / `pnpm-lock.yaml` 与 SQLite 主文件/WAL/SHM 备份在 `D:\GPT-workspace\_backups\atcp-desktop-o4-20261026-184442`。首次 O4 安装包的独立探针发现 Worker Thread 继承 `--input-type` 后启动失败，因此随即补回归测试、修正为独立 `execArgv: []`，并以相同步骤重新部署；首次 O4 包和配置则另存于 `D:\GPT-workspace\_backups\atcp-desktop-o4-hotfix-20261026-184716`。两次旧插件目录都以移动方式保留。
- 最终 `npm pack` 含 24 个包内文件。新增 `src/host/workspace-diff-worker.js` 解包及安装后 SHA-256 为 `5ADBF98E51C6C6767883CACB4B307B057BBEFE35313981284294BA608137023C`；最终 `workspace-diff.js` 的 SHA-256 为 `E8D69F9F21D7D8CAF94122303BC756FECF2217AD889266C41DFE6C3437C1F297`，与源码相同。
- GitHub 精确提交的 codeload tarball 已下载并计算 SHA-512 integrity：`sha512-cpod/GTFNzkcAwrmBLPDdCagR2HfRczWo04FDgcNZRnX+UD55dK91W/f4jdMi9UCNR0fZCclrkcwzidcHF1Xqg==`；最终 Profile lock 的提交 URL 与 integrity 均已更新。Profile 两份文本经临时文件替换。
- 最终重启后 5 个 DeepSeek Harness 进程运行；从**已安装插件路径**使用 `node --input-type=module -` 调用 `snapshotWorkspaceAsync()`，对临时文件成功返回 1 个 SHA-256 条目，证实 Worker CLI 参数修正有效。只读数据库查询：`PRAGMA integrity_check=ok`、`schema_meta.schema_version=9`、Project 数量 `1`。本次 Host 监听端口为 `127.0.0.1:17304`，插件路由 `GET /agent-team-control-plane/v1?view=overview` 的未认证请求返回 `401`，说明路由可达且 R1 admission 生效；端口随重启变化，不能把旧端口连接拒绝误判为插件故障。
- 自动化测试与性能证据见 `docs/O4_COMPLETION_REPORT.md`。真实已认证 Panel 点击与视觉验收未执行：Computer Use 原生管道先前返回 `os error 2`；哈希、数据库和 401 路由检查不替代 GUI 验收。

回滚至 O3：停止 Host，将第一次备份里的 `old-plugin-o3` 移回 Profile 插件路径，并恢复同目录的 `old-package.json`、`old-pnpm-lock.yaml`；若数据库需要回退，使用同一备份内的 SQLite 主文件/WAL/SHM 一组恢复。不要把旧数据库与新 WAL 混用。
