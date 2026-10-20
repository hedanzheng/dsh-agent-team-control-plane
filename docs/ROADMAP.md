# Version A to B roadmap

## B-1 Persistent sessions

- Add a measured `supportsSessionResume` capability.
- Persist external runtime session references in the existing run model.
- Preserve a separate audit record for every resumed run.
- Fall back to version-A Checkpoint + new Session when resume is unavailable.

## B-2 Live requests

- Add a permission-scoped request tool only for runtimes that support live injection.
- Reuse the durable Request/Response tables, budgets, loop detection, mailbox, and Activity records.
- Pause only at safe points; retain the version-A termination flow for unsupported providers.

## B-3 Isolated workspaces

- Add capability-driven Git worktree lifecycle management.
- Verify diffs, tests, conflicts, and merge evidence before integration.
- Preserve worktrees and evidence when integration fails.

Project, Charter, Agent identity, Task DAG, Result/Evidence, Request/Response, Review/Finding, Activity, and approval semantics remain stable across the upgrade.

