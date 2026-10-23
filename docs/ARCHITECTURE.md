# Architecture

## Trust boundary

The Host is the authority for official state. The browser panel calls `/agent-team-control-plane/v1`; it does not open SQLite or credential files directly. Worker output is untrusted until parsed, scope-checked, and backed by Host evidence.

## Main components

- `control-plane.js`: API operations and state transitions.
- `store.js`: SQLite schema, migrations, transactions, and durable records.
- `run-coordinator.js`: one-shot run lifecycle, locks, cancellation, and recovery states.
- `runtime-adapter.js`: capability-driven provider boundary.
- `context-builder.js`: bounded worker context assembled from approved state.
- `result-parser.js`: strict structured-result normalization.
- `verification.js`: artifact hashing and bounded Host commands.
- `governance.js`: review policy, findings, and plan checks.
- `client.js`: the six-tab Overview/Project/Team/Tasks/Approvals/Activity panel.

## Core invariants

1. A successful provider turn is not the same as a verified task.
2. Worker-declared verification is not authoritative Host evidence.
3. Unknown write outcomes are not replayed automatically.
4. A task has at most one active run.
5. A shared workspace has at most one writing run until worktree isolation is verified.
6. Replacing an agent creates a new identity and preserves the old record.
7. A Project binds at most one authoritative PL Session at a time; normal conversation navigation remains owned by the Harness sidebar, not duplicated in the panel.
8. Activity is queried by Project with bounded keyset pages; snapshots carry only the recent overview tail.
9. Artifact verification resolves filesystem links and rejects paths that escape the canonical workspace.
10. Permanent Project deletion is Human-owner-only, rejects ACTIVE Projects and active Runs, and deletes only the Control Plane graph; workspaces and Harness Sessions are external resources and remain untouched.
11. Every new Project persists one effective Worker Runtime. The Human may select it explicitly or leave it on the deterministic authorized default; `fork`/`spawn` describe launch modes, not model identities.
12. Usage and cost remain unknown unless the Host reports authoritative counters. The panel never derives API-equivalent cost from subscription-backed local execution.

