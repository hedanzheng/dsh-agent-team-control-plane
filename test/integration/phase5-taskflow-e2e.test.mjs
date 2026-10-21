import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { CollaborationGovernance } from '../../src/host/governance.js';
import { TaskRunCoordinator } from '../../src/host/run-coordinator.js';
import { RESULT_MARKERS } from '../../src/host/result-parser.js';

const OWNER = { type: 'human', id: 'human-owner' };
const workspace = resolve('examples/taskflow-demo');
const operation = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const envelope = (value) => [{ type: 'text', text: `${RESULT_MARKERS.start}\n${JSON.stringify(value)}\n${RESULT_MARKERS.end}` }];
const success = (summary, artifacts) => envelope({
  terminalKind: 'SUCCESS', changeSummary: summary, artifacts, verifiedActions: ['npm test'],
  testPlan: 'Run the TaskFlow Node test suite', risks: [], unresolved: [], findings: [],
  evidenceRefs: [], checkpoint: null, requestProposal: null,
});
const needsInput = (toAgentId) => envelope({
  terminalKind: 'NEEDS_INPUT', changeSummary: 'Interface decision is required before implementation.',
  artifacts: [], verifiedActions: [], testPlan: 'Continue in a new Run after RESPONSE', risks: [],
  unresolved: ['Choose the status enum contract'], findings: [], evidenceRefs: [],
  checkpoint: { progress: 'Contract outline prepared', changedFiles: [], pending: 'Status enum decision', nextStep: 'Apply RESPONSE and finish contract' },
  requestProposal: { toAgentId, body: 'Confirm TODO, DOING, DONE as the bounded status enum.', blocking: true, evidenceRefs: [] },
});

function scanner() {
  return { async scan() {
    const lastScannedAt = new Date().toISOString();
    return { scannedAt: lastScannedAt, runtimes: [
      { providerKey: 'harness:deepseek-official', kind: 'harness-agent', displayName: 'DeepSeek', availability: 'AVAILABLE', capabilities: { managementSession: true }, source: 'phase5-test', lastScannedAt },
      { providerKey: 'subagent:codex', kind: 'external-worker', displayName: 'Codex', availability: 'AVAILABLE', capabilities: { oneShot: true }, source: 'phase5-test', lastScannedAt },
    ], skillDiscovery: { complete: true, grillMeAvailable: false, skills: [] }, errors: [] };
  } };
}

class SequenceAdapters {
  constructor(outputs) { this.outputs = [...outputs]; this.live = new Map(); this.prompts = []; }
  describe(providerKey) { return { providerKey, adapter: 'mock-one-shot-provider', taskExecution: true, capabilities: { oneShot: true, sessionResume: false } }; }
  listAvailableRuntimes() { return [{ providerKey: 'subagent:codex', availability: 'AVAILABLE', authorized: true, taskExecution: true }]; }
  prepareWorkspace() { return true; }
  assertCanStart() { return true; }
  async startRun(spec) { this.prompts.push(spec.prompt); this.live.set(spec.runId, spec); return { runtimeRunId: `mock-${spec.runId}`, capabilities: { oneShot: true } }; }
  observeRun(runId) { return { state: this.live.has(runId) ? 'RUNNING' : 'NOT_LIVE' }; }
  cancelRun() { return false; }
  async collectRunResult(runId) { assert.equal(this.live.has(runId), true); return { stopReason: 'completed', output: this.outputs.shift() }; }
  disposeRun(runId) { this.live.delete(runId); }
  close() { this.live.clear(); }
}

