# Testing

## Automated suites

```powershell
npm test
npm run test:demo
npm pack --dry-run
```

The version-A release candidate passed 23 control-plane tests and 2 TaskFlow example tests on the verified Windows host.

The suites cover contracts, parsing, task DAG readiness, assignment serialization, runtime outcomes, Host evidence, requests/responses, review gates, findings, plan checks, agent replacement, project stop, and the TaskFlow end-to-end scenario.

## Release artifact

- Version: `0.5.3`
- File: `local-agent-team-control-plane-0.5.3.tgz`
- SHA-256: `27696CE7162C12508AC419729C1B7C72F929ABAF7827F888688CEA30562FA7E3`

Runtime databases, screenshots, profile state, and credential fingerprints are kept outside the public repository.

