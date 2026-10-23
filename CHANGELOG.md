# Changelog

## 0.6.0 - 2026-10-23

- Added an optional Worker Runtime selector to Project creation. Leaving it on automatic resolves the first Human-authorized, Host-reported external Worker and persists the effective choice on the Project.
- Upgraded the database to schema v9 and migrated existing active Projects from their current non-replaced Worker assignment.
- Made Charter team proposals use the Project's persisted Worker Runtime instead of silently choosing a new provider at approval time.
- Displayed the configured PL/Worker runtimes in Project and team summaries while keeping `fork`/`spawn` labeled as launch modes rather than model names.
- Removed the redundant header action for returning to the PL conversation; the Harness sidebar remains the navigation source, while the Project page retains only the recovery action for a PL conversation that failed to be created.
- Added a same-workspace warning and concise failed-Run guidance that directs diagnosis to the Project PL without adding an automatic retry subsystem.
- Kept token/cost estimates out of the panel when the Host does not report authoritative usage; subscription-based local runtimes are not converted into fictitious API costs.

## 0.5.8 - 2026-10-23

- Added an owner-only permanent Project record deletion flow for stopped, completed, and not-yet-active Projects. It removes the Project's complete Control Plane graph while preserving workspace files and the Harness PL conversation.
- Added version and exact Project-ID confirmation gates, active-Run checks, a minimal global deletion tombstone, and cleanup of cached PL runtime parents.
- Fixed cascading deletion of Task DAGs whose dependency edges intentionally use `ON DELETE RESTRICT` during ordinary Task operations.
- Normalized and rejected non-absolute workspace paths when a Project is created.
- Exposed Project completion blockers before the owner attempts final acceptance and hardened team role/runtime invariants.

## 0.5.7 - 2026-10-21

- Added Human-owned `STOPPED → ACTIVE` Project recovery while retaining cancelled Task and Agent replacement audit history.
- Closing a Project now rejects queued collaboration Requests and blocks active Request/Review Runs, preventing cancelled Tasks from being revived after recovery.
- Host restart recovery now marks interrupted collaboration Request Runs unknown, releases their Agents, and returns Requests to explicit handling instead of leaving Projects permanently blocked.
- Kept Task, Run, Result, Evidence, and governance history visible in read-only mode for stopped and completed Projects.
- Added a 3–8 Agent team-size selector; initial teams now contain one PL, one Reviewer, and the remaining slots as Workers, with explicit Worker assignment in the Task view.
- Reworked Runtime Sources into separate PL model sources and Worker launch modes, clearly identifying `fork`/`spawn` as execution modes rather than model names.
- Turned PL Chat into a stage-aware PL workbench with a clear purpose and next action.
- Localized Project states and Activity titles/descriptions, moved raw English audit data into expandable technical details, and clarified why replacement history is retained.

## 0.5.6 - 2026-10-20

- Added workspace preflight with write-intent directory creation and specific `RUNTIME_CWD_*` diagnostics.
- Normalized absolute/relative artifact scopes, accepted safe absolute artifact references, and surfaced Host verification failures in `Result.unresolved` and Activity.
- Forced UTF-8 PowerShell verification output on Windows PowerShell 5.1.
- Added persisted independent Reviewer Runs plus the `agent_team_request_review` PL tool; removed UI identity spoofing and blocked `REPLACED`/inactive Reviewers.
- Added the Human-owned `COMPLETED` Project terminal state and final acceptance action.
- Added schema v5 review-run history and regression coverage for all reported failures.

## 0.5.5 - 2026-10-20

- Replaced the invalid direct `provider.start()` Worker call with DSH's managed `subagents.startActivation()` entry point.
- Bound each Project to the exact live PL Agent supplied by the model-tool execution context, satisfying local `fork`/`spawn` authorization and parent-context requirements.
- Added preflight diagnostics for missing live parents and unsupported provider capabilities instead of collapsing them into a generic start failure.
- Updated cancellation and result collection to use managed activation disposal and added regression coverage for continuable-only providers.

## 0.5.4 - 2026-10-20

- Added six Host-backed PL tools for authoritative Project state, interview capture, Task creation/assignment, Worker Run launch, and PL review.
- Added a persistent PL policy that forbids direct implementation from the PL conversation and prevents narrative-only state claims.
- Kept Charter/team approval Human-only; the PL bridge can record confirmed interview answers but cannot approve or stop a Project.
- Updated PL conversation bootstrap instructions to require a state read before planning and Control Plane operations for all formal work.

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

