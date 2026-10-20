# Release 0.5.2

Release date: 2026-10-20

## User-facing changes

- The floating overlay has been removed. Use the **Agent Team** entry in the left sidebar to open the central full-page console.
- The console is split into PL Chat, Project, Agents, Tasks, Approvals, and Activity tabs with independent scrolling.
- Creating a Project opens a new seeded PL conversation and returns to the regular conversation workspace. The Host's current/default DeepSeek model remains in control.
- Replaced agents are kept in a collapsed audit-history section instead of crowding the active team list.
- Agent replacement requires an explicit second click, and default Worker/Reviewer names no longer accumulate repeated `replacement` suffixes.

## Verification

- DeepSeek Harness Desktop baseline: `0.2.1-rc.2`
- Automated control-plane suite: 23/23 passing
- Package: `local-agent-team-control-plane-0.5.2.tgz`
- SHA-256: `E2539AF5D8679AEA3A4A2B728296FF8F4EE997C62F4E9752B17E50F494D01402`
