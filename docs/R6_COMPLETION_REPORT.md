# R6 Runtime choice and interaction simplification

Date: 2026-10-23  
Package: `@local/agent-team-control-plane@0.6.0`  
Database schema: `9`

## Delivered

- Project creation now offers an optional Worker Runtime selector next to the PL Runtime selector.
- An empty selection deterministically resolves the first available, Human-authorized `external-worker` Runtime and persists that effective key on the Project.
- Charter approval builds every initial Worker from the persisted Project choice. Existing active Projects are migrated from their current non-replaced Worker assignment.
- Project and team views distinguish the provider, Worker launch mode, and unknown model identity. `fork` and `spawn` are never labeled as model names.
- The redundant header control for returning to the PL conversation was removed. Harness sidebar navigation remains authoritative; only failed initial conversation creation exposes a retry action.
- A duplicate-workspace warning explains that write Runs are serialized by the Host workspace lock.
- Failed Runs show a concise handoff to the Project PL with expandable Host error details. No automatic retry engine was added.
- Token and cost estimates remain absent when the Host does not supply authoritative usage. Subscription-backed execution is not converted into invented API cost.

## Verification

- `npm test`: **99/99 passed**, including schema-v9 migration, automatic/explicit Worker Runtime selection, and the panel interaction contract.
- `npm run test:demo`: **2/2 passed**.
- `npm run pack:check`: passed for package `0.6.0` (23 files).
- Desktop Profile offline install: installed package reports `0.6.0`; installed `client.js`, `store.js`, and `control-plane.js` hashes match the verified workspace files.
- Restart smoke: Desktop Host restarted successfully; the live control-plane database reports schema `9` and the `worker_runtime_key` column.

The restart smoke verifies loading and migration, but does not claim a real provider Run or a full manual UI walkthrough.
