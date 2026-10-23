# R0 Host compatibility matrix

Captured on 2026-10-22. This matrix applies to DeepSeek Harness Desktop
`0.2.1-rc.2` and Agent Team Control Plane `0.5.7` at Git commit
`35241d1bec2fef339468de39f174ffc41cad9305`.

## Evidence labels

| Label | Meaning |
|---|---|
| `TYPE` | Shipped Host documentation, type declarations, or implementation for the installed version. |
| `CURRENT_HOST` | Reproduced against the installed Desktop Host during R0. |
| `HISTORICAL_HOST` | Durable record made by this Host/plugin before R0; useful, but not a fresh lifecycle run. |
| `MOCK` | In-memory/unit evidence only. It never establishes a Host capability. |

`SUPPORTED` means the narrowly named capability was observed or is part of a
documented public API. It does not imply that the current plugin uses it safely.
`UNSUPPORTED` means the required capability is absent or the current plugin does
not enforce it. `UNKNOWN` means the Host did not report enough information and R0
does not guess.

## Environment and services

| Capability | Status | Evidence | Installed API / observation | Constraint or fallback |
|---|---|---|---|---|
| Desktop and CLI version | SUPPORTED | CURRENT_HOST | Registry, executable metadata and `dsh.cmd --version` all report `0.2.1-rc.2`. | Compatibility claims are limited to this release candidate. |
| Host Node runtime | SUPPORTED | CURRENT_HOST | Shipped and active runtime metadata reports Node `24.21.0`; the Host runtime executable reports `v24.21.0`. | The developer shell used Node `24.15.0`; it is not the Host runtime. |
| Plugin version/baseline | SUPPORTED | CURRENT_HOST | Installed package and repository package are `0.5.7`; repository HEAD exactly matches the task baseline and was clean before R0. | R0 does not bump the product version. |
| Declared Host services | SUPPORTED | TYPE + CURRENT_HOST | The plugin injects `webServer`, `llm`, `subagents`, `skills`, `tools`, and `systemPrompt` (`src/host/index.js:12`). Successful activation plus the live snapshot verifies they were composed. | `agents` is obtained dynamically through `ctx.get('agents')`, not declared in `inject` (`src/host/runtime-adapter.js:72-79`). |
| Complete `ctx` service-registry enumeration | UNKNOWN | TYPE | No supported API for enumerating every composed service was found. Static inject lists from other Host packages describe their own contracts only. | R0 lists only this plugin's declared services and individually verified APIs; it does not infer the full registry. |
| Declared Client services | SUPPORTED | TYPE + CURRENT_HOST | The client injects `slots`, `layout`, `uiWorkspace`, `sessions`, `workspaces`, and `conversation` (`client.js:737-795`); the Panel and isolated session probe used them. | This proves service availability, not Project-to-Session authorization. |

Installed Host packages used for the API audit are all version `0.2.1-rc.2`:
`@deepseek-ai/dsh-host-webserver`, `dsh-client-connection`,
`dsh-client-ui-workspace`, `dsh-tools`, `dsh-agent`, and `dsh-subagent`.

## HTTP and identity boundary

| Capability | Status | Evidence | Installed API / test record | Constraint or fallback |
|---|---|---|---|---|
| `/agent-team-control-plane/v1` requires an authenticated caller | UNSUPPORTED | CURRENT_HOST | Direct unauthenticated `GET` returned `200` and the complete snapshot. Fake Cookie, Authorization and CSRF headers also returned `200`. | R1 must move reads and writes behind the authenticated connection service; do not treat loopback as identity. |
| Route rejects untrusted Origin/Host | UNSUPPORTED | CURRENT_HOST | `Origin: https://r0.invalid`, `Origin: null`, `Sec-Fetch-Site: cross-site`, and a foreign `Host` header still returned `200`. `OPTIONS` returned `405` with no CORS allow header, but the route accepted a cross-origin `text/plain` POST and reached the business dispatcher (`400 UNKNOWN_ACTION`). | Lack of CORS response access does not make state-changing simple requests trustworthy. Enforce Host/Origin/admission server-side. |
| Raw `ctx.webServer` supplies a principal automatically | UNSUPPORTED | TYPE | Installed `dsh-host-webserver` explicitly has no server-wide authentication/origin policy. Current exact handler receives only request/response (`src/host/index.js:99-146`). | Route owner must use a trusted authentication service. |
| Authenticated browser/API peer | SUPPORTED (unused) | TYPE | Installed `ctx.connection` authenticates an authority-bound signed Cookie, checks Host/Origin/fetch-site, and supplies a `Peer`; browser principal is `{ kind: 'owner' }`. | Add `connection` as an injected service in R1 and register authenticated RPC/fetch handlers. Current plugin does not use it. |
| Stable Human account identifier | UNKNOWN | TYPE | The verified browser principal distinguishes the local owner, but R0 found no stable per-person ID in the public APIs inspected. | R1 should model a single authenticated local owner unless the Host exposes a stronger identity. Never accept free-form `ownerId` as authentication. |

