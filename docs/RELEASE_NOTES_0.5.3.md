# Release 0.5.3

Release date: 2026-10-20

## Fixed

- **New PL conversation** no longer lands on an empty start page.
- **Create Project → start PL conversation** now creates or reuses the correct blank Session, initializes the Project prompt, submits it, and opens the resulting conversation as one navigation flow.
- The PL's first response explains the active Project stage and ends with a concrete next step.
- Launch failures are reported inside the control plane instead of silently navigating away.

## Verification

- DeepSeek Harness Desktop baseline: `0.2.1-rc.2`
- Automated control-plane suite: 23/23 passing
- Live Desktop verification: Project context was submitted and DeepSeek returned the `CHARTER_INTERVIEW` questions in the new PL conversation
- Package: `local-agent-team-control-plane-0.5.3.tgz`
- SHA-256: `27696CE7162C12508AC419729C1B7C72F929ABAF7827F888688CEA30562FA7E3`
