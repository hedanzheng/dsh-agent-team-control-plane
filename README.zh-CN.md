# DeepSeek Harness Agent Team Control Plane

[English](README.md)

面向 DeepSeek Harness Desktop 的 **方案 A MVP** 控制面插件。它把单一 Harness 工作区组织成可审计、由 Host 持久化的多 Agent 工作流，覆盖稳定身份、Task DAG、one-shot Worker Run、证据验证、Request/Response、Review、Finding、Plan Check 与 Activity。

## 兼容性

- 已验证 Host：DeepSeek Harness Desktop `0.2.1-rc.2`
- 包：`@local/agent-team-control-plane@0.5.6`
- Runtime：已验证 Host 内置 Node.js，要求支持 `node:sqlite`
- 已验证平台：Windows Desktop / PowerShell 5.1+

## 方案 A 能力

- 左侧栏提供 **Agent 团队** 入口，打开中央独立全页控制台，不再覆盖当前对话
- 控制台六个页签：**PL 对话**、**Project**、**Agents**、**Tasks**、**Approvals**、**Activity**
- 每个 Project 打开一条独立 PL 对话；插件会自动提交启动消息，由 DeepSeek 立即开始访谈
- PL 对话通过七个 Host-backed `agent_team_*` 工具读取与更新真实控制面状态，并可派发真实的独立 Reviewer Run
- PL 只负责访谈、计划、编排与 Review；实现工作必须创建正式 Task、指派 Worker 并启动 one-shot Run
- Host/SQLite 统一持久化 Charter、Agent、Task、Run、Result、Evidence、Request、Response、Review、Finding、Plan Check、Decision 与 Activity
- 通过 DSH 托管 subagent activation 启动 Worker（本地 `fork`/`spawn` 或外部 provider），以 Checkpoint + 新 Run 恢复工作
- 治理下限：`ROUTINE → AUTO`、`IMPORTANT → PL`、`CRITICAL → REVIEWER_PL`
- Host 独立计算工件哈希、统一绝对/相对 scope，并以 UTF-8 执行有界验证命令
- Human 最终验收后把成功项目记录为 `COMPLETED`，与中止语义 `STOPPED` 分离
- 乐观版本检查、operation ID、Request 预算、循环检测与 workspace 写锁
- Host 重启、插件升级和卸载后仍保留历史数据

## 安装

从 GitHub 安装：

```powershell
dsh plugin add github:hedanzheng/dsh-agent-team-control-plane
```

或生成本地包并离线安装：

```powershell
npm pack
dsh plugin add '.\local-agent-team-control-plane-0.5.6.tgz' --offline
```

插件通过 `cordis.patch.yml` 激活。安装完成后重启目标 Harness Profile。

## 开发与验证

```powershell
npm test
npm run test:demo
npm pack --dry-run
```

仓库不包含凭据、Harness Profile、Runtime 缓存或实测控制面数据库。

## 目录

```text
src/host/                 Host route、存储、调度、治理与验证
src/shared/               共享契约
client.js                 Harness Panel UI
locale/                   中英文文案
test/                     单元与集成测试
examples/taskflow-demo/   TaskFlow 端到端示例
scripts/                  SQLite 备份与恢复脚本
docs/                     架构、安装、测试和路线图
```

## 方案 A 边界

方案 A 的外部 Worker 为 one-shot；不宣称原生 Session Resume、运行中实时消息注入、自动 Git worktree 生命周期或已验证的 Claude Provider 配对。后续路线见 [ROADMAP](docs/ROADMAP.md)。

## 许可证

[MIT](LICENSE)

