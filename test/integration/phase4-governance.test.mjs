import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { CollaborationGovernance } from '../../src/host/governance.js';
import { TaskRunCoordinator } from '../../src/host/run-coordinator.js';
import { RequestDispatchScheduler } from '../../src/host/request-scheduler.js';
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
const reviewOutput = (evidenceRef, decision = 'APPROVE') => [{ type: 'text', text: `AGENT_TEAM_REVIEW_START\n${JSON.stringify({ decision, issues: decision === 'REJECT' ? ['Concrete review issue'] : [], evidenceRefs: [evidenceRef] })}\nAGENT_TEAM_REVIEW_END` }];

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
  listAvailableRuntimes() { return [{ providerKey: 'subagent:codex', availability: 'AVAILABLE', authorized: true, taskExecution: true }]; }
  prepareWorkspace() { return true; }
  assertCanStart() { return true; }
  async startRun(spec) { this.prompts.push(spec.prompt); this.live.set(spec.runId, spec); return { runId: spec.runId, taskId: spec.taskId, agentId: spec.agentId, runtimeRunId: `fake-${spec.runId}`, capabilities: { oneShot: true } }; }
  observeRun(runId) { return { runId, state: this.live.has(runId) ? 'RUNNING' : 'NOT_LIVE' }; }
  cancelRun() { return false; }
  async collectRunResult(runId) { if (!this.live.has(runId)) throw new Error('not live'); return { stopReason: 'completed', output: this.outputs.shift() }; }
  disposeRun(runId) { this.live.delete(runId); }
  close() { this.live.clear(); }
}

async function fixture(outputs) {
  const base = mkdtempSync(join(tmpdir(), 'agent-team-phase4-'));
  const root = join(base, 'workspace');
  mkdirSync(root);
  const store = new ControlPlaneStore(join(base, 'control-plane.sqlite'));
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
  return { base, root, store, plane, adapters, governance, coordinator, projectId };
}

function createAssigned(fx, title, controlLevel = 'IMPORTANT', reviewPolicy = 'PL') {
  let state = fx.store.snapshot(fx.projectId);
  state = fx.plane.createTask({ actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('task'), projectId: fx.projectId, expectedProjectVersion: state.selected.project.version, title, goal: `Deliver ${title}`, scope: { allowed: ['src/**'], forbidden: [] }, acceptance: ['Host check passes'], dependencies: [], controlLevel, reviewPolicy });
  const task = state.selected.tasks.at(-1);
  const worker = state.selected.agents.find((agent) => agent.role === 'WORKER');
  state = fx.plane.assignTask({ actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('assign'), projectId: fx.projectId, taskId: task.id, expectedVersion: task.version, agentId: worker.id });
  return state.selected.tasks.find((item) => item.id === task.id);
}

async function start(fx, task) {
  const state = await fx.coordinator.startTaskRun({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('run'), projectId: fx.projectId, taskId: task.id, expectedVersion: task.version, verificationCommands: [{ command: 'exit 0' }] });
  return state.selected.taskRuns.at(-1).id;
}

