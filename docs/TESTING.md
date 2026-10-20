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

- Version: `0.5.0`
- File: `local-agent-team-control-plane-0.5.0.tgz`
- SHA-256: `D70654222F1DA000D1842FC52AE50D57BA8EBD5C8276F4DE883768D622958C16`

Runtime databases, screenshots, profile state, and credential fingerprints are kept outside the public repository.

