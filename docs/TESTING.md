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

- Version: `0.5.1`
- File: `local-agent-team-control-plane-0.5.1.tgz`
- SHA-256: `47AC75AB31100269D623331C40339776F5AC3EA4AC57C5DA8BF528BE1F5412A5`

Runtime databases, screenshots, profile state, and credential fingerprints are kept outside the public repository.

