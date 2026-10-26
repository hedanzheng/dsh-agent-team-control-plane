# O5 桌面端安装记录（2026-10-26）

- 安装来源：`main` 提交 `68b6cc1dcac893a49202c673e85de5d7f8690f4a`；安装前 Profile pin 为 O4 的 `7b8275f`，安装后为 `github:hedanzheng/dsh-agent-team-control-plane#68b6cc1`。插件包在 O5 阶段仍为 `0.6.1`；Host 兼容声明 `0.2.1-rc.2`、SQLite schema v9 均未改变。
- 安装前备份：`D:\GPT-workspace\_backups\atcp-desktop-o5-20261026-220000`。含旧插件目录 `old-plugin-o4`、Profile 原 `package.json` / `pnpm-lock.yaml`、SQLite 主文件及当时存在的 WAL/SHM、O5 npm 包与 GitHub 精确提交 tarball。旧目录是移动留存，未删除用户数据。
- 安装操作：在 DSH 未运行时打包 25 个文件，核对解包后的 `client.js` SHA-256 与源码一致后，将 O4 插件目录移入备份，把 O5 包移入原路径；Profile 的包引用与 lock 通过同卷临时文件替换。更新 lock 时发现短 SHA 替换先于完整 SHA 导致中间文本出现错误 commit，**在启动 Host 前**已再经原子替换修正；最终 lock 的完整提交 SHA 出现 4 次，旧/错误 SHA 均为 0。codeload tarball 实际 SHA-512 integrity 为 `sha512-saUFchSKqbb0pXWfvpsjYXRL2r2+3Mqp4tWaSy+wRowk6OYYb8dnpabTS/gkEvgedK6TQDC1jskOil7rOjtplQ==`，与最终 lock 相同。
- 重启后 5 个 DeepSeek Harness 进程运行，Host 监听 `127.0.0.1:40423`（动态端口）。已安装的 `client.js` SHA-256 为 `6CDBA8E0C661BE88A04650D4F2886E37FB7EFAF0D13508493CCBF3BE9ABA2D0D`；新增 `src/host/request-scheduler.js` SHA-256 为 `47D3477E06A192C36295C40EA6E22C1ACE5BE6714EB0305ED314D93C488171CE`，均与源码一致。
- 从运行中的 Host 对 `GET /agent-team-control-plane/v1?view=overview` 发未认证请求，返回 `401 UNAUTHENTICATED`，说明插件路由已注册且 R1 admission 生效。SQLite 只读查询：`PRAGMA integrity_check=ok`、schema v9、Project 数量 1；未清空、迁移或重置现有数据。
- 真实已认证 Panel 点击尚未验收。按 Computer Use 官方初始化调用，原生管道仍返回 `系统找不到指定的文件 (os error 2)`，所以 O6 的双 Project 导航、PL Session、Run/Evidence 和 Activity 真机 GUI 清单仍是 `PENDING`；进程、哈希、401 与数据库检查不替代这些操作。

回滚至 O4：完全退出 DSH（含后台 Host），将当前 O5 插件目录移至隔离备份，再将本记录备份中的 `old-plugin-o4` 移回 Profile 插件路径；用 `old-package.json` 与 `old-pnpm-lock.yaml` 原子恢复 Profile。仅当需要回退数据库时，将同一备份中的 SQLite 主文件/WAL/SHM 作为一组恢复，不与较新的 WAL 混用。重新启动 DSH 并检查插件路由与数据库完整性。
