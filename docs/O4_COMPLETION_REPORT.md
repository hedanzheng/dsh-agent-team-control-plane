# O4-A 工作区扫描与文件审计性能验收（2026-10-26）

实施范围：仅执行方案中的必做 O4-A。O4-B 的元数据缓存、增量哈希、基线压缩、按来源分段审计和自动清理均未实施；每次仍完整读取并哈希工作区文件，不依赖 Git Diff 或 Worker 自报。

## 改动与正确性

- `src/host/workspace-diff.js` 保留全量 SHA-256 与 canonical root 检查，将单文件读取改为 1 MiB 缓冲分块哈希；文件在哈希前后发生大小、mtime、ctime 或 inode 变化时扫描失败。Link/Junction 仅记录、不递归穿越；无法读取的目录、文件、链接或不支持的条目类型均返回扫描错误，不生成不完整的可信快照。
- 原先静默跳过的 `.git`、`node_modules`、`.workbuddy`、`__pycache__` 及 SQLite 文件不再排除：其新增、修改、删除均参与 Scope 分类。现有 Task 若把这些路径列为允许范围可正常审计；未列入的修改会成为越界失败证据。代价是这类目录较大时扫描耗时会增加，不能把旧版与新版的总时长视为同等覆盖面的工作量。
- `src/host/workspace-diff-worker.js` 让完整遍历与哈希运行在短生命周期 Worker Thread。扫描有 180 秒默认期限、AbortSignal 取消、Worker 异常/异常退出处理，所有路径都会结束 Promise；没有常驻后台扫描任务。
- `src/host/run-coordinator.js` 在 Run 前异步采集基线，采集失败不创建 Run；采集后在事务中重新验证 Project、Charter、Task 版本、Worker 绑定、依赖与写入锁。Run 后扫描失败则写入 `FILE:workspace-scan` FAILED Evidence，把原 SUCCESS 降为 PARTIAL，不能自动 VERIFIED。
- `src/host/governance.js` 的独立 Reviewer 前后扫描也异步执行；扫描失败不当成“无文件改动”或 APPROVE。`src/host/http-router.js` 等待异步启动结果。
- Host 验证命令生成的临时文件仍计入 Run 后越界审计，Evidence 的 `origin` 明确为“Worker 或 Host 验证命令，未单独归因”。本阶段不虚构来源，也不自动删除文件；若要精确区分来源，属于需另经 Human 同意的 O4-B。

## 测量

`node --expose-gc scripts/bench/workspace-o4.mjs`，Windows / Node v24.15.0；合成工作区各含 100、1,000、10,000 个 256 B 文件，5 次样本取中位数。原始 JSON：`docs/optimization-o4-before.json` 与 `docs/optimization-o4-after.json`。`realScanner` 为真实扫描函数；Event Loop lag 由 5 ms 定时器测量。测试非隔离 CPU 基准，因此时长与 RSS 仅代表本机本次运行。

| 文件数 | 旧版同步扫描耗时 | O4 异步扫描耗时 | Host 主线程最大阻塞（旧 → 新） | O4 SQLite 基线写入 |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 8.790 ms | 51.824 ms | 8.709 → 10.457 ms | 1.506 ms |
| 1,000 | 74.221 ms | 212.225 ms | 69.560 → 11.433 ms | 2.217 ms |
| 10,000 | 882.320 ms | 1,695.004 ms | 892.496 → 12.069 ms | 6.210 ms |

10,000 文件时，主线程最长阻塞下降约 **98.6%**；总墙钟时间上升约 **92%**，因为完整 canonical/一致性检查及 Worker 启动、数据传输带来成本。优化目标是 Host 交互响应性，不是宣称文件扫描更快。旧实现的分段采样在 10,000 文件时为目录读取 10.981 ms、`lstat` 189.027 ms、读取与哈希 551.236 ms；SQLite 写入约 5–6 ms，并非主要瓶颈。Run 后第二次扫描仍需相近时长，没有跳过。

64 MiB 单文件：旧版同步扫描 42.916 ms、观测峰值 RSS 202.8 MB；O4 异步扫描 73.871 ms、峰值 RSS 166.2 MB。由于跨进程运行且 RSS 包含 Node/Worker，自此只得出“本次观测值更低”，不声称严格的 36.6 MB 算法级节省。分块 SHA-256 的实际文件摘要与整块哈希结果一致。

10,000 文件的基线 JSON 仍约 1.38 MB；未压缩、未缓存。内存中位数旧版约 95.6 MB、新版约 131.6 MB：Worker Thread 增加常驻扫描期间内存，这一代价必须保留在验收记录中。

## 反向测试与边界

- `test/unit/o4-workspace-scan.test.mjs` 覆盖同步/异步快照一致、新增/修改/删除/重命名/未跟踪/禁区、大小与 mtime 伪装、32 MiB 文件摘要、外部 Junction 不遍历、取消/期限/工作区消失，以及扫描期间 Host 事件循环可响应。
- `test/unit/r2-evidence-gates.test.mjs` 覆盖禁止目录和 SQLite 不再静默跳过、未报告的禁区/越界写、Run 前基线失败、扫描中 Project 停止、Run 后扫描失败、验证命令生成越界文件、Reviewer 扫描失败。R2 原 Evidence/Scope/Owner 风险门禁回归保留。
- Host 扫描不是文件系统隔离；与其他外部进程并发写入时会尽力检测前后不一致并拒绝完整可信结论，不能将某一字节变化必然归因给 Worker。未实现更重的文件系统事务或隔离沙箱。

最终 `npm test` **138/138** 通过，`npm run test:demo` **2/2** 通过，`npm run pack:check` 打包清单 **24 个文件**（包括新的 `workspace-diff-worker.js`），退出码均为 0；`node --check` 关键 JS 与 `git diff --check` 通过。O3 桌面安装见 `docs/O3_DESKTOP_DEPLOYMENT.md`。O4-B 须另经 Human 同意，O5 未开始。

实施前逐文件源码快照保存在 `D:\GPT-workspace\_backups\atcp-o4-20261026-183235`；该目录也保存完整测试输出。代码回滚边界为 O3 提交 `7dfd1d495371a19d98938226704d638c1554f4cc`，不需要变更 SQLite schema，也不需要数据迁移。若部署桌面版，先停止 Host，再恢复插件包和 Profile Git pin/lock；本报告不会把源码测试误写成已完成的 GUI 验收。