async function waitFor(predicate, label) {
  for (let index = 0; index < 400; index += 1) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function fixture(outputs) {
  const root = mkdtempSync(join(tmpdir(), 'agent-team-phase5-'));
  const store = new ControlPlaneStore(join(root, 'control-plane.sqlite'));
  const plane = new AgentTeamControlPlane(store, scanner());
  let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: workspace });
  for (const providerKey of ['harness:deepseek-official', 'subagent:codex']) {
    state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('auth'), providerKey, authorized: true });
  }
  state = plane.createProject({ actor: OWNER, operationId: operation('project'), ownerId: OWNER.id, name: 'TaskFlow Demo', workspaceDir: workspace, initialGoal: 'Deliver a tested small task management application.', maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official', replanEveryN: 5 });
  const projectId = state.selected.project.id;
  state = plane.answerInterview({ actor: OWNER, operationId: operation('interview'), projectId, expectedVersion: state.selected.project.version, answers: { scope_allowed: ['src/**', 'public/**', 'test/**', 'package.json'], constraints: ['one-shot workers', 'Host evidence only'], success_criteria: ['npm test passes', 'DAG and reviews complete'] } });
  state = plane.approveCharter({ actor: OWNER, operationId: operation('charter'), projectId, expectedVersion: state.selected.project.version });
  state = plane.approveTeam({ actor: OWNER, operationId: operation('team'), projectId, expectedVersion: state.selected.project.version });
  const adapters = new SequenceAdapters(outputs);
  const governance = new CollaborationGovernance({ store, controlPlane: plane, logger: { error() {}, warn() {} } });
  const coordinator = new TaskRunCoordinator({ store, controlPlane: plane, adapters, governance, logger: { error() {}, warn() {} } });
  return { root, store, plane, governance, coordinator, adapters, projectId };
}

function createTask(fx, title, dependencies, controlLevel, reviewPolicy, allowed) {
  const project = fx.store.getProject(fx.projectId);
  const state = fx.plane.createTask({
    actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('task'), projectId: project.id,
    expectedProjectVersion: project.version, title, goal: title, scope: { allowed, forbidden: [] },
    acceptance: ['npm test passes with Host-captured evidence'], dependencies, controlLevel, reviewPolicy,
  });
  return state.selected.tasks.at(-1);
}

function assignAndStart(fx, task) {
  const project = fx.store.getProject(fx.projectId);
  const worker = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'WORKER' && agent.status !== 'REPLACED');
  let state = fx.plane.assignTask({ actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('assign'), projectId: project.id, taskId: task.id, expectedVersion: task.version, agentId: worker.id });
  task = state.selected.tasks.find((item) => item.id === task.id);
  state = startAssigned(fx, task);
  return state.selected.taskRuns.at(-1).id;
}

function startAssigned(fx, task) {
  const project = fx.store.getProject(fx.projectId);
  return fx.coordinator.startTaskRun({ actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('run'), projectId: project.id, taskId: task.id, expectedVersion: task.version, verificationCommands: [{ command: 'Remove-Item Env:NODE_TEST_CONTEXT -ErrorAction SilentlyContinue; npm test', timeoutMs: 30000 }], writeIntent: true });
}

function approvePL(fx, taskId) {
  const task = fx.store.getTask(taskId);
  const result = fx.store.getResult(task.resultId);
  return fx.governance.submitReview({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('approve'), taskId, decision: 'APPROVE', issues: [], evidenceRefs: result.evidenceRefs });
}

