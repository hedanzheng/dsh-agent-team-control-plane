# Agent Team Control Plane for DeepSeek Harness

[简体中文](README.zh-CN.md)

An **A-version MVP** control-plane plugin for DeepSeek Harness Desktop. It turns a single Harness workspace into an auditable, host-persisted team workflow with stable agent identities, a task DAG, one-shot worker runs, evidence-based verification, requests/responses, reviews, findings, plan checks, and activity history.

## Compatibility

- Verified host: DeepSeek Harness Desktop `0.2.1-rc.2`
- Package: `@local/agent-team-control-plane@0.5.0`
- Runtime: the Node.js runtime bundled with the verified host (`node:sqlite` required)
- Platform verified: Windows Desktop / PowerShell 5.1+

## What version A includes

- Six panel areas: **PL Chat**, **Project**, **Agents**, **Tasks**, **Approvals**, and **Activity**
- Host-owned SQLite state for Charter, Agents, Tasks, Runs, Results, Evidence, Requests, Responses, Reviews, Findings, Plan Checks, Decisions, and Activity
- One-shot Codex workers with explicit Checkpoint + new Run continuation
- Governance floors: `ROUTINE → AUTO`, `IMPORTANT → PL`, `CRITICAL → REVIEWER_PL`
- Host-side artifact hashing and bounded verification commands
- Optimistic version checks, operation IDs, request budgets, loop detection, and workspace write locks
- Persistent history across host restart, plugin upgrade, and plugin uninstall

## Install

From GitHub:

```powershell
dsh plugin add github:hedanzheng/dsh-agent-team-control-plane
```

Or build a local package and install it offline:

```powershell
npm pack
dsh plugin add '.\local-agent-team-control-plane-0.5.0.tgz' --offline
```

The plugin is activated by `cordis.patch.yml`. Restart the target Harness profile after installation.

## Development

```powershell
npm test
npm run test:demo
npm pack --dry-run
```

The repository contains no credentials, Harness profiles, runtime caches, or captured control-plane databases.

## Repository layout

```text
src/host/                 Host routes, store, coordinator, governance and verification
src/shared/               Shared contracts
client.js                 Harness panel UI
locale/                   English and Chinese strings
test/                     Unit and integration tests
examples/taskflow-demo/   End-to-end TaskFlow sample
scripts/                  SQLite backup and restore helpers
docs/                     Architecture, installation, testing and roadmap
```

## Version-A boundaries

Version A intentionally uses one-shot external workers. It does not claim native session resume, live message injection into a running worker, automatic Git worktree lifecycle, or a verified Claude-provider pairing. See [Roadmap](docs/ROADMAP.md).

## License

[MIT](LICENSE)


