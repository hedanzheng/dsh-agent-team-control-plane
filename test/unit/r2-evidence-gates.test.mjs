import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ControlPlaneError } from '../../src/shared/contracts.js';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { CollaborationGovernance } from '../../src/host/governance.js';
import { TaskRunCoordinator } from '../../src/host/run-coordinator.js';
import { classifyWorkspaceChanges, diffWorkspace, snapshotWorkspace } from '../../src/host/workspace-diff.js';
import { RESULT_MARKERS } from '../../src/host/result-parser.js';
import { verifyArtifacts } from '../../src/host/verification.js';

const OWNER = { type: 'human', id: 'human-owner' };
const operation = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const envelope = (value) => [{ type: 'text', text: `${RESULT_MARKERS.start}\n${JSON.stringify(value)}\n${RESULT_MARKERS.end}` }];
const success = (summary, artifacts) => envelope({
  terminalKind: 'SUCCESS', changeSummary: summary, artifacts, verifiedActions: [],
  testPlan: '', risks: [], unresolved: [], findings: [], evidenceRefs: [], checkpoint: null, requestProposal: null,
});

function scanner() {
  return {
    async scan() {
      const lastScannedAt = new Date().toISOString();
      return { scannedAt: lastScannedAt, runtimes: [
        { providerKey: 'harness:deepseek-official', kind: 'harness-agent', displayName: 'DeepSeek', availability: 'AVAILABLE', capabilities: { managementSession: true }, source: 'r2-test', lastScannedAt },
        { providerKey: 'subagent:codex', kind: 'external-worker', displayName: 'Codex', availability: 'AVAILABLE', capabilities: { oneShot: true }, source: 'r2-test', lastScannedAt },
      ], skillDiscovery: { complete: true, grillMeAvailable: false, skills: [] }, errors: [] };
    },
  };
}

// Mock adapters that can actually mutate the workspace (via onStart) to model a
// Worker (or Reviewer) writing files the Task scope does not permit.
class WritingAdapters {
  constructor(outputs, onStart) { this.outputs = [...outputs]; this.onStart = onStart; this.live = new Map(); }
  describe() { return { providerKey: 'subagent:codex', adapter: 'mock-one-shot', taskExecution: true, capabilities: { oneShot: true, sessionResume: false } }; }
  listAvailableRuntimes() { return [{ providerKey: 'subagent:codex', availability: 'AVAILABLE', authorized: true, taskExecution: true }]; }
  prepareWorkspace() { return true; }
  assertCanStart() { return true; }
  async startRun(spec) { this.onStart?.(spec); this.live.set(spec.runId, spec); return { runtimeRunId: `mock-${spec.runId}`, capabilities: {} }; }
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

async function dispose(fx) {
  if (!fx) return;
  // Close the SQLite handle first (synchronous) so the temp DB can be removed;
  // the async coordinator/governance close only awaits background jobs.
  fx.store?.close?.();
  await fx.coordinator?.close?.().catch(() => undefined);
  await fx.governance?.close?.().catch(() => undefined);
}

async function fixture(workspace, { onStart, output }) {
  const store = new ControlPlaneStore(join(workspace, 'control-plane.sqlite'));
  const plane = new AgentTeamControlPlane(store, scanner());
  let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: workspace });
  for (const providerKey of ['harness:deepseek-official', 'subagent:codex']) {
    state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('auth'), providerKey, authorized: true });
  }
  state = plane.createProject({ actor: OWNER, operationId: operation('project'), ownerId: OWNER.id, name: 'R2 scope', workspaceDir: workspace, initialGoal: 'R2 evidence gates', maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official', replanEveryN: 5 });
  const projectId = state.selected.project.id;
  state = plane.answerInterview({ actor: OWNER, operationId: operation('interview'), projectId, expectedVersion: state.selected.project.version, answers: { scope_allowed: ['src/**'], constraints: ['Host evidence only'], success_criteria: ['scope compliant'] } });
  state = plane.approveCharter({ actor: OWNER, operationId: operation('charter'), projectId, expectedVersion: state.selected.project.version });
  state = plane.approveTeam({ actor: OWNER, operationId: operation('team'), projectId, expectedVersion: state.selected.project.version });
  const adapters = new WritingAdapters(output ? [output] : [], onStart);
  const governance = new CollaborationGovernance({ store, controlPlane: plane, adapters, logger: { error() {}, warn() {} } });
  const coordinator = new TaskRunCoordinator({ store, controlPlane: plane, adapters, governance, logger: { error() {}, warn() {} } });
  return { store, plane, governance, coordinator, adapters, projectId };
}

function createTask(fx, title, allowed, forbidden, reviewPolicy = 'PL', controlLevel = 'IMPORTANT') {
  const project = fx.store.getProject(fx.projectId);
  const state = fx.plane.createTask({
    actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('task'), projectId: project.id,
    expectedProjectVersion: project.version, title, goal: title, scope: { allowed, forbidden },
    acceptance: ['scope compliant'], dependencies: [], controlLevel, reviewPolicy,
  });
  return state.selected.tasks.at(-1);
}

function startRun(fx, task) {
  const project = fx.store.getProject(fx.projectId);
  const worker = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'WORKER');
  let state = fx.plane.assignTask({ actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('assign'), projectId: project.id, taskId: task.id, expectedVersion: task.version, agentId: worker.id });
  task = state.selected.tasks.find((item) => item.id === task.id);
  return fx.coordinator.startTaskRun({
    actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('run'), projectId: project.id,
    taskId: task.id, expectedVersion: task.version,
    verificationCommands: [{ command: 'Write-Output ok', timeoutMs: 30000 }], writeIntent: true,
  });
}