test('TaskFlow §13 DAG completes NEEDS_INPUT handoff, AUTO/PL/REVIEWER_PL reviews, Finding fix, replacement, and stop', async () => {
  const fx = await fixture([
    needsInput('PLACEHOLDER'),
    success('T-01 contract completed', ['src/contract.js']),
    success('T-02 backend API completed', ['src/task-api.js']),
    success('T-03 frontend completed', ['public/index.html', 'public/app.js']),
    success('T-04 integration completed', ['test/taskflow.test.mjs']),
    success('T-05 review finding fixed', ['src/task-api.js', 'test/taskflow.test.mjs']),
  ]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.adapters.outputs[0] = needsInput(reviewer.id);
    const t01 = createTask(fx, 'T-01 Define task contract', [], 'IMPORTANT', 'PL', ['src/contract.js']);
    const t02 = createTask(fx, 'T-02 Implement backend API', [t01.id], 'IMPORTANT', 'PL', ['src/task-api.js']);
    const t03 = createTask(fx, 'T-03 Implement frontend operation', [t01.id], 'ROUTINE', 'AUTO', ['public/**']);
    const t04 = createTask(fx, 'T-04 Integration verification', [t02.id, t03.id], 'CRITICAL', 'REVIEWER_PL', ['test/**']);
    assert.equal(fx.store.getTask(t02.id).status, 'PENDING');
    assert.equal(fx.store.getTask(t04.id).status, 'PENDING');

    assignAndStart(fx, t01);
    const request = await waitFor(() => fx.store.listRequests(fx.projectId).at(-1), 'T-01 request');
    assert.equal(fx.store.getTask(t01.id).status, 'WAITING');
    fx.governance.respondRequest({ actor: { type: 'agent', id: reviewer.id }, operationId: operation('response'), requestId: request.id, outcome: 'ANSWER', body: 'Use the bounded TODO, DOING, DONE enum.', evidenceRefs: [] });
    assert.equal(fx.store.getTask(t01.id).status, 'READY');
    startAssigned(fx, fx.store.getTask(t01.id));
    await waitFor(() => fx.store.getTask(t01.id).status === 'SUBMITTED', 'T-01 submitted');
    assert.match(fx.adapters.prompts[1], /TODO, DOING, DONE/);
    approvePL(fx, t01.id);
    assert.equal(fx.store.getTask(t02.id).status, 'READY');
    assert.equal(fx.store.getTask(t03.id).status, 'READY');

    assignAndStart(fx, fx.store.getTask(t02.id));
    await waitFor(() => fx.store.getTask(t02.id).status === 'SUBMITTED', 'T-02 submitted');
    approvePL(fx, t02.id);
    const findingState = fx.governance.reportFinding({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('finding'), projectId: fx.projectId, discoveredInTaskId: t02.id, description: 'Review found missing invalid-status coverage.', evidenceRefs: [], severity: 'HIGH' });
    const finding = findingState.selected.findings.at(-1);
    const t05 = createTask(fx, 'T-05 Fix review finding', [t02.id], 'IMPORTANT', 'PL', ['src/task-api.js', 'test/taskflow.test.mjs']);
    fx.governance.updateFinding({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('link-finding'), findingId: finding.id, status: 'LINKED_TO_TASK', linkedFixTaskId: t05.id });

    assignAndStart(fx, fx.store.getTask(t03.id));
    await waitFor(() => !['READY', 'RUNNING'].includes(fx.store.getTask(t03.id).status), 'T-03 terminal state');
    assert.equal(fx.store.getTask(t03.id).status, 'VERIFIED', JSON.stringify({
      result: fx.store.getResult(fx.store.getTask(t03.id).resultId),
      evidence: fx.store.listEvidence(fx.projectId).filter((item) => item.resultId === fx.store.getTask(t03.id).resultId),
      verification: fx.store.listVerificationRuns(fx.projectId).filter((item) => item.resultId === fx.store.getTask(t03.id).resultId),
    }));
    assert.equal(fx.store.listReviews(fx.projectId).find((review) => review.taskId === t03.id).reviewerRole, 'AUTO');
    assert.equal(fx.store.getTask(t04.id).status, 'READY');

    assignAndStart(fx, fx.store.getTask(t04.id));
    await waitFor(() => fx.store.getTask(t04.id).status === 'SUBMITTED', 'T-04 submitted');
    let task = fx.store.getTask(t04.id);
    let result = fx.store.getResult(task.resultId);
    fx.governance.submitReview({ actor: { type: 'agent', id: reviewer.id }, operationId: operation('reviewer'), taskId: task.id, decision: 'APPROVE', issues: [], evidenceRefs: result.evidenceRefs });
    approvePL(fx, t04.id);

    assignAndStart(fx, fx.store.getTask(t05.id));
    await waitFor(() => fx.store.getTask(t05.id).status === 'SUBMITTED', 'T-05 submitted');
    approvePL(fx, t05.id);
    fx.governance.updateFinding({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('close-finding'), findingId: finding.id, status: 'CLOSED' });

    let state = fx.store.snapshot(fx.projectId);
    assert.deepEqual(state.selected.tasks.map((item) => item.status), ['VERIFIED', 'VERIFIED', 'VERIFIED', 'VERIFIED', 'VERIFIED']);
    assert.equal(state.selected.taskRuns.length, 6);
    assert.equal(state.selected.requests.length, 1);
    assert.equal(state.selected.responses.length, 1);
    assert.equal(state.selected.findings.at(-1).status, 'CLOSED');
    assert.equal(state.selected.verificationRuns.every((run) => run.status === 'PASSED'), true);
    assert.equal(state.selected.evidence.every((item) => item.status === 'VERIFIED'), true);

    const oldWorker = state.selected.agents.find((agent) => agent.role === 'WORKER');
    const staleVersion = state.selected.project.version;
    state = fx.plane.replaceAgent({ actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('replace'), projectId: fx.projectId, expectedVersion: staleVersion, agentId: oldWorker.id });
    const retired = state.selected.agents.find((agent) => agent.id === oldWorker.id);
    const replacement = state.selected.agents.find((agent) => agent.replacesAgentId === oldWorker.id);
    assert.equal(retired.status, 'REPLACED');
    assert.notEqual(replacement.id, oldWorker.id);
    assert.equal(replacement.role, 'WORKER');
    assert.equal(replacement.displayName, 'Implementation Worker');
    assert.throws(() => fx.plane.createTask({ actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('stale'), projectId: fx.projectId, expectedProjectVersion: staleVersion, title: 'stale', goal: 'must conflict', scope: { allowed: ['src/**'], forbidden: [] }, acceptance: ['never created'], dependencies: [], controlLevel: 'IMPORTANT', reviewPolicy: 'PL' }), (error) => error.code === 'VERSION_CONFLICT');

    state = fx.plane.stopProject({ actor: OWNER, operationId: operation('stop'), projectId: fx.projectId, expectedVersion: state.selected.project.version, reason: 'Phase 5 acceptance completed' });
    assert.equal(state.selected.project.status, 'STOPPED');
    assert.equal(state.selected.agents.filter((agent) => agent.status !== 'REPLACED').every((agent) => agent.status === 'UNAVAILABLE'), true);
    assert.equal(state.selected.activities.some((item) => item.eventType === 'PROJECT_STOPPED'), true);
    assert.equal(state.selected.activities.some((item) => /password|api[_-]?key|BEGIN PRIVATE KEY/i.test(item.summary)), false);

    const stoppedTaskStates = state.selected.tasks.map((item) => [item.id, item.status]);
    state = fx.plane.resumeProject({ actor: OWNER, operationId: operation('resume'), projectId: fx.projectId, expectedVersion: state.selected.project.version });
    assert.equal(state.selected.project.status, 'ACTIVE');
    assert.deepEqual(state.selected.tasks.map((item) => [item.id, item.status]), stoppedTaskStates);
    assert.equal(state.selected.agents.filter((agent) => agent.status !== 'REPLACED').every((agent) => agent.status === 'IDLE'), true);
    assert.equal(state.selected.agents.filter((agent) => agent.status === 'REPLACED').length, 1);
    assert.equal(state.selected.activities.some((item) => item.eventType === 'PROJECT_RESUMED'), true);

    state = fx.plane.createTask({
      actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('resumed-task'),
      projectId: fx.projectId, expectedProjectVersion: state.selected.project.version,
      title: 'Post-resume follow-up', goal: 'Prove resumed Projects accept new work.',
      scope: { allowed: ['docs/**'], forbidden: [] }, acceptance: ['Task exists after resume'], dependencies: [],
      controlLevel: 'IMPORTANT', reviewPolicy: 'PL',
    });
    const followUpId = state.selected.tasks.at(-1).id;
    state = fx.plane.stopProject({ actor: OWNER, operationId: operation('stop-again'), projectId: fx.projectId, expectedVersion: state.selected.project.version, reason: 'Exercise retained cancellation history' });
    assert.equal(state.selected.tasks.find((item) => item.id === followUpId).status, 'CANCELLED');
    state = fx.plane.resumeProject({ actor: OWNER, operationId: operation('resume-again'), projectId: fx.projectId, expectedVersion: state.selected.project.version });
    assert.equal(state.selected.tasks.find((item) => item.id === followUpId).status, 'CANCELLED');
    for (const planCheck of state.selected.planChecks.filter((item) => item.status === 'PENDING')) {
      fx.governance.completePlanCheck({
        actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('post-resume-plan-check'),
        planCheckId: planCheck.id, decision: 'KEEP_PLAN', notes: 'Cancelled historical Task is outside the active completion scope.',
      });
    }
    state = fx.store.snapshot(fx.projectId);
    state = fx.plane.completeProject({ actor: OWNER, operationId: operation('complete-after-resume'), projectId: fx.projectId, expectedVersion: state.selected.project.version });
    assert.equal(state.selected.project.status, 'COMPLETED');
    assert.equal(state.selected.activities.some((item) => item.eventType === 'PROJECT_COMPLETED'), true);
  } finally {
    await fx.governance.close();
    await fx.coordinator.close();
    fx.store.close();
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('stopping a WAITING Task rejects its open Request and resume never revives the cancelled Task', async () => {
  const fx = await fixture([needsInput('PLACEHOLDER')]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.adapters.outputs[0] = needsInput(reviewer.id);
    const task = createTask(fx, 'Wait for an external decision', [], 'IMPORTANT', 'PL', ['src/contract.js']);
    assignAndStart(fx, task);
    const request = await waitFor(() => fx.store.listRequests(fx.projectId).at(-1), 'open Request before stop');
    await waitFor(() => fx.store.getTask(task.id).status === 'WAITING', 'source Task waiting');

    let state = fx.store.snapshot(fx.projectId);
    state = fx.plane.stopProject({
      actor: OWNER, operationId: operation('stop-with-request'), projectId: fx.projectId,
      expectedVersion: state.selected.project.version, reason: 'Close the Project with a queued Request',
    });
    assert.equal(state.selected.project.status, 'STOPPED');
    assert.equal(state.selected.tasks.find((item) => item.id === task.id).status, 'CANCELLED');
    assert.equal(state.selected.requests.find((item) => item.id === request.id).status, 'REJECTED');

    state = fx.plane.resumeProject({
      actor: OWNER, operationId: operation('resume-with-rejected-request'), projectId: fx.projectId,
      expectedVersion: state.selected.project.version,
    });
    assert.equal(state.selected.project.status, 'ACTIVE');
    assert.equal(state.selected.tasks.find((item) => item.id === task.id).status, 'CANCELLED');
    assert.equal(state.selected.requests.find((item) => item.id === request.id).status, 'REJECTED');
    assert.throws(() => fx.governance.respondRequest({
      actor: { type: 'agent', id: reviewer.id }, operationId: operation('late-response'),
      requestId: request.id, outcome: 'ANSWER', body: 'Too late', evidenceRefs: [],
    }), (error) => error.code === 'REQUEST_NOT_OPEN');
    assert.equal(fx.store.getTask(task.id).status, 'CANCELLED');
  } finally {
    await fx.governance.close();
    await fx.coordinator.close();
    fx.store.close();
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('Phase 5 client exposes all six Host-backed views without credential or chain-of-thought access', () => {
  const source = readFileSync(resolve('client.js'), 'utf8');
  for (const testId of ['view-pl-chat', 'view-project', 'view-agents', 'view-tasks', 'view-approvals', 'view-activity']) {
    assert.match(source, new RegExp(`data-testid': '${testId}`));
  }
  assert.match(source, /fetch\(selectedProjectId/);
  assert.match(source, /ctx\.slots\.inject\('main'/);
  assert.match(source, /ctx\.slots\.inject\('sidebar\.panellist'/);
  assert.doesNotMatch(source, /ctx\.slots\.inject\('shell\.overlay'/);
  assert.doesNotMatch(source, /position:\s*'fixed'/);
  assert.match(source, /request-review/);
  assert.match(source, /complete-project/);
  assert.match(source, /resume-project/);
  assert.match(source, /project-maxAgents/);
  assert.match(source, /setCreateMode\(\(value\) => !value\)/);
  assert.match(source, /收起创建表单/);
  assert.match(source, /task-read-only/);
  assert.match(source, /不是大模型名称/);
  assert.match(source, /ACTIVITY_LABELS/);
  assert.doesNotMatch(source, /Reviewer 通过|Reviewer 退回/);
  assert.match(source, /ctx\.uiWorkspace\.openWorkspace\(/);
  assert.match(source, /requestDraftInitialization\(/);
  assert.match(source, /\.input\.for\(binding\.ctx\)\.submit\(\)/);
  assert.match(source, /defaultWorkspaceDir: currentWorkspace\(\)\?\.path/);
  assert.match(source, /value\.match\(\/\[A-Za-z\]/);
  assert.doesNotMatch(source, /workspaceDir: 'D:\\\\GPT-workspace\\\\agent-control-plane-mvp'/);
  assert.doesNotMatch(source, /startSession\(undefined/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|process\.env|api[_-]?key|credential/i);
});


