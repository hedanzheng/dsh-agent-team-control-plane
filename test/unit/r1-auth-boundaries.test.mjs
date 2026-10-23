import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ControlPlaneError } from '../../src/shared/contracts.js';
import { createControlPlaneHttpHandler } from '../../src/host/http-router.js';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { CollaborationGovernance } from '../../src/host/governance.js';
import { runVerificationCommands } from '../../src/host/verification.js';

const OWNER = { type: 'human', id: 'human-owner' };

function operation(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// HTTP boundary (R1.1): admission, fail-closed, and actor clamping.
// ---------------------------------------------------------------------------

const ROUTE = '/agent-team-control-plane/v1';

function mockRequest({ method = 'GET', body, headers = {}, url = ROUTE } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  return {
    method,
    url,
    headers,
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: () => Promise.resolve(index < chunks.length
          ? { value: chunks[index++], done: false }
          : { value: undefined, done: true }),
      };
    },
  };
}

function mockResponse() {
  const state = { status: 0, body: null };
  return {
    state,
    setHeader() {},
    writeHead(status) { state.status = status; },
    end(chunk) { if (chunk) state.body = JSON.parse(chunk.toString('utf8')); },
  };
}

// The Host connection service resolves to an admission envelope, never throws
// for untrusted/unauthenticated requests: `{ peer }` or `{ rejection: 401|403 }`.
function peerAdmitting(peer) {
  return { async admit() { return peer ? { peer } : { rejection: 401 }; } };
}

// Simulates the Host connection service rejecting foreign Origin/Host headers.
function originCheckingAdmit() {
  return {
    async admit(request) {
      const origin = request.headers.origin;
      const host = request.headers.host;
      if (origin !== undefined && origin !== 'https://app.local') return { rejection: 403 };
      if (host !== undefined && host !== 'app.local:51700') return { rejection: 403 };
      return { peer: { principal: { kind: 'owner', id: 'owner-peer-1' } } };
    },
  };
}

function httpProject() {
  return {
    id: 'PROJECT-HTTP', ownerId: 'owner-auth', leadAgentId: 'AGENT-PL-1',
    plSessionId: null, version: 4, status: 'ACTIVE',
  };
}

function httpFixture({ connection = peerAdmitting({ principal: { kind: 'owner', id: 'owner-peer-1' } }) } = {}) {
  const calls = [];
  const project = httpProject();
  const controlPlane = {
    requireProject(id) {
      if (id !== project.id) throw new ControlPlaneError('PROJECT_NOT_FOUND', 'no such project', 404);
      return project;
    },
    snapshot(projectId) { calls.push(['snapshot', projectId]); return { selected: { project: { ...project } } }; },
    activityPage(input) { calls.push(['activityPage', input]); return { items: [], hasMore: false, nextCursor: null, facets: { actors: [], eventTypes: [] } }; },
    createTask(input) { calls.push(['createTask', input]); return { ok: true }; },
    rescanRuntimes(input) { calls.push(['rescanRuntimes', input]); return { ok: true }; },
    createProject(input) { calls.push(['createProject', input]); return { ok: true }; },
    deleteProject(input) { calls.push(['deleteProject', input]); return { projects: [], selected: null }; },
    bindProjectPlSession(input) { calls.push(['bindProjectPlSession', input]); return { ok: true }; },
    approveVerificationCommand(input) { calls.push(['approveVerificationCommand', input]); return { ok: true }; },
    resolveVerificationCommands(projectId, commandIds) {
      calls.push(['resolveVerificationCommands', { projectId, commandIds }]);
      const approved = new Map([['VCMD-OK', { command: 'Write-Output ok', timeoutMs: 120000 }]]);
      return commandIds.map((commandId) => {
        if (commandId === 'VCMD-REVOKED') throw new ControlPlaneError('VERIFICATION_COMMAND_NOT_APPROVED', 'revoked', 403);
        if (!approved.has(commandId)) throw new ControlPlaneError('VERIFICATION_COMMAND_NOT_FOUND', 'unknown', 404);
        return approved.get(commandId);
      });
    },
    store: {
      listAgents: () => [{ id: 'AGENT-PL-1', role: 'PROJECT_LEAD' }, { id: 'AGENT-WORKER-1', role: 'WORKER' }],
      getTaskRun: () => null,
      getTask: () => null,
    },
  };
  const coordinator = {
    startTaskRun(input) { calls.push(['startTaskRun', input]); return { ok: true }; },
  };
  const governance = {
    recordDecision(input) { calls.push(['recordDecision', input]); return { ok: true }; },
  };
  const adapters = {
    forgetProjectParent(projectId) { calls.push(['forgetProjectParent', projectId]); },
  };
  const handler = createControlPlaneHttpHandler({ controlPlane, coordinator, governance, adapters, connection, logger: null });
  return { calls, handler, project };
}

