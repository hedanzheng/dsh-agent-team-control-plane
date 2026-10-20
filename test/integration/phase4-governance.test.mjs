import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { CollaborationGovernance } from '../../src/host/governance.js';
import { TaskRunCoordinator } from '../../src/host/run-coordinator.js';
import { RESULT_MARKERS } from '../../src/host/result-parser.js';

const OWNER = { type: 'human', id: 'human-owner' };
const operation = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const output = (value) => [{ type: 'text', text: `${RESULT_MARKERS.start}\n${JSON.stringify(value)}\n${RESULT_MARKERS.end}` }];
const success = (findings = []) => output({
  terminalKind: 'SUCCESS', changeSummary: 'completed governed change', artifacts: [], verifiedActions: ['worker check'],
  testPlan: 'Host verification', risks: [], unresolved: [], findings, evidenceRefs: [], checkpoint: null, requestProposal: null,
});
const needsInput = (toAgentId, body = 'Confirm the interface contract') => output({
  terminalKind: 'NEEDS_INPUT', changeSummary: 'Paused at a safe terminal boundary', artifacts: [], verifiedActions: [],
  testPlan: 'Continue after response', risks: [], unresolved: [body], findings: [], evidenceRefs: [],
  checkpoint: { progress: 'implementation skeleton complete', changedFiles: [], pending: body, nextStep: 'apply response in a new Run' },
  requestProposal: { toAgentId, body, blocking: true, evidenceRefs: [] },
});
const responseOutput = (body) => [{ type: 'text', text: `AGENT_TEAM_RESPONSE_START\n${JSON.stringify({ outcome: 'ANSWER', body, evidenceRefs: [] })}\nAGENT_TEAM_RESPONSE_END` }];

function scanner() {
  return { async scan() {
    const lastScannedAt = new Date().toISOString();
    return { scannedAt: lastScannedAt, runtimes: [
      { providerKey: 'harness:deepseek-official', kind: 'harness-agent', displayName: 'DeepSeek', availability: 'AVAILABLE', capabilities: { managementSession: true }, source: 'mock', lastScannedAt },
      { providerKey: 'subagent:codex', kind: 'external-worker', displayName: 'Codex', availability: 'AVAILABLE', capabilities: { oneShot: true }, source: 'mock', lastScannedAt },
    ], skillDiscovery: { complete: true, grillMeAvailable: false, skills: [] }, errors: [] };
  } };
}

class SequenceAdapters {
  constructor(outputs) { this.outputs = [...outputs]; this.live = new Map(); this.prompts = []; }
  describe(providerKey) { return { providerKey, adapter: 'one-shot-subagent', taskExecution: true, capabilities: { oneShot: true, sessionResume: false } }; }
  assertCanStart() { return true; }
  async startRun(spec) { this.prompts.push(spec.prompt); this.live.set(spec.runId, spec); return { runId: spec.runId, taskId: spec.taskId, agentId: spec.agentId, runtimeRunId: `fake-${spec.runId}`, capabilities: { oneShot: true } }; }
  observeRun(runId) { return { runId, state: this.live.has(runId) ? 'RUNNING' : 'NOT_LIVE' }; }
  cancelRun() { return false; }
  async collectRunResult(runId) { if (!this.live.has(runId)) throw new Error('not live'); return { stopReason: 'completed', output: this.outputs.shift() }; }
  disposeRun(runId) { this.live.delete(runId); }
  close() { this.live.clear(); }
}

