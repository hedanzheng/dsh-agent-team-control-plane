# Changelog

## 0.5.1 - 2026-10-20

- Rebound stale pending Worker runtime keys to an authorized, currently available external Worker at team approval.
- Removed the synthetic `subagent:codex` fallback when the Host has not reported an external Worker.
- Persisted the effective runtime assignment in the approved team payload and Activity audit trail.

## 0.5.0 - 2026-10-20

- Completed the version-A MVP and six-area panel.
- Added durable task, run, evidence, request, review, finding, and plan-check workflows.
- Added evidence-bound AUTO/PL/REVIEWER_PL governance.
- Added agent replacement and project stop flows.
- Added TaskFlow example, backup/restore helpers, and 23 control-plane tests.
- Verified installation, restart recovery, and uninstall persistence on DeepSeek Harness Desktop `0.2.1-rc.2`.