test('anonymous GET and POST are rejected when admission fails', async () => {
  const { handler } = httpFixture({ connection: peerAdmitting(null) });
  let response = mockResponse();
  await handler(mockRequest({ method: 'GET' }), response);
  assert.equal(response.state.status, 401);
  assert.equal(response.state.body.error.code, 'UNAUTHENTICATED');

  response = mockResponse();
  await handler(mockRequest({
    method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'create-task' },
  }), response);
  assert.equal(response.state.status, 401);
  assert.equal(response.state.body.error.code, 'UNAUTHENTICATED');
});

test('cross-site Origin and foreign Host headers are rejected by admission', async () => {
  const { handler } = httpFixture({ connection: originCheckingAdmit() });
  for (const headers of [
    { 'content-type': 'application/json', origin: 'https://evil.example' },
    { 'content-type': 'application/json', origin: 'null' },
    { 'content-type': 'application/json', host: 'evil.example' },
    { 'content-type': 'application/json', origin: 'https://app.local', host: 'evil.example' },
  ]) {
    const response = mockResponse();
    await handler(mockRequest({ method: 'POST', headers, body: { action: 'create-task' } }), response);
    assert.equal(response.state.status, 403, JSON.stringify(headers));
  }
  const good = mockResponse();
  await handler(mockRequest({
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.local', host: 'app.local:51700' },
    body: { action: 'create-task', projectId: httpProject().id },
  }), good);
  assert.equal(good.state.status, 200);
});

test('without a Host connection service, POST fails closed and GET stays read-only', async () => {
  const { handler } = httpFixture({ connection: null });
  const response = mockResponse();
  await handler(mockRequest({ method: 'POST', body: { action: 'create-task' } }), response);
  assert.equal(response.state.status, 503);
  assert.equal(response.state.body.error.code, 'AUTH_UNAVAILABLE');

  const read = mockResponse();
  await handler(mockRequest({ method: 'GET' }), read);
  assert.equal(read.state.status, 200);
});

test('Activity GET is admitted and forwards only server-side page/filter parameters', async () => {
  const { calls, handler, project } = httpFixture();
  const response = mockResponse();
  const query = new URLSearchParams({
    view: 'activity', projectId: project.id, limit: '50', actorId: 'AGENT-PL-1',
    eventType: 'TASK_UPDATED', taskId: 'TASK-1', cursorCreatedAt: '2026-10-23T00:00:00.000Z', cursorId: 'ACTIVITY-1',
  });
  await handler(mockRequest({ method: 'GET', url: `${ROUTE}?${query}` }), response);
  assert.equal(response.state.status, 200);
  assert.deepEqual(calls.find(([name]) => name === 'activityPage')[1], {
    projectId: project.id, limit: '50', actorId: 'AGENT-PL-1', eventType: 'TASK_UPDATED', taskId: 'TASK-1',
    cursor: { createdAt: '2026-10-23T00:00:00.000Z', id: 'ACTIVITY-1' },
  });
  assert.equal(calls.some(([name]) => name === 'snapshot'), false);
});