async function fixture(outputs) {
  const root = mkdtempSync(join(tmpdir(), 'agent-team-phase4-'));
  const store = new ControlPlaneStore(join(root, 'control-plane.sqlite'));
  const plane = new AgentTeamControlPlane(store, scanner());
  let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: root });
  for (const providerKey of ['harness:deepseek-official', 'subagent:codex']) state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('auth'), providerKey, authorized: true });
  state = plane.createProject({ actor: OWNER, operationId: operation('project'), ownerId: OWNER.id, name: 'Phase 4', workspaceDir: root, initialGoal: 'Validate governed collaboration and review.', maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official', replanEveryN: 5 });
  const projectId = state.selected.project.id;
  state = plane.answerInterview({ actor: OWNER, operationId: operation('interview'), projectId, expectedVersion: state.selected.project.version, answers: { scope_allowed: ['src/**'], constraints: ['bounded communication'], success_criteria: ['review evidence persists'] } });
  state = plane.approveCharter({ actor: OWNER, operationId: operation('charter'), projectId, expectedVersion: state.selected.project.version });
  state = plane.approveTeam({ actor: OWNER, operationId: operation('team'), projectId, expectedVersion: state.selected.project.version });
  const adapters = new SequenceAdapters(outputs);
  const governance = new CollaborationGovernance({ store, controlPlane: plane });
  const coordinator = new TaskRunCoordinator({
    store, controlPlane: plane, adapters, governance, logger: { error() {}, warn() {} },
    artifactVerifier: async (_workspace, _task, artifacts) => artifacts.map((ref) => ({ kind: 'FILE', ref, status: 'VERIFIED', details: { sha256: 'test' } })),
    commandVerifier: async (workspace, commands) => commands.map((item) => ({ command: item.command, cwd: workspace, exitCode: 0, status: 'PASSED', stdoutExcerpt: '', stderrExcerpt: '', startedAt: new Date().toISOString(), endedAt: new Date().toISOString() })),
  });
  return { root, store, plane, adapters, governance, coordinator, projectId };
}

function createAssigned(fx, title, controlLevel = 'IMPORTANT', reviewPolicy = 'PL') {
  let state = fx.store.snapshot(fx.projectId);
  state = fx.plane.createTask({ actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('task'), projectId: fx.projectId, expectedProjectVersion: state.selected.project.version, title, goal: `Deliver ${title}`, scope: { allowed: ['src/**'], forbidden: [] }, acceptance: ['Host check passes'], dependencies: [], controlLevel, reviewPolicy });
  const task = state.selected.tasks.at(-1);
  const worker = state.selected.agents.find((agent) => agent.role === 'WORKER');
  state = fx.plane.assignTask({ actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('assign'), projectId: fx.projectId, taskId: task.id, expectedVersion: task.version, agentId: worker.id });
  return state.selected.tasks.find((item) => item.id === task.id);
}

function start(fx, task) {
  const state = fx.coordinator.startTaskRun({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('run'), projectId: fx.projectId, taskId: task.id, expectedVersion: task.version, verificationCommands: [{ command: 'exit 0' }] });
  return state.selected.taskRuns.at(-1).id;
}

async function waitFor(predicate, message = 'condition') {
  for (let index = 0; index < 300; index += 1) { const value = predicate(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error(`Timed out waiting for ${message}`);
}

async function close(fx) { await fx.coordinator.close(); fx.store.close(); rmSync(fx.root, { recursive: true, force: true }); }

test('NEEDS_INPUT creates a bounded mailbox Request; Response rebuilds context; reject/rework/approve preserves history', async () => {
  const fx = await fixture([]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.adapters.outputs.push(needsInput(reviewer.id), success(['Found a non-blocking edge case']), success(['Found a non-blocking edge case']));
    let task = createAssigned(fx, 'Request and review');
    start(fx, task);
    const request = await waitFor(() => fx.store.listRequests(fx.projectId).at(-1), 'request creation');
    task = fx.store.getTask(task.id);
    assert.equal(task.status, 'WAITING');
    assert.equal(request.status, 'PENDING');
    assert.equal(fx.governance.requestWouldCycle(fx.projectId, reviewer.id, request.fromAgentId), true);
    assert.throws(() => fx.governance.createRequest({ project: fx.store.getProject(fx.projectId), task, resultId: request.sourceResultId, fromAgent: fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'WORKER'), proposal: { toAgentId: reviewer.id, body: 'duplicate', blocking: true, evidenceRefs: [] } }), (error) => error.code === 'REQUEST_ALREADY_OPEN');

    fx.store.db.prepare("UPDATE agents SET status='RUNNING', current_task_id='BUSY-TASK' WHERE id=?").run(reviewer.id);
    assert.throws(() => fx.governance.respondRequest({ actor: { type: 'agent', id: reviewer.id }, operationId: operation('busy'), requestId: request.id, outcome: 'ANSWER', body: 'answer' }), (error) => error.code === 'RECEIVER_BUSY');
    fx.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=NULL WHERE id=?").run(reviewer.id);
    let state = fx.governance.respondRequest({ actor: { type: 'agent', id: reviewer.id }, operationId: operation('response'), requestId: request.id, outcome: 'ANSWER', body: 'Use the approved v1 interface contract.', evidenceRefs: ['DECISION-TEST'] });
    task = state.selected.tasks.find((item) => item.id === task.id);
    assert.equal(task.status, 'READY');
    start(fx, task);
    await waitFor(() => fx.store.getTask(task.id).status === 'SUBMITTED', 'second Result');
    assert.match(fx.adapters.prompts[1], /Use the approved v1 interface contract/);
    assert.equal(fx.store.listFindings(fx.projectId).length, 1);
    task = fx.store.getTask(task.id);
    let result = fx.store.getResult(task.resultId);
    state = fx.governance.submitReview({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('reject'), taskId: task.id, decision: 'REJECT', issues: ['Add the missing boundary assertion'], evidenceRefs: [result.evidenceRefs[0]] });
    task = state.selected.tasks.find((item) => item.id === task.id);
    assert.equal(task.status, 'READY');
    const rejectedResultId = task.resultId;
    start(fx, task);
    await waitFor(() => fx.store.getTask(task.id).status === 'SUBMITTED' && fx.store.getTask(task.id).resultId !== rejectedResultId, 'revision Result');
    assert.match(fx.adapters.prompts[2], /Add the missing boundary assertion/);
    task = fx.store.getTask(task.id); result = fx.store.getResult(task.resultId);
    state = fx.governance.submitReview({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('approve'), taskId: task.id, decision: 'APPROVE', issues: [], evidenceRefs: [result.evidenceRefs[0]] });
    assert.equal(state.selected.tasks.find((item) => item.id === task.id).status, 'VERIFIED');
    assert.equal(state.selected.reviews.filter((item) => item.taskId === task.id).length, 2);
    assert.equal(state.selected.results.filter((item) => item.taskId === task.id).length, 3);
    assert.equal(state.selected.findings.filter((item) => item.description === 'Found a non-blocking edge case').length, 1);
  } finally { await close(fx); }
});

test('ROUTINE auto-verifies only with Host evidence and triggers the configured Plan Check', async () => {
  const fx = await fixture([success()]);
  try {
    fx.store.db.prepare('UPDATE projects SET replan_every_n=1 WHERE id=?').run(fx.projectId);
    const task = createAssigned(fx, 'Routine auto', 'ROUTINE', 'AUTO');
    start(fx, task);
    await waitFor(() => fx.store.getTask(task.id).status === 'VERIFIED', 'automatic verification');
    const state = fx.store.snapshot(fx.projectId);
    assert.equal(state.selected.reviews.at(-1).reviewerRole, 'AUTO');
    const plan = state.selected.planChecks.at(-1);
    assert.equal(plan.status, 'PENDING');
    const completed = fx.governance.completePlanCheck({ actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('plan'), planCheckId: plan.id, decision: 'KEEP_PLAN', notes: 'Evidence and dependency plan remain valid.' });
    assert.equal(completed.selected.planChecks.at(-1).decision, 'KEEP_PLAN');
  } finally { await close(fx); }
});

test('CRITICAL review requires independent Reviewer approval before PL and forbids implementer self-review', async () => {
  const fx = await fixture([success()]);
  try {
    let task = createAssigned(fx, 'Critical review', 'CRITICAL', 'REVIEWER_PL');
    const worker = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'WORKER');
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    start(fx, task);
    await waitFor(() => fx.store.getTask(task.id).status === 'SUBMITTED', 'critical submission');
    task = fx.store.getTask(task.id); const result = fx.store.getResult(task.resultId);
    assert.throws(() => fx.governance.submitReview({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('early-pl'), taskId: task.id, decision: 'APPROVE', issues: [], evidenceRefs: [result.evidenceRefs[0]] }), (error) => error.code === 'REVIEWER_APPROVAL_REQUIRED');
    assert.throws(() => fx.governance.submitReview({ actor: { type: 'agent', id: worker.id }, operationId: operation('self'), taskId: task.id, decision: 'APPROVE', issues: [], evidenceRefs: [result.evidenceRefs[0]] }), (error) => error.code === 'FORBIDDEN');
    let state = fx.governance.submitReview({ actor: { type: 'agent', id: reviewer.id }, operationId: operation('reviewer'), taskId: task.id, decision: 'APPROVE', issues: [], evidenceRefs: [result.evidenceRefs[0]] });
    assert.equal(state.selected.tasks.find((item) => item.id === task.id).status, 'SUBMITTED');
    state = fx.governance.submitReview({ actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('pl'), taskId: task.id, decision: 'APPROVE', issues: [], evidenceRefs: [result.evidenceRefs[0]] });
    assert.equal(state.selected.tasks.find((item) => item.id === task.id).status, 'VERIFIED');
  } finally { await close(fx); }
});

test('Request timeout returns a bounded timeout Response and never auto-reissues', async () => {
  const fx = await fixture([]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.adapters.outputs.push(needsInput(reviewer.id));
    const task = createAssigned(fx, 'Timeout request');
    start(fx, task);
    const request = await waitFor(() => fx.store.listRequests(fx.projectId).at(-1), 'timeout request');
    fx.store.db.prepare("UPDATE requests SET deadline_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(request.id);
    assert.equal(fx.governance.timeoutExpiredRequests(), 1);
    const state = fx.store.snapshot(fx.projectId);
    assert.equal(state.selected.requests.at(-1).status, 'TIMED_OUT');
    assert.equal(state.selected.responses.at(-1).outcome, 'REQUEST_TIMEOUT');
    assert.equal(state.selected.tasks.find((item) => item.id === task.id).status, 'READY');
    assert.equal(state.selected.requests.length, 1);
  } finally { await close(fx); }
});

test('A Task cannot exceed three active collaboration Requests across continuation Runs', async () => {
  const fx = await fixture([]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.adapters.outputs.push(needsInput(reviewer.id, 'question 1'), needsInput(reviewer.id, 'question 2'), needsInput(reviewer.id, 'question 3'), needsInput(reviewer.id, 'question 4'));
    let task = createAssigned(fx, 'Request budget');
    for (let index = 1; index <= 3; index += 1) {
      start(fx, task);
      const request = await waitFor(() => fx.store.listRequests(fx.projectId).find((item) => item.body === `question ${index}`), `request ${index}`);
      fx.governance.respondRequest({ actor: { type: 'agent', id: reviewer.id }, operationId: operation(`answer-${index}`), requestId: request.id, outcome: 'ANSWER', body: `answer ${index}`, evidenceRefs: [] });
      task = fx.store.getTask(task.id);
      assert.equal(task.status, 'READY');
    }
    start(fx, task);
    await waitFor(() => fx.store.getTask(task.id).waiting?.reason?.startsWith('Request rejected:'), 'budget rejection');
    assert.equal(fx.store.listRequests(fx.projectId).length, 3);
    assert.match(fx.store.getTask(task.id).waiting.reason, /3-request budget/);
  } finally { await close(fx); }
});

test('IDLE external recipient answers a Request through its own bounded one-shot Request Run', async () => {
  const fx = await fixture([]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.store.db.prepare("UPDATE agents SET provider_key='subagent:codex' WHERE id=?").run(reviewer.id);
    const runtimeGovernance = new CollaborationGovernance({ store: fx.store, controlPlane: fx.plane, adapters: fx.adapters, logger: { error() {}, warn() {} } });
    fx.governance = runtimeGovernance;
    fx.coordinator.governance = runtimeGovernance;
    fx.adapters.outputs.push(needsInput(reviewer.id, 'Give a bounded direct answer'), responseOutput('Direct recipient answer; no PL relay.'));
    const task = createAssigned(fx, 'Runtime response');
    start(fx, task);
    await waitFor(() => fx.store.listResponses(fx.projectId).length === 1, 'runtime response');
    const state = fx.store.snapshot(fx.projectId);
    assert.equal(state.selected.requestRuns.at(-1).status, 'SUCCEEDED');
    assert.equal(state.selected.requests.at(-1).status, 'RESOLVED');
    assert.equal(state.selected.responses.at(-1).body, 'Direct recipient answer; no PL relay.');
    assert.equal(state.selected.tasks.find((item) => item.id === task.id).status, 'READY');
    await runtimeGovernance.close();
  } finally { await close(fx); }
});

test('busy recipient keeps a Request queued and dispatches only after becoming IDLE', async () => {
  const fx = await fixture([]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.store.db.prepare("UPDATE agents SET provider_key='subagent:codex', status='RUNNING', current_task_id='BUSY-TASK' WHERE id=?").run(reviewer.id);
    const runtimeGovernance = new CollaborationGovernance({ store: fx.store, controlPlane: fx.plane, adapters: fx.adapters, logger: { error() {}, warn() {} } });
    fx.governance = runtimeGovernance;
    fx.coordinator.governance = runtimeGovernance;
    fx.adapters.outputs.push(needsInput(reviewer.id, 'Answer after the current Task'), responseOutput('Queued recipient answer.'));
    const task = createAssigned(fx, 'Queued runtime response');
    start(fx, task);
    const request = await waitFor(() => fx.store.listRequests(fx.projectId).at(-1), 'queued Request');
    assert.equal(request.status, 'PENDING');
    assert.equal(fx.store.listRequestRuns(fx.projectId).length, 0);
    assert.equal(runtimeGovernance.dispatchPendingRequests(), 0);
    fx.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=NULL WHERE id=?").run(reviewer.id);
    assert.equal(runtimeGovernance.dispatchPendingRequests(), 1);
    await waitFor(() => fx.store.listResponses(fx.projectId).length === 1, 'queued response');
    assert.equal(fx.store.listRequestRuns(fx.projectId).at(-1).status, 'SUCCEEDED');
    assert.equal(fx.store.getTask(task.id).status, 'READY');
    await runtimeGovernance.close();
  } finally { await close(fx); }
});

test('HIGH Finding triggers a Plan Check and PL can link it to a formal fix Task', async () => {
  const fx = await fixture([]);
  try {
    const project = fx.store.getProject(fx.projectId);
    let state = fx.governance.reportFinding({
      actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('finding'), projectId: fx.projectId,
      description: 'High-impact dependency drift requires a separately scoped fix.', evidenceRefs: ['EVIDENCE-TEST'], severity: 'HIGH',
    });
    const finding = state.selected.findings.at(-1);
    assert.equal(finding.status, 'OPEN');
    assert.equal(state.selected.planChecks.at(-1).trigger, 'FINDING_HIGH');
    state = fx.plane.createTask({
      actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('fix-task'), projectId: fx.projectId,
      expectedProjectVersion: state.selected.project.version, title: 'Fix dependency drift', goal: 'Resolve the triaged Finding.',
      scope: { allowed: ['src/**'], forbidden: [] }, acceptance: ['Finding evidence is addressed'], dependencies: [], controlLevel: 'IMPORTANT', reviewPolicy: 'PL',
    });
    const fixTask = state.selected.tasks.at(-1);
    state = fx.governance.updateFinding({
      actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('triage'), findingId: finding.id,
      status: 'LINKED_TO_TASK', linkedFixTaskId: fixTask.id,
    });
    const linked = state.selected.findings.find((item) => item.id === finding.id);
    assert.equal(linked.status, 'LINKED_TO_TASK');
    assert.equal(linked.linkedFixTaskId, fixTask.id);
  } finally { await close(fx); }
});

