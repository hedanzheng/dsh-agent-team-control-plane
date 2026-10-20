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
- `client.js`: the six-area panel.

## Core invariants

1. A successful provider turn is not the same as a verified task.
2. Worker-declared verification is not authoritative Host evidence.
3. Unknown write outcomes are not replayed automatically.
4. A task has at most one active run.
5. A shared workspace has at most one writing run until worktree isolation is verified.
6. Replacing an agent creates a new identity and preserves the old record.