test('POST requires an application/json Content-Type', async () => {
  const { handler } = httpFixture();
  const response = mockResponse();
  await handler(mockRequest({
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: { action: 'create-task' },
  }), response);
  assert.equal(response.state.status, 415);
  assert.equal(response.state.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('a forged Human actor is clamped to the project owner, never trusted from the body', async () => {
  const { calls, handler, project } = httpFixture();
  const response = mockResponse();
  await handler(mockRequest({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { action: 'create-task', projectId: project.id, actor: { type: 'human', id: 'attacker' } },
  }), response);
  assert.equal(response.state.status, 200);
  assert.deepEqual(calls.find(([name]) => name === 'createTask')[1].actor, { type: 'human', id: project.ownerId });
  assert.notEqual(calls.find(([name]) => name === 'createTask')[1].actor.id, 'attacker');
});

test('a forged PL actor with a foreign id and a non-member Agent actor are rejected', async () => {
  const { handler, project } = httpFixture();
  let response = mockResponse();
  await handler(mockRequest({
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: { action: 'create-task', projectId: project.id, actor: { type: 'pl', id: 'AGENT-EVIL' } },
  }), response);
  assert.equal(response.state.status, 403);

  response = mockResponse();
  await handler(mockRequest({
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: { action: 'create-task', projectId: project.id, actor: { type: 'agent', id: 'AGENT-STRANGER' } },
  }), response);
  assert.equal(response.state.status, 403);
});

test('global actions use the authenticated owner identity and ignore body actors', async () => {
  const { calls, handler } = httpFixture();
  const response = mockResponse();
  await handler(mockRequest({
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: { action: 'rescan-runtimes', actor: { type: 'human', id: 'attacker' } },
  }), response);
  assert.equal(response.state.status, 200);
  assert.deepEqual(calls.find(([name]) => name === 'rescanRuntimes')[1].actor, { type: 'human', id: 'owner-peer-1' });

  const created = mockResponse();
  await handler(mockRequest({
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: { action: 'create-project', ownerId: 'attacker' },
  }), created);
  assert.equal(created.state.status, 200);
  assert.equal(calls.find(([name]) => name === 'createProject')[1].ownerId, 'owner-peer-1');
});

test('delete-project is owner-clamped and clears the cached runtime parent after deletion', async () => {
  const { calls, handler, project } = httpFixture();
  const response = mockResponse();
  await handler(mockRequest({
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: {
      action: 'delete-project', projectId: project.id, expectedVersion: project.version,
      confirmation: project.id, actor: { type: 'human', id: 'attacker' },
    },
  }), response);
  assert.equal(response.state.status, 200);
  assert.deepEqual(calls.find(([name]) => name === 'deleteProject')[1].actor, { type: 'human', id: project.ownerId });
  assert.deepEqual(calls.find(([name]) => name === 'forgetProjectParent'), ['forgetProjectParent', project.id]);
});

test('free-text verification commands are refused at the HTTP boundary', async () => {
  const { calls, handler, project } = httpFixture();
  const response = mockResponse();
  await handler(mockRequest({
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: {
      action: 'start-task-run', projectId: project.id,
      verificationCommands: [{ command: 'Remove-Item -Recurse C:\\' }],
    },
  }), response);
  assert.equal(response.state.status, 400);
  assert.equal(response.state.body.error.code, 'VERIFICATION_COMMANDS_REJECTED');
  assert.equal(calls.some(([name]) => name === 'startTaskRun'), false);
});

test('unknown or revoked verification command IDs start no Run', async () => {
  const { calls, handler, project } = httpFixture();
  for (const commandId of ['VCMD-UNKNOWN', 'VCMD-REVOKED']) {
    const response = mockResponse();
    await handler(mockRequest({
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: { action: 'start-task-run', projectId: project.id, verification_command_ids: [commandId] },
    }), response);
    assert.ok(response.state.status === 404 || response.state.status === 403, `${commandId} must be rejected`);
  }
  assert.equal(calls.some(([name]) => name === 'startTaskRun'), false);
});

test('an approved verification command ID resolves to the whitelist and reaches the coordinator', async () => {
  const { calls, handler, project } = httpFixture();
  const response = mockResponse();
  await handler(mockRequest({
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: { action: 'start-task-run', projectId: project.id, verification_command_ids: ['VCMD-OK'] },
  }), response);
  assert.equal(response.state.status, 200);
  const input = calls.find(([name]) => name === 'startTaskRun')[1];
  assert.deepEqual(input.verificationCommands, [{ command: 'Write-Output ok', timeoutMs: 120000 }]);
});

// ---------------------------------------------------------------------------
// Control-plane and store boundaries (R1.2 / R1.3 / R1.4) on a real SQLite DB.
// ---------------------------------------------------------------------------

function scanner() {
  return {
    async scan() {
      const lastScannedAt = new Date().toISOString();
      return {
        scannedAt: lastScannedAt,
        runtimes: [
          { providerKey: 'harness:deepseek-official', kind: 'harness-agent', displayName: 'DeepSeek Official', availability: 'AVAILABLE', authorized: false, capabilities: { oneShot: true, sessionResume: true }, source: 'mock-host', lastScannedAt },
          { providerKey: 'subagent:fork', kind: 'external-worker', displayName: 'fork Worker', availability: 'AVAILABLE', authorized: false, capabilities: { oneShot: true, sessionResume: false }, source: 'mock-host', lastScannedAt },
        ],
        skillDiscovery: { complete: true, grillMeAvailable: false, skills: [] },
        errors: [],
      };
    },
  };
}

async function activePlane(root) {
  const store = new ControlPlaneStore(join(root, 'control-plane.sqlite'));
  const plane = new AgentTeamControlPlane(store, scanner());
  let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: root });
  for (const providerKey of ['harness:deepseek-official', 'subagent:fork']) {
    state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('auth'), providerKey, authorized: true });
  }
  state = plane.createProject({
    actor: OWNER, operationId: operation('project'), ownerId: OWNER.id,
    name: 'R1 boundary', workspaceDir: root, initialGoal: 'Verify R1 security boundaries.',
    maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official',
  });
  const projectId = state.selected.project.id;
  return { store, plane, state, projectId };
}

