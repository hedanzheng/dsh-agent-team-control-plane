# Changelog

## 0.5.3 - 2026-10-20

- Fixed PL conversation launch being superseded by an immediate second navigation.
- Switched PL launch to the Host's atomic Workspace open, draft initialization, and input submission flow.
- PL conversations now start automatically with Project context and an explicit next-step interview instead of showing an empty start page.
- Added visible launch errors and guarded Workspace selection fallbacks.

## 0.5.2 - 2026-10-20

- Replaced the floating `shell.overlay` with a first-class `main` panel and a left-sidebar navigation entry.
- Added six focused console tabs and independent scrolling so control-plane content never covers conversations.
- Added explicit “new PL conversation” and “return to conversation” actions, and automatically opens a seeded PL conversation after Project creation.
- Collapsed replaced-agent audit history, added two-step replacement confirmation, and kept replacement display names stable.

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