## Tool execution and Project binding

| Capability | Status | Evidence | Installed API / test record | Constraint or fallback |
|---|---|---|---|---|
| Tool call supplies a live Agent/Session identity | SUPPORTED | TYPE + MOCK | `dsh-tools` passes `exec.agent`; the Agent and Session share a durable ID. The adapter can require the exact Registry object (`src/host/runtime-adapter.js:72-80`). | This is a trusted Agent identity and causal context, not Human or Project authorization. |
| Tool call supplies trusted Project/Workspace/Human identity | UNSUPPORTED | TYPE | The documented execution context contains call/tool/parent/signal/Agent data, but no control-plane Project ID, Workspace authorization, or Human principal. | Bind an authenticated Project record to a specific PL Session in R1/R3 and check it on every tool call. |
| `agent_team_*` tools are scoped to the authorised PL | UNSUPPORTED | TYPE + MOCK | A global `ctx.tools.register` makes tools visible to inheriting agents unless restricted. The bridge accepts caller `project_id`, binds any live `exec.agent`, then synthesizes the database PL/Human actor (`src/host/pl-bridge.js:60-75,100-103,131-134`). A safe in-memory PoC reproduced ordinary-session and cross-project use. | R1 must apply per-Agent tool restrictions/guards and verify `exec.agent.id === project.plSessionId`. |
| Request body `actor` is authenticated identity | UNSUPPORTED | CURRENT_HOST + TYPE | HTTP actions pass body data directly to methods that authorize by `{type,id}`. No trusted principal is attached first. | Derive Human from the admitted Host `Peer`; ignore or remove caller-supplied authority fields. |

## PL Session and actual model

| Capability | Status | Evidence | Installed API / test record | Constraint or fallback |
|---|---|---|---|---|
| Create a Session and receive its ID | SUPPORTED / USED | TYPE + CURRENT_HOST + PANEL HARNESS | Client `ctx.sessions.create({workspaceId/cwd, agentPreset})` returns a Session ID; `ctx.uiWorkspace.openWorkspace(workspaceId, callback, options)` passes the retained ID. The isolated R0 rerun obtained a real ID and completed two turns. Current client persists that callback ID as the Project PL binding before submitting the first prompt. | Host-side `sessionController` is not injected or assumed. |
| Navigate to an existing Session | SUPPORTED / USED | TYPE + PANEL HARNESS | Public Client API `ctx.uiWorkspace.openSession(sessionId)` selects an existing Session. The R5-audited client calls it for a bound Project, and an executable Panel harness verifies that this path does not call `openWorkspace`. | Real Desktop visual navigation remains part of the deployment smoke test. |
| Reopen the same Project PL Session after Host restart | PARTIALLY VERIFIED | TYPE + CURRENT_HOST + PANEL HARNESS | Host supports persisted Sessions/resume and `openSession`; Project now persists `pl_session_id` and the client reopens that address. R0 proved Session persistence/two turns, while automated Panel tests prove ID reuse. | A fresh installed-build Host restart + visual navigation smoke is still required before calling the complete product path verified. |
| Read the actual model used by a Session | SUPPORTED (unused) | TYPE + CURRENT_HOST | The retained Session's public `modelSelection` projection exposes `lastUsed`, derived from the real request header. The isolated probe's redacted persisted projection reported `deepseek-official / deepseek-flash`, reasoning `high`. | `lastUsed` proves only that Session's completed request; `next` or a default is intent, not actual use. Current plugin does not read either. |
| Selected Project PL runtime equals actual Session model | UNSUPPORTED | TYPE + CURRENT_HOST | The plugin opens `{agentPreset:'standard'}` and neither applies `leadRuntimeKey` nor records/compares the callback Session model (`client.js:787-795`). | R3 must read a supported Session model route or refuse to claim a match. |

The live LLM catalogue reported `harness:deepseek-official` as available with
`deepseek-flash` and `deepseek-v4-pro`; `harness:a6api` and
`harness:deepseek-account` were not configured. A catalogue entry is not proof
that a particular Session used it.

## Subagent execution