test('a PL recording interview answers creates a proposal pending Human approval, never a Human confirmation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r1-interview-'));
  let store;
  try {
    const context = await activePlane(root);
    store = context.store;
    const plane = context.plane;
    const project = plane.requireProject(context.projectId);
    const state = plane.answerInterview({
      actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('pl-interview'),
      projectId: project.id, expectedVersion: project.version,
      answers: { scope_allowed: ['src'], constraints: ['no dependencies'], success_criteria: ['npm test passes'] },
    });
    const charter = state.selected.charters.at(-1);
    assert.equal(charter.status, 'DRAFT');
    // The Charter records a PL proposal, not Human-supplied facts.
    assert.equal(charter.userConfirmed.source, 'pl-proposal-pending-human-approval');
    assert.equal(charter.userConfirmed.scopeAllowed, undefined);
    const approval = state.selected.approvals.find((item) => item.kind === 'CHARTER');
    assert.equal(approval.status, 'PENDING');
    assert.equal(approval.payload.source, 'pl-proposal');
    const activity = state.selected.activities.find((item) => item.eventType === 'CHARTER_DRAFTED');
    assert.match(activity.summary, /Human approval is still required/i);
  } finally {
    if (store) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('arbitrary permission strings cannot expand a role template', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r1-permissions-'));
  let store;
  try {
    const context = await activePlane(root);
    store = context.store;
    const plane = context.plane;
    const projectId = context.projectId;
    let project = plane.requireProject(projectId);
    let state = plane.answerInterview({
      actor: OWNER, operationId: operation('interview'), projectId, expectedVersion: project.version,
      answers: { scope_allowed: ['src'], constraints: ['none'], success_criteria: ['ok'] },
    });
    project = state.selected.project;
    state = plane.approveCharter({ actor: OWNER, operationId: operation('charter'), projectId, expectedVersion: project.version });
    project = state.selected.project;
    const leadAgentId = project.leadAgentId;
    assert.throws(() => plane.proposeTeam({
      actor: { type: 'pl', id: leadAgentId }, operationId: operation('team'), projectId,
      expectedVersion: project.version,
      members: [
        { id: leadAgentId, displayName: 'Project Lead', providerKey: 'harness:deepseek-official', role: 'PROJECT_LEAD', permissions: ['project:read'] },
        { id: 'AGENT-W1', displayName: 'Worker', providerKey: 'subagent:fork', role: 'WORKER', permissions: ['task:execute-assigned', 'omnipotence:*'] },
        { id: 'AGENT-R1', displayName: 'Reviewer', providerKey: 'subagent:fork', role: 'REVIEWER', permissions: ['project:read'] },
      ],
    }), (error) => error.code === 'INVALID_PERMISSIONS');
  } finally {
    if (store) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a migration prunes out-of-template permissions and never restores narrowed ones', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r1-migrate-'));
  let store;
  try {
    const context = await activePlane(root);
    store = context.store;
    const project = store.getProject(context.projectId);
    // Simulate an earlier narrowing plus an out-of-template permission.
    store.db.prepare("UPDATE agents SET permissions_json='[\"project:read\", \"omnipotence:*\"]' WHERE id=?").run(project.leadAgentId);
    store.close();
    store = null;
    // Reopening runs migrate(): prune-only, never re-expand.
    const reopened = new ControlPlaneStore(join(root, 'control-plane.sqlite'));
    const agent = reopened.listAgents(context.projectId).find((item) => item.id === project.leadAgentId);
    assert.deepEqual(agent.permissions, ['project:read']);
    assert.equal(agent.permissions.includes('omnipotence:*'), false);
    reopened.close();
  } finally {
    if (store) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a PL Decision with Charter impact is rejected; only the Human Owner may record it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r1-decision-'));
  let store;
  try {
    const context = await activePlane(root);
    store = context.store;
    const plane = context.plane;
    const project = plane.requireProject(context.projectId);
    const governance = new CollaborationGovernance({ store, controlPlane: plane });
    assert.throws(() => governance.recordDecision({
      actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('pl-decision'),
      projectId: project.id, title: 'Change mission', body: 'Expand mission', charterImpact: 'MISSION',
    }), (error) => error.code === 'CHARTER_CHANGE_REQUIRES_HUMAN');
    const state = governance.recordDecision({
      actor: OWNER, operationId: operation('human-decision'),
      projectId: project.id, title: 'Change mission', body: 'Expand mission', charterImpact: 'MISSION',
    });
    assert.ok(state.selected.project.id === project.id);
  } finally {
    if (store) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('bindProjectPlSession is a Human-only action and stores the binding', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r1-bind-'));
  let store;
  try {
    const context = await activePlane(root);
    store = context.store;
    const plane = context.plane;
    const projectId = context.projectId;
    const project = plane.requireProject(projectId);
    assert.throws(() => plane.bindProjectPlSession({
      actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('pl-bind'),
      projectId, plSessionId: 'SESSION-X',
    }), (error) => error.code === 'FORBIDDEN');
    const state = plane.bindProjectPlSession({
      actor: OWNER, operationId: operation('human-bind'), projectId, plSessionId: 'SESSION-PL-BOUND',
    });
    assert.equal(state.selected.project.plSessionId, 'SESSION-PL-BOUND');
    assert.ok(state.selected.activities.some((item) => item.eventType === 'PL_SESSION_BOUND'));
  } finally {
    if (store) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('unapproved PowerShell never executes, and an approved command runs for real and saves its exit code', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r1-verify-'));
  let store;
  try {
    const context = await activePlane(root);
    store = context.store;
    const plane = context.plane;
    const projectId = context.projectId;
    const state = plane.approveVerificationCommand({
      actor: OWNER, operationId: operation('approve'), projectId,
      displayName: 'failing check', command: 'exit 3', timeoutMs: 30000,
    });
    const approved = state.selected.verificationCommands.find((item) => item.status === 'APPROVED');
    assert.ok(approved, 'approved command is persisted');
    // Unapproved/revoked IDs never resolve to an executable command.
    assert.throws(() => plane.resolveVerificationCommands(projectId, ['VCMD-MISSING']),
      (error) => error.code === 'VERIFICATION_COMMAND_NOT_FOUND');
    const revokedState = plane.revokeVerificationCommand({
      actor: OWNER, operationId: operation('revoke'), projectId, commandId: approved.id,
    });
    const revoked = revokedState.selected.verificationCommands.find((item) => item.id === approved.id);
    assert.equal(revoked.status, 'REVOKED');
    assert.throws(() => plane.resolveVerificationCommands(projectId, [approved.id]),
      (error) => error.code === 'VERIFICATION_COMMAND_NOT_APPROVED');

    // An approved command executes for real through PowerShell with the real exit code.
    const live = plane.approveVerificationCommand({
      actor: OWNER, operationId: operation('approve-ok'), projectId,
      displayName: 'passing check', command: 'Write-Output ok', timeoutMs: 30000,
    });
    const liveCommand = live.selected.verificationCommands.find((item) => item.status === 'APPROVED' && item.command === 'Write-Output ok');
    const [result] = await runVerificationCommands(root, plane.resolveVerificationCommands(projectId, [liveCommand.id]));
    assert.equal(result.status, 'PASSED');
    assert.equal(result.exitCode, 0);
    assert.match(result.stdoutExcerpt, /ok/);

    const failing = plane.approveVerificationCommand({
      actor: OWNER, operationId: operation('approve-fail'), projectId,
      displayName: 'failing check 2', command: 'exit 3', timeoutMs: 30000,
    });
    const failingCommand = failing.selected.verificationCommands.find((item) => item.command === 'exit 3' && item.status === 'APPROVED');
    const [failingResult] = await runVerificationCommands(root, plane.resolveVerificationCommands(projectId, [failingCommand.id]));
    assert.equal(failingResult.status, 'FAILED');
    assert.equal(failingResult.exitCode, 3);
  } finally {
    if (store) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