async function waitFor(predicate, message = 'condition') {
  for (let index = 0; index < 300; index += 1) { const value = predicate(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error(`Timed out waiting for ${message}`);
}

async function close(fx) { await fx.coordinator.close(); fx.store.close(); rmSync(fx.base, { recursive: true, force: true }); }

test('NEEDS_INPUT creates a bounded mailbox Request; Response rebuilds context; reject/rework/approve preserves history', async () => {
  const fx = await fixture([]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.adapters.outputs.push(needsInput(reviewer.id), success(['Found a non-blocking edge case']), success(['Found a non-blocking edge case']));
    let task = createAssigned(fx, 'Request and review');
    await start(fx, task);
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
    await start(fx, task);
    await waitFor(() => fx.store.getTask(task.id).status === 'SUBMITTED', 'second Result');
    assert.match(fx.adapters.prompts[1], /Use the approved v1 interface contract/);
    assert.equal(fx.store.listFindings(fx.projectId).length, 1);
    task = fx.store.getTask(task.id);
    let result = fx.store.getResult(task.resultId);
    state = fx.governance.submitReview({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('reject'), taskId: task.id, decision: 'REJECT', issues: ['Add the missing boundary assertion'], evidenceRefs: [result.evidenceRefs[0]] });
    task = state.selected.tasks.find((item) => item.id === task.id);
    assert.equal(task.status, 'READY');
    const rejectedResultId = task.resultId;
    await start(fx, task);
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
    await start(fx, task);
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
    await start(fx, task);
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

test('PL dispatches an independent Reviewer Run, replaced identities are rejected, and Human completes the Project', async () => {
  const fx = await fixture([success()]);
  let runtimeGovernance;
  try {
    let task = createAssigned(fx, 'Automated critical review', 'CRITICAL', 'REVIEWER_PL');
    await start(fx, task);
    await waitFor(() => fx.store.getTask(task.id).status === 'SUBMITTED', 'critical submission');
    task = fx.store.getTask(task.id);
    const result = fx.store.getResult(task.resultId);
    const oldReviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER' && agent.status === 'IDLE');
    let state = fx.plane.replaceAgent({
      actor: OWNER, operationId: operation('replace-reviewer'), projectId: fx.projectId,
      expectedVersion: fx.store.getProject(fx.projectId).version, agentId: oldReviewer.id,
    });
    assert.throws(() => fx.governance.submitReview({
      actor: { type: 'agent', id: oldReviewer.id }, operationId: operation('retired-reviewer'), taskId: task.id,
      decision: 'APPROVE', issues: [], evidenceRefs: [result.evidenceRefs[0]],
    }), (error) => error.code === 'REVIEWER_INACTIVE');

    fx.adapters.outputs.push(reviewOutput(result.evidenceRefs[0]));
    runtimeGovernance = new CollaborationGovernance({ store: fx.store, controlPlane: fx.plane, adapters: fx.adapters, logger: { error() {}, warn() {} } });
    state = runtimeGovernance.requestIndependentReview({
      actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('request-review'),
      taskId: task.id,
    });
    assert.equal(['STARTING', 'RUNNING'].includes(state.selected.reviewRuns.at(-1).status), true);
    await waitFor(() => fx.store.listReviewRuns(fx.projectId).at(-1)?.status === 'SUCCEEDED', 'independent review');
    const reviewerDecision = fx.store.listReviews(fx.projectId).find((item) => item.taskId === task.id && item.reviewerRole === 'REVIEWER');
    assert.equal(reviewerDecision.decision, 'APPROVE');
    assert.notEqual(reviewerDecision.reviewerAgentId, oldReviewer.id);
    assert.equal(fx.store.getTask(task.id).status, 'SUBMITTED');

    state = runtimeGovernance.submitReview({
      actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('pl-final'),
      taskId: task.id, decision: 'APPROVE', issues: [], evidenceRefs: [result.evidenceRefs[0]],
    });
    assert.equal(state.selected.tasks.find((item) => item.id === task.id).status, 'VERIFIED');
    state = fx.plane.completeProject({
      actor: OWNER, operationId: operation('complete-project'), projectId: fx.projectId,
      expectedVersion: state.selected.project.version,
    });
    assert.equal(state.selected.project.status, 'COMPLETED');
    assert.equal(state.selected.agents.filter((agent) => agent.status !== 'REPLACED').every((agent) => agent.status === 'UNAVAILABLE'), true);
    assert.equal(state.selected.activities.some((item) => item.eventType === 'PROJECT_COMPLETED'), true);
  } finally {
    await runtimeGovernance?.close();
    await close(fx);
  }
});

test('Request timeout returns a bounded timeout Response and never auto-reissues', async () => {
  const fx = await fixture([]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.adapters.outputs.push(needsInput(reviewer.id));
    const task = createAssigned(fx, 'Timeout request');
    await start(fx, task);
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

test('Host restart recovery marks an active independent Review Run UNKNOWN and releases the Reviewer', async () => {
  const fx = await fixture([success()]);
  try {
    const task = createAssigned(fx, 'Interrupted review', 'CRITICAL', 'REVIEWER_PL');
    await start(fx, task);
    await waitFor(() => fx.store.getTask(task.id).status === 'SUBMITTED', 'review submission');
    const submitted = fx.store.getTask(task.id);
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER' && agent.status === 'IDLE');
    fx.store.db.prepare(`INSERT INTO review_runs(id, task_id, result_id, reviewer_agent_id, provider_key,
      runtime_session_ref, status, decision, error_code, error_message, raw_output_excerpt, started_at, ended_at, created_at)
      VALUES('REVIEW-RUN-INTERRUPTED', ?, ?, ?, ?, 'runtime-review', 'RUNNING', NULL, NULL, NULL, NULL, ?, NULL, ?)`)
      .run(submitted.id, submitted.resultId, reviewer.id, reviewer.providerKey, new Date().toISOString(), new Date().toISOString());
    fx.store.db.prepare("UPDATE agents SET status='RUNNING' WHERE id=?").run(reviewer.id);
    assert.equal(fx.governance.recoverInterruptedReviewRuns(), 1);
    const recovered = fx.store.listReviewRuns(fx.projectId).at(-1);
    assert.equal(recovered.status, 'UNKNOWN');
    assert.equal(recovered.error.code, 'HOST_RESTART');
    assert.equal(fx.store.listAgents(fx.projectId).find((agent) => agent.id === reviewer.id).status, 'IDLE');
  } finally { await close(fx); }
});

test('Host restart recovery marks an active collaboration Request Run UNKNOWN without replaying it', async () => {
  const fx = await fixture([]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.adapters.outputs.push(needsInput(reviewer.id, 'Recover this interrupted request'));
    const task = createAssigned(fx, 'Interrupted request');
    await start(fx, task);
    const request = await waitFor(() => fx.store.listRequests(fx.projectId).at(-1), 'request creation');
    const at = new Date().toISOString();
    fx.store.db.prepare(`INSERT INTO request_runs(id, request_id, agent_id, provider_key, runtime_session_ref,
      status, terminal_kind, error_code, error_message, started_at, ended_at, created_at)
      VALUES('REQUEST-RUN-INTERRUPTED', ?, ?, ?, 'runtime-request', 'RUNNING', NULL, NULL, NULL, ?, NULL, ?)`)
      .run(request.id, reviewer.id, reviewer.providerKey, at, at);
    fx.store.db.prepare("UPDATE requests SET status='IN_PROGRESS', started_at=? WHERE id=?").run(at, request.id);
    fx.store.db.prepare("UPDATE agents SET status='RUNNING' WHERE id=?").run(reviewer.id);

    assert.equal(fx.governance.recoverInterruptedRequestRuns(), 1);
    assert.equal(fx.governance.recoverInterruptedRequestRuns(), 0);
    const recovered = fx.store.listRequestRuns(fx.projectId).at(-1);
    assert.equal(recovered.status, 'UNKNOWN');
    assert.equal(recovered.terminalKind, 'UNKNOWN');
    assert.equal(recovered.error.code, 'HOST_RESTART');
    assert.ok(recovered.endedAt);
    assert.equal(fx.store.getRequest(request.id).status, 'PENDING');
    assert.equal(fx.store.getRequest(request.id).startedAt, null);
    assert.equal(fx.store.listAgents(fx.projectId).find((agent) => agent.id === reviewer.id).status, 'IDLE');
    assert.equal(fx.store.getTask(task.id).status, 'WAITING');
    assert.equal(fx.store.getTask(task.id).waiting.onRef, request.id);
    assert.equal(fx.store.listActivities(fx.projectId).filter((item) => item.eventType === 'REQUEST_RUN_RECOVERED').length, 1);
    fx.governance.adapters = fx.adapters;
    assert.equal(fx.governance.dispatchPendingRequests(), 0);
    assert.equal(fx.store.listRequestRuns(fx.projectId).length, 1);

    fx.governance.respondRequest({ actor: { type: 'agent', id: reviewer.id }, operationId: operation('recover-response'), requestId: request.id, outcome: 'ANSWER', body: 'Recovered through explicit handling', evidenceRefs: [] });
    assert.equal(fx.store.getRequest(request.id).status, 'RESOLVED');
    assert.equal(fx.store.getTask(task.id).status, 'READY');
  } finally { await close(fx); }
});

test('A Task cannot exceed three active collaboration Requests across continuation Runs', async () => {
  const fx = await fixture([]);
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.adapters.outputs.push(needsInput(reviewer.id, 'question 1'), needsInput(reviewer.id, 'question 2'), needsInput(reviewer.id, 'question 3'), needsInput(reviewer.id, 'question 4'));
    let task = createAssigned(fx, 'Request budget');
    for (let index = 1; index <= 3; index += 1) {
      await start(fx, task);
      const request = await waitFor(() => fx.store.listRequests(fx.projectId).find((item) => item.body === `question ${index}`), `request ${index}`);
      fx.governance.respondRequest({ actor: { type: 'agent', id: reviewer.id }, operationId: operation(`answer-${index}`), requestId: request.id, outcome: 'ANSWER', body: `answer ${index}`, evidenceRefs: [] });
      task = fx.store.getTask(task.id);
      assert.equal(task.status, 'READY');
    }
    await start(fx, task);
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
    await start(fx, task);
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
  let scheduler;
  try {
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    fx.store.db.prepare("UPDATE agents SET provider_key='subagent:codex', status='RUNNING', current_task_id='BUSY-TASK' WHERE id=?").run(reviewer.id);
    const runtimeGovernance = new CollaborationGovernance({ store: fx.store, controlPlane: fx.plane, adapters: fx.adapters, logger: { error() {}, warn() {} } });
    scheduler = new RequestDispatchScheduler({ governance: runtimeGovernance, logger: { warn() {} }, pendingFallbackMs: 5000 });
    runtimeGovernance.requestScheduler = scheduler;
    scheduler.start();
    fx.governance = runtimeGovernance;
    fx.coordinator.governance = runtimeGovernance;
    fx.adapters.outputs.push(needsInput(reviewer.id, 'Answer after the current Task'), responseOutput('Queued recipient answer.'));
    const task = createAssigned(fx, 'Queued runtime response');
    await start(fx, task);
    const request = await waitFor(() => fx.store.listRequests(fx.projectId).at(-1), 'queued Request');
    assert.equal(request.status, 'PENDING');
    assert.equal(fx.store.listRequestRuns(fx.projectId).length, 0);
    fx.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=NULL WHERE id=?").run(reviewer.id);
    scheduler.wake();
    scheduler.wake();
    await waitFor(() => fx.store.listResponses(fx.projectId).length === 1, 'queued response');
    assert.equal(fx.store.listRequestRuns(fx.projectId).length, 1);
    assert.equal(fx.store.listRequestRuns(fx.projectId).at(-1).status, 'SUCCEEDED');
    assert.equal(fx.store.getTask(task.id).status, 'READY');
    await runtimeGovernance.close();
  } finally { scheduler?.stop(); await close(fx); }
});

test('O5 Task Run terminal immediately signals mailbox availability without waiting for fallback timer', async () => {
  const fx = await fixture([success()]);
  try {
    let wakes = 0;
    fx.governance.requestScheduler = { wake() { wakes += 1; } };
    const task = createAssigned(fx, 'Release Worker mailbox');
    await start(fx, task);
    await waitFor(() => fx.store.getTask(task.id).status === 'SUBMITTED', 'Worker release');
    assert.ok(wakes >= 1);
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