| Capability | Status | Evidence | Installed API / test record | Constraint or fallback |
|---|---|---|---|---|
| Managed activation API | SUPPORTED | TYPE + HISTORICAL_HOST | Installed `ctx.subagents.startActivation()` exists; current adapter invokes it with a live parent and `delivery:'caller'` (`src/host/runtime-adapter.js:119-163`). The production database contains three successful `subagent:fork` runs with runtime Session references. | Historical success is not a fresh R0 cancellation/lifecycle test. |
| `subagent:fork` registration | SUPPORTED | CURRENT_HOST + HISTORICAL_HOST | Live `ctx.subagents.list()` snapshot reports `fork`; adapter reports `backendMode=continuable`, `activationApi=true`. Three historical post-fix child projections reported `deepseek-account / deepseek-flash / high`. | `fork` is a launch mode/provider, not a model. A new/unobserved child remains UNKNOWN (or “inherits PL route”) until its own `lastUsed` exists. |
| `subagent:spawn` registration | SUPPORTED | CURRENT_HOST | Live snapshot reports `spawn`; adapter reports `backendMode=continuable`, `activationApi=true`. | No fresh successful spawn run was executed in R0. Actual child model ID is UNKNOWN. |
| Result collection/disposal | SUPPORTED by API | TYPE + HISTORICAL_HOST | Adapter requires `childId`, `result`, and `dispose()` and production fork records reached terminal success. | Per-provider process cleanup was not independently inspected in R0. |
| Managed-activation cancellation | UNKNOWN | TYPE | Adapter aborts its controller and disposes the handle (`src/host/runtime-adapter.js:172+`), and unit tests cover the mock contract. | No fresh `startActivation(fork/spawn)` cancellation was run against the production profile. |
| Codex Host Provider in the production profile | UNSUPPORTED | CURRENT_HOST | Live registered subagents were only `fork` and `spawn`. | An isolated Phase-0 profile did run a Codex external provider directly, including abort and outside-workspace denial; that is separate evidence and not production registration or the managed adapter path. |
| Claude Code Host Provider in the production profile | UNSUPPORTED | CURRENT_HOST | It was absent from live `ctx.subagents.list()`. | A Windows CLI installation, if any, does not count as Host registration. |

## Reviewer and Skill guarantees

| Capability | Status | Evidence | Installed API / test record | Constraint or fallback |
|---|---|---|---|---|
| Reviewer/Request workspace is technically read-only | UNSUPPORTED | TYPE + MOCK | Governance passes the real writable Project `cwd`; “Do not modify files” exists only in prompt text (`src/host/governance.js:26,64,158,494`). No restricted tool scope or read-only sandbox is selected. | R2 must use a Host-enforced read-only environment or, as a weaker fallback, pre/post diff detection that is explicitly not preventative isolation. |
| Reviewer commands are technically denied | UNSUPPORTED | TYPE | No Reviewer-specific command/tool policy was found. | Do not claim prompt compliance as a permission boundary. |
| Independent Reviewer end-to-end run | UNKNOWN | TYPE | Governance contains the managed Reviewer activation path, but the current production `review_runs` table contained no real run to inspect. | Execute a temporary isolated Reviewer probe in a later stage before claiming the full loop works. |
| Skill discovery snapshot | SUPPORTED | CURRENT_HOST | Live scan completed and reported only `diagnose-windows-sandbox-acl`. | Discovery alone never proves invocation. |
| `grill-me` loaded and executed by the PL | UNSUPPORTED | CURRENT_HOST | `grillMeAvailable=false`; no installed `SKILL.md` or trusted invocation event was found. | Continue with the deterministic fallback interview. Do not claim Skill use. |

## R1 recommended path

1. Inject the installed `connection` service and move the Panel transport to an
   authenticated `ctx.connection.rpc.handle(...)` or exact connection fetch
   handler. Require an admitted owner `Peer` for every Human read/write action.
2. Treat the Host owner principal as one local Human Owner unless a stable Host
   user ID is later verified. Delete authority derived from HTTP body fields.
3. Persist and authorize a specific PL Session ID per Project before allowing
   `agent_team_*`. Add a monotonic tool guard/restriction; reject ordinary and
   cross-Project Agent Sessions even when they know a Project ID.
4. If the installed composition cannot expose authenticated connection RPC to
   this plugin, the constrained fallback is a read-only Panel with sensitive
   HTTP writes and global PL tools disabled. A loopback-only listener is not an
   acceptable identity substitute. Human approval is required before choosing
   any less restrictive compatibility mode.

R0 records these findings only; it does not implement R1.

## Reproduce the redacted HTTP probe

With a local test Host already listening, run:

```powershell
$evidence = Join-Path $env:TEMP 'agent-team-r0-http.json'
& .\scripts\r0-probe-http-boundary.ps1 `
  -BaseUrl 'http://127.0.0.1:8811' `
  -OutputPath $evidence
node .\scripts\r0-validate-evidence.mjs $evidence
```

The script refuses non-loopback targets, does not send credentials, disables
the default proxy and redirects, and uses only a fixed unknown action for the
cross-origin simple POST. It records status, allowlisted headers and body shape,
not response content. `NETWORK_UNAVAILABLE` is a valid redacted capture when the
Host is not running; it is not evidence that the route is protected.