// ---------------------------------------------------------------------------
// workspace-diff unit behaviour
// ---------------------------------------------------------------------------

test('workspace snapshot + diff report added, modified, and deleted files', () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-diff-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.js'), 'one\n');
    writeFileSync(join(root, 'src', 'b.js'), 'two\n');
    const before = snapshotWorkspace(root);
    writeFileSync(join(root, 'src', 'a.js'), 'one-modified\n');
    rmSync(join(root, 'src', 'b.js'));
    writeFileSync(join(root, 'src', 'c.js'), 'new\n');
    const after = snapshotWorkspace(root);
    const diff = diffWorkspace(before, after);
    assert.deepEqual(diff.added, ['src/c.js']);
    assert.deepEqual(diff.modified, ['src/a.js']);
    assert.deepEqual(diff.deleted, ['src/b.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classifyWorkspaceChanges splits forbidden, out-of-scope, and in-scope paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-classify-'));
  try {
    const diff = { added: ['src/ok.js', 'secrets/leak.txt'], modified: ['README.md'], deleted: ['src/gone.js'] };
    const scope = { allowed: ['src/**'], forbidden: ['secrets/**'] };
    const classification = classifyWorkspaceChanges(root, diff, scope);
    assert.deepEqual(classification.inScope, ['src/ok.js', 'src/gone.js']);
    assert.deepEqual(classification.forbidden, ['secrets/leak.txt']);
    assert.deepEqual(classification.outOfScope, ['README.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace snapshot excludes structural directories and SQLite database files', () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-exclude-'));
  try {
    mkdirSync(join(root, 'node_modules'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'node_modules', 'dep.js'), 'x\n');
    writeFileSync(join(root, 'src', 'keep.js'), 'keep\n');
    writeFileSync(join(root, 'control-plane.sqlite'), 'db\n');
    writeFileSync(join(root, 'control-plane.sqlite-wal'), 'wal\n');
    const snapshot = snapshotWorkspace(root);
    assert.ok(snapshot.has('src/keep.js'));
    assert.equal(snapshot.has('node_modules/dep.js'), false);
    assert.equal(snapshot.has('control-plane.sqlite'), false);
    assert.equal(snapshot.has('control-plane.sqlite-wal'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace snapshot records a junction without traversing it, and artifact verification rejects the escape', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-link-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'r2-link-outside-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(outside, 'secret.txt'), 'outside\n');
    symlinkSync(outside, join(root, 'src', 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
    const snapshot = snapshotWorkspace(root);
    assert.equal(snapshot.get('src/outside')?.symlink, true);
    assert.equal(snapshot.has('src/outside/secret.txt'), false);
    const evidence = await verifyArtifacts(root, { scope: { allowed: ['src/**'], forbidden: [] } }, ['src/outside/secret.txt']);
    assert.equal(evidence[0].status, 'FAILED');
    assert.match(evidence[0].details.error, /resolves outside workspace|symbolic link|junction/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R2.1: actual workspace change set is checked, not just reported artifacts
// ---------------------------------------------------------------------------

test('R2.1: an in-scope junction added without being reported still downgrades SUCCESS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-link-run-'));
  const outside = mkdtempSync(join(tmpdir(), 'r2-link-run-outside-'));
  let fx;
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'ok.js'), 'export {};\n');
    writeFileSync(join(outside, 'secret.txt'), 'outside\n');
    fx = await fixture(root, {
      onStart: () => symlinkSync(outside, join(root, 'src', 'linked'), process.platform === 'win32' ? 'junction' : 'dir'),
      output: success('finished', ['src/ok.js']),
    });
    const task = createTask(fx, 'T-link', ['src/**'], []);
    const state = startRun(fx, task);
    const run = state.selected.taskRuns.at(-1);
    const result = await waitFor(() => fx.store.listResults(fx.projectId).find((item) => item.runId === run.id), 'link escape result');
    assert.equal(result.outcome, 'PARTIAL');
    assert.ok(result.unresolved.some((item) => /symbolic link or junction/i.test(item)));
    assert.ok(fx.store.getTaskRun(run.id).workspaceDiff.scope.unsafeLinks.includes('src/linked'));
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('R2.1: Worker that silently writes a forbidden file cannot reach VERIFIED', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-forbidden-'));
  let fx;
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'ok.js'), 'export {};\n');
    fx = await fixture(root, {
      onStart: () => writeFileSync(join(root, 'src', 'secret.txt'), 'leaked\n'),
      output: success('finished', ['src/ok.js']),
    });
    const task = createTask(fx, 'T-01', ['src/ok.js'], ['src/secret.txt']);
    startRun(fx, task);
    await waitFor(() => ['SUBMITTED', 'WAITING'].includes(fx.store.getTask(task.id).status), 'T-01 terminal');
    const result = fx.store.getResult(fx.store.getTask(task.id).resultId);
    assert.equal(result.outcome, 'PARTIAL');
    const scopeFailure = fx.store.listEvidence(fx.projectId).find((item) => item.resultId === result.id && item.status === 'FAILED' && item.details?.reason === 'forbidden scope modification');
    assert.ok(scopeFailure, 'forbidden write must produce FAILED evidence');
    assert.equal(scopeFailure.ref, 'src/secret.txt');
    assert.notEqual(fx.store.getTask(task.id).status, 'VERIFIED');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

test('R2.1: Worker that creates an out-of-scope file is flagged PARTIAL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-outscope-'));
  let fx;
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'ok.js'), 'export {};\n');
    fx = await fixture(root, {
      onStart: () => writeFileSync(join(root, 'unexpected.txt'), 'stray\n'),
      output: success('finished', ['src/ok.js']),
    });
    const task = createTask(fx, 'T-02', ['src/**'], []);
    startRun(fx, task);
    await waitFor(() => ['SUBMITTED', 'WAITING'].includes(fx.store.getTask(task.id).status), 'T-02 terminal');
    const result = fx.store.getResult(fx.store.getTask(task.id).resultId);
    assert.equal(result.outcome, 'PARTIAL');
    assert.ok(fx.store.listEvidence(fx.projectId).some((item) => item.resultId === result.id && item.status === 'FAILED' && item.details?.reason === 'out-of-scope modification'));
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R2.2: review gates — incomplete Host verification must not be auto-approved
// ---------------------------------------------------------------------------

test('R2.2: PARTIAL Result + PL APPROVE is rejected by default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-partial-'));
  let fx;
  try {
    fx = await fixture(root, { onStart: undefined, output: success('finished', ['src/ok.js']) });
    const task = createTask(fx, 'T-03', ['src/**'], []);
    seedResult(fx.store, task, 'PARTIAL', ['EVIDENCE-1'], [{ id: 'EVIDENCE-1', status: 'FAILED' }]);
    const project = fx.store.getProject(fx.projectId);
    const result = fx.store.getResult(fx.store.getTask(task.id).resultId);
    assert.throws(() => fx.governance.submitReview({
      actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('approve'), taskId: task.id,
      decision: 'APPROVE', issues: [], evidenceRefs: result.evidenceRefs,
    }), (error) => error.code === 'VERIFICATION_INCOMPLETE');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

test('R2.2: only Human Owner may accept the unverified risk explicitly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-risk-'));
  let fx;
  try {
    fx = await fixture(root, { onStart: undefined, output: success('finished', ['src/ok.js']) });
    const task = createTask(fx, 'T-04', ['src/**'], []);
    seedResult(fx.store, task, 'PARTIAL', ['EVIDENCE-1'], [{ id: 'EVIDENCE-1', status: 'FAILED' }]);
    const result = fx.store.getResult(fx.store.getTask(task.id).resultId);
    // Human without acceptRisk → rejected.
    assert.throws(() => fx.governance.submitReview({
      actor: OWNER, operationId: operation('approve-no-risk'), taskId: task.id,
      decision: 'APPROVE', issues: [], evidenceRefs: result.evidenceRefs,
    }), (error) => error.code === 'VERIFICATION_INCOMPLETE');
    // Human with acceptRisk → VERIFIED, recorded as risk-accepted.
    const state = fx.governance.submitReview({
      actor: OWNER, operationId: operation('approve-risk'), taskId: task.id,
      decision: 'APPROVE', issues: [], evidenceRefs: result.evidenceRefs, acceptRisk: true,
    });
    assert.equal(state.selected.tasks.find((item) => item.id === task.id).status, 'VERIFIED');
    const stateEvent = fx.store.listTaskStateEvents(fx.projectId).find((item) => item.taskId === task.id && item.toStatus === 'VERIFIED');
    assert.match(stateEvent.reason, /Human-accepted unverified risk/);
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

test('R2.2: transitionTask cannot bypass Result/Evidence gates to VERIFIED', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-transition-'));
  let fx;
  try {
    fx = await fixture(root, { onStart: undefined, output: success('finished', ['src/ok.js']) });
    const project = fx.store.getProject(fx.projectId);
    const task = createTask(fx, 'T-05', ['src/**'], []);
    const pl = { type: 'pl', id: project.leadAgentId };
    // Place the Task in SUBMITTED with a fabricated resultId that has no Result row.
    fx.store.db.prepare("UPDATE tasks SET status='SUBMITTED', result_id=? WHERE id=?").run('RESULT-FAKE', task.id);
    const submittedTask = fx.store.getTask(task.id);
    assert.throws(() => fx.plane.transitionTask({ actor: pl, operationId: operation('verify-fake'), projectId: fx.projectId, taskId: task.id, expectedVersion: submittedTask.version, toStatus: 'VERIFIED', evidenceRefs: ['EVIDENCE-FAKE'] }), (error) => error.code === 'RESULT_NOT_FOUND');
    // A PARTIAL Result also cannot be forced to VERIFIED via transitionTask.
    const task2 = createTask(fx, 'T-05b', ['src/**'], []);
    seedResult(fx.store, task2, 'PARTIAL', ['EVIDENCE-1'], [{ id: 'EVIDENCE-1', status: 'FAILED' }]);
    const submittedTask2 = fx.store.getTask(task2.id);
    assert.throws(() => fx.plane.transitionTask({ actor: pl, operationId: operation('verify-partial'), projectId: fx.projectId, taskId: task2.id, expectedVersion: submittedTask2.version, toStatus: 'VERIFIED', evidenceRefs: ['EVIDENCE-1'] }), (error) => error.code === 'VERIFICATION_INCOMPLETE');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

test('R2.2: REVIEWER_PL requires an independent Reviewer approval before PL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-reviewerpl-'));
  let fx;
  try {
    fx = await fixture(root, { onStart: undefined, output: success('finished', ['src/ok.js']) });
    const task = createTask(fx, 'T-06', ['src/**'], [], 'REVIEWER_PL', 'CRITICAL');
    seedResult(fx.store, task, 'SUCCESS', ['EVIDENCE-1'], [{ id: 'EVIDENCE-1', status: 'VERIFIED' }]);
    const project = fx.store.getProject(fx.projectId);
    const result = fx.store.getResult(fx.store.getTask(task.id).resultId);
    assert.throws(() => fx.governance.submitReview({
      actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('pl-skip'), taskId: task.id,
      decision: 'APPROVE', issues: [], evidenceRefs: result.evidenceRefs,
    }), (error) => error.code === 'REVIEWER_APPROVAL_REQUIRED');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

test('R2.2: Reviewer cannot review its own Result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-self-'));
  let fx;
  try {
    fx = await fixture(root, { onStart: undefined, output: success('finished', ['src/ok.js']) });
    const task = createTask(fx, 'T-07', ['src/**'], [], 'REVIEWER_PL', 'CRITICAL');
    seedResult(fx.store, task, 'SUCCESS', ['EVIDENCE-1'], [{ id: 'EVIDENCE-1', status: 'VERIFIED' }]);
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    // Reassign the Task to the Reviewer so self-review is attempted.
    fx.store.db.prepare('UPDATE tasks SET assigned_agent_id=? WHERE id=?').run(reviewer.id, task.id);
    const result = fx.store.getResult(fx.store.getTask(task.id).resultId);
    assert.throws(() => fx.governance.submitReview({
      actor: { type: 'agent', id: reviewer.id }, operationId: operation('self-review'), taskId: task.id,
      decision: 'APPROVE', issues: [], evidenceRefs: result.evidenceRefs,
    }), (error) => error.code === 'SELF_REVIEW_FORBIDDEN');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R2.3: read-only review boundary
// ---------------------------------------------------------------------------

test('R2.3: a Reviewer that mutates the workspace is flagged and not approved', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-readonly-'));
  let fx;
  try {
    mkdirSync(join(root, 'src'));
    fx = await fixture(root, { onStart: undefined, output: success('finished', ['src/ok.js']) });
    const task = createTask(fx, 'T-08', ['src/**'], [], 'REVIEWER_PL', 'CRITICAL');
    seedResult(fx.store, task, 'SUCCESS', ['EVIDENCE-1'], [{ id: 'EVIDENCE-1', status: 'VERIFIED' }]);
    const reviewer = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'REVIEWER');
    // Reviewer writes a file during the review run.
    fx.adapters.onStart = () => writeFileSync(join(root, 'reviewer-write.txt'), 'tamper\n');
    fx.adapters.outputs[0] = reviewEnvelope('APPROVE', ['EVIDENCE-1']);
    const project = fx.store.getProject(fx.projectId);
    fx.governance.requestIndependentReview({ actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('review'), projectId: fx.projectId, taskId: task.id });
    await waitFor(() => fx.store.listReviewRuns(fx.projectId).at(-1)?.status === 'FAILED', 'review run failed');
    const reviewRun = fx.store.listReviewRuns(fx.projectId).at(-1);
    assert.equal(reviewRun.error.code, 'REVIEW_WRITE_DETECTED');
    assert.equal(fx.store.getTask(task.id).status, 'SUBMITTED', 'task must not be VERIFIED');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function seedResult(store, task, outcome, evidenceRefs, evidenceRows) {
  const project = store.getProject(task.projectId);
  const worker = store.listAgents(task.projectId).find((agent) => agent.role === 'WORKER');
  const runId = `RUN-${task.id}`;
  const resultId = `RESULT-${task.id}`;
  const at = new Date().toISOString();
  store.db.prepare(`INSERT INTO task_runs(id, task_id, agent_id, provider_key, attempt, workspace_ref, write_intent,
    status, terminal_kind, terminal_payload_ref, capability_snapshot_json, verification_commands_json, watchdog_state, created_at)
    VALUES(?, ?, ?, ?, 1, ?, 1, 'SUCCEEDED', ?, ?, '{}', '[]', 'TERMINAL', ?)`).run(
    runId, task.id, worker.id, worker.providerKey, project.workspaceDir, outcome, resultId, at,
  );
  store.db.prepare(`INSERT INTO results(id, task_id, run_id, outcome, change_summary, artifacts_json, verified_actions_json,
    test_plan, risks_json, unresolved_json, findings_json, evidence_refs_json, checkpoint_json, request_proposal_json, raw_output_excerpt, created_at)
    VALUES(?, ?, ?, ?, 'seeded', '[]', '[]', '', '[]', '[]', '[]', ?, NULL, NULL, '', ?)`).run(
    resultId, task.id, runId, outcome, JSON.stringify(evidenceRefs), at,
  );
  for (const row of evidenceRows) {
    store.db.prepare(`INSERT INTO evidence(id, result_id, kind, ref, status, details_json, created_at)
      VALUES(?, ?, 'FILE', ?, ?, '{}', ?)`).run(row.id, resultId, row.id, row.status, at);
  }
  store.db.prepare(`UPDATE tasks SET status='SUBMITTED', result_id=? WHERE id=?`).run(resultId, task.id);
  return resultId;
}

function reviewEnvelope(decision, evidenceRefs) {
  return [{ type: 'text', text: `AGENT_TEAM_REVIEW_START\n${JSON.stringify({ decision, issues: decision === 'REJECT' ? ['no'] : [], evidenceRefs })}\nAGENT_TEAM_REVIEW_END` }];
}
