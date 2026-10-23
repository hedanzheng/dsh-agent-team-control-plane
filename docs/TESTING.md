# Testing

## Automated suites

```powershell
npm test
npm run test:demo
npm run pack:check
```

The audited build has 99 deterministic control-plane tests and 2 TaskFlow demo tests. Tests use isolated temporary SQLite databases and workspaces; they do not read the installed Harness profile database or credentials.

Coverage includes:

- Host admission, owner identity clamping, PL Session/Project authorization, least-privilege migration, and verification-command allowlists;
- actual workspace diff evidence, out-of-scope/forbidden writes, canonical-path and symlink/junction escape rejection, Reviewer write detection, and review gates;
- runtime activation, timeout/lost-run convergence, restart recovery, late callback handling, and per-Project PL Session reuse;
- Task DAG, assignment, Result/Evidence, Request/Response, independent Review, Finding, Plan Check, Agent replacement, stop/resume/completion, and owner-confirmed cascading Project deletion without workspace removal;
- the exact six-tab Panel contract, Decision placement, Runtime/launch-mode/model distinction, optional/default Worker selection, schema-v9 migration, bind-before-submit ordering, removal of the redundant return-to-PL action, and removal of free-form owner identity;
- Activity project isolation, stable `(created_at,id)` keyset pagination, 50-row pages, Agent/type/reliable-Task filters, duplicate prevention, and index use with more than 1,000 simulated rows.

## Evidence classification

- `npm test` and `npm run test:demo` are local automated evidence.
- `npm run pack:check` validates the publish file set without producing a tarball.
- A real Harness Desktop UI smoke is reported separately; mock/unit success is never presented as proof that a provider or model is registered in the installed Host.
- Runtime databases, screenshots, profile state, credential fingerprints, and real Session IDs stay outside the public repository.

