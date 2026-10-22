import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ControlPlaneError } from '../../src/shared/contracts.js';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { CollaborationGovernance } from '../../src/host/governance.js';
import { TaskRunCoordinator } from '../../src/host/run-coordinator.js';

const OWNER = { type: 'human', id: 'human-owner' };
const operation = (prefix) => `${prefix}-${crypto.randomUUID()}`;

function scanner() {
  return {
    async scan() {
      const lastScannedAt = new Date().toISOString();
      return {
        scannedAt: lastScannedAt,
        runtimes: [
          { providerKey: 'harness:deepseek-official', kind: 'harness-agent', displayName: 'DeepSeek', availability: 'AVAILABLE', capabilities: { managementSession: true }, source: 'r3-test', lastScannedAt },
          { providerKey: 'subagent:codex', kind: 'external-worker', displayName: 'Codex', availability: 'AVAILABLE', capabilities: { oneShot: true }, source: 'r3-test', lastScannedAt },
        ],
        skillDiscovery: { complete: true, grillMeAvailable: false, skills: [] }, errors: [],
      };
    },
  };
}

// Adapters whose collectRunResult never settles, modelling a Runtime that
// ignores cancellation and never reports a terminal state.
class HangAdapters {
  constructor() { this.live = new Map(); this.cancelCount = 0; }
  describe() { return { providerKey: 'subagent:codex', adapter: 'mock-hang', taskExecution: true, capabilities: { oneShot: true, sessionResume: false } }; }
  listAvailableRuntimes() { return [{ providerKey: 'subagent:codex', availability: 'AVAILABLE', authorized: true, taskExecution: true }]; }
  prepareWorkspace() { return true; }
  assertCanStart() { return true; }
  async startRun(spec) { this.live.set(spec.runId, spec); return { runtimeRunId: `mock-${spec.runId}`, capabilities: {} }; }
  observeRun(runId) { return { state: this.live.has(runId) ? 'RUNNING' : 'NOT_LIVE' }; }
  cancelRun() { this.cancelCount += 1; return true; }
  collectRunResult() { return new Promise(() => {}); }
  disposeRun(runId) { this.live.delete(runId); }
  close() { this.live.clear(); }
}

// Adapters that report a lost (not live) runtime handle after start.
class LostAdapters extends HangAdapters {
  observeRun() { return { state: 'NOT_LIVE' }; }
}

async function waitFor(predicate, label, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function dispose(fx) {
  if (!fx) return;
  fx.store?.close?.();
  await Promise.race([
    Promise.allSettled([fx.coordinator?.close?.().catch(() => undefined), fx.governance?.close?.().catch(() => undefined)]),
    new Promise((resolve) => setTimeout(resolve, 800)),
  ]);
}

async function fixture(workspace, { adapters, gracePeriodMs } = {}) {
  const store = new ControlPlaneStore(join(workspace, 'control-plane.sqlite'));
  const plane = new AgentTeamControlPlane(store, scanner());
  let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: workspace });
  for (const providerKey of ['harness:deepseek-official', 'subagent:codex']) {
    state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('auth'), providerKey, authorized: true });
  }
  state = plane.createProject({ actor: OWNER, operationId: operation('project'), ownerId: OWNER.id, name: 'R3 recovery', workspaceDir: workspace, initialGoal: 'R3 consistency', maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official', replanEveryN: 5 });
  const projectId = state.selected.project.id;
  state = plane.answerInterview({ actor: OWNER, operationId: operation('interview'), projectId, expectedVersion: state.selected.project.version, answers: { scope_allowed: ['src/**'], constraints: ['bounded'], success_criteria: ['converges'] } });
  state = plane.approveCharter({ actor: OWNER, operationId: operation('charter'), projectId, expectedVersion: state.selected.project.version });
  state = plane.approveTeam({ actor: OWNER, operationId: operation('team'), projectId, expectedVersion: state.selected.project.version });
  const runtimeAdapters = adapters ?? new HangAdapters();
  const governance = new CollaborationGovernance({ store, controlPlane: plane, adapters: runtimeAdapters, logger: { error() {}, warn() {} } });
  const coordinator = new TaskRunCoordinator({ store, controlPlane: plane, adapters: runtimeAdapters, governance, logger: { error() {}, warn() {} }, gracePeriodMs: gracePeriodMs ?? 30000 });
  return { store, plane, governance, coordinator, adapters: runtimeAdapters, projectId };
}

async function startRun(fx, task, timeoutMs = 600000) {
  const project = fx.store.getProject(fx.projectId);
  const worker = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'WORKER');
  let state = fx.plane.assignTask({ actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('assign'), projectId: project.id, taskId: task.id, expectedVersion: task.version, agentId: worker.id });
  task = state.selected.tasks.find((item) => item.id === task.id);
  await fx.coordinator.startTaskRun({
    actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('run'), projectId: project.id,
    taskId: task.id, expectedVersion: task.version,
    verificationCommands: [{ command: 'Write-Output ok', timeoutMs: 30000 }], writeIntent: true, timeoutMs,
  });
  return task;
}

function createTask(fx, reviewPolicy = 'PL', controlLevel = 'IMPORTANT') {
  const project = fx.store.getProject(fx.projectId);
  const state = fx.plane.createTask({
    actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('task'), projectId: project.id,
    expectedProjectVersion: project.version, title: 'R3 task', goal: 'R3 goal', scope: { allowed: ['src/**'], forbidden: ['secrets/**'] },
    acceptance: ['converges'], dependencies: [], controlLevel, reviewPolicy,
  });
  return state.selected.tasks.at(-1);
}

// ---------------------------------------------------------------------------
// R3.1: Run must always converge
// ---------------------------------------------------------------------------

test('a Runtime that never resolves its result converges to UNKNOWN after the grace period', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r3-grace-'));
  let fx;
  try {
    fx = await fixture(root, { gracePeriodMs: 60 });
    let task = createTask(fx);
    task = await startRun(fx, task, 5000);
    const runId = fx.store.listTaskRuns(fx.projectId).at(-1).id;
    const converged = await waitFor(() => {
      const run = fx.store.getTaskRun(runId);
      return run && !['CREATED', 'STARTING', 'RUNNING'].includes(run.status) ? run : null;
    }, 'run to converge', 8000);
    assert.equal(converged.status, 'UNKNOWN');
    assert.equal(converged.terminalKind, 'UNKNOWN');
    assert.equal(fx.store.getTask(task.id).status, 'WAITING');
    const lock = fx.store.db.prepare('SELECT run_id FROM workspace_locks WHERE run_id=?').get(runId);
    assert.equal(lock, undefined);
    const results = fx.store.db.prepare('SELECT outcome FROM results WHERE run_id=?').all(runId);
    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, 'UNKNOWN');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

test('a lost runtime handle is converged by convergeLostRun exactly once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r3-lost-'));
  let fx;
  try {
    fx = await fixture(root, { adapters: new LostAdapters(), gracePeriodMs: 40 });
    let task = createTask(fx);
    task = await startRun(fx, task, 5000);
    const runId = fx.store.listTaskRuns(fx.projectId).at(-1).id;
    await fx.coordinator.convergeLostRun(runId);
    const first = fx.store.getTaskRun(runId);
    assert.equal(first.status, 'UNKNOWN');
    assert.equal(first.error.code, 'RUNTIME_LOST');
    assert.equal(fx.store.getTask(task.id).status, 'WAITING');
    await fx.coordinator.convergeLostRun(runId);
    const results = fx.store.db.prepare('SELECT id FROM results WHERE run_id=?').all(runId);
    assert.equal(results.length, 1);
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

test('recoverInterruptedRuns marks interrupted active Runs UNKNOWN without replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r3-restart-'));
  let fx;
  try {
    fx = await fixture(root);
    const task = createTask(fx);
    const worker = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'WORKER');
    const at = new Date().toISOString();
    const runId = 'RUN-INTERRUPTED';
    fx.store.db.prepare(`INSERT INTO task_runs(id, task_id, agent_id, provider_key, attempt, runtime_session_ref, workspace_ref, write_intent, status, terminal_kind, terminal_payload_ref, capability_snapshot_json, verification_commands_json, workspace_baseline_json, watchdog_state, error_code, error_message, started_at, ended_at, heartbeat_at, cancel_requested_at, created_at)
      VALUES(?, ?, ?, 'subagent:codex', 1, 'mock', ?, 1, 'RUNNING', NULL, NULL, '{}', '[]', NULL, 'HEALTHY', NULL, NULL, ?, NULL, ?, NULL, ?)`).run(runId, task.id, worker.id, root, at, at, at);
    fx.store.db.prepare("UPDATE tasks SET status='RUNNING', assigned_agent_id=? WHERE id=?").run(worker.id, task.id);
    const recovered = fx.coordinator.recoverInterruptedRuns();
    assert.equal(recovered, 1);
    const run = fx.store.getTaskRun(runId);
    assert.equal(run.status, 'UNKNOWN');
    assert.equal(run.error.code, 'HOST_RESTART');
    assert.equal(fx.store.getTask(task.id).status, 'WAITING');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R3.2: terminal Projects must not be revived by late callbacks
// ---------------------------------------------------------------------------

test('a late review decision cannot revive a Task in a stopped Project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r3-stop-'));
  let fx;
  try {
    fx = await fixture(root);
    const task = createTask(fx, 'PL');
    const resultId = 'RESULT-LATE';
    const at = new Date().toISOString();
    const worker = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'WORKER');
    // Seed a terminal Run row so the Result's run_id foreign key is satisfiable.
    fx.store.db.prepare(`INSERT INTO task_runs(id, task_id, agent_id, provider_key, attempt, runtime_session_ref, workspace_ref, write_intent, status, terminal_kind, terminal_payload_ref, capability_snapshot_json, verification_commands_json, workspace_baseline_json, watchdog_state, error_code, error_message, started_at, ended_at, heartbeat_at, cancel_requested_at, created_at)
      VALUES('RUN-LATE', ?, ?, 'subagent:codex', 1, 'mock', ?, 1, 'SUCCEEDED', 'SUCCESS', NULL, '{}', '[]', NULL, 'TERMINAL', NULL, NULL, ?, ?, ?, NULL, ?)`).run(task.id, worker.id, root, at, at, at, at);
    fx.store.db.prepare(`INSERT INTO results(id, task_id, run_id, outcome, change_summary, artifacts_json, verified_actions_json, test_plan, risks_json, unresolved_json, findings_json, evidence_refs_json, checkpoint_json, request_proposal_json, raw_output_excerpt, created_at)
      VALUES(?, ?, 'RUN-LATE', 'SUCCESS', 'late', '[]', '[]', '', '[]', '[]', '[]', '["EVIDENCE-LATE"]', NULL, NULL, '', ?)`).run(resultId, task.id, at);
    fx.store.db.prepare(`INSERT INTO evidence(id, result_id, kind, ref, status, details_json, created_at) VALUES('EVIDENCE-LATE', ?, 'FILE', 'src/a.js', 'VERIFIED', '{}', ?)`).run(resultId, at);
    fx.store.db.prepare(`UPDATE tasks SET status='SUBMITTED', result_id=? WHERE id=?`).run(resultId, task.id);
    const project = fx.store.getProject(fx.projectId);
    fx.plane.stopProject({ actor: OWNER, operationId: operation('stop'), projectId: project.id, expectedVersion: project.version, reason: 'stop before late review' });
    assert.throws(() => fx.governance.submitReview({
      actor: { type: 'pl', id: project.leadAgentId }, operationId: operation('review'), taskId: task.id,
      decision: 'APPROVE', issues: [], evidenceRefs: ['EVIDENCE-LATE'],
    }), (error) => error.code === 'PROJECT_NOT_ACTIVE');
    assert.equal(fx.store.getTask(task.id).status, 'SUBMITTED');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifyTask refuses to VERIFY a Task once the Project is completed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r3-complete-'));
  let fx;
  try {
    fx = await fixture(root);
    const task = createTask(fx, 'PL');
    const at = new Date().toISOString();
    fx.store.db.prepare(`UPDATE tasks SET status='VERIFIED' WHERE id=?`).run(task.id);
    const project = fx.store.getProject(fx.projectId);
    fx.plane.completeProject({ actor: OWNER, operationId: operation('complete'), projectId: project.id, expectedVersion: project.version });
    assert.equal(fx.store.getProject(fx.projectId).status, 'COMPLETED');
    assert.throws(() => fx.governance.verifyTask({
      projectId: project.id, task, reviewId: 'REVIEW-LATE', actor: { type: 'pl', id: project.leadAgentId }, evidenceRefs: ['E'], at,
    }), (error) => error.code === 'PROJECT_NOT_ACTIVE');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R3.3: Project ↔ PL Session binding is isolated per Project and idempotent
// ---------------------------------------------------------------------------

test('PL Session binding is per-Project and re-binding is idempotent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r3-session-'));
  let fx;
  try {
    fx = await fixture(root);
    const projectA = fx.store.getProject(fx.projectId);
    fx.plane.bindProjectPlSession({ actor: OWNER, operationId: operation('bind'), projectId: projectA.id, plSessionId: 'session-a' });
    assert.equal(fx.store.getProject(projectA.id).plSessionId, 'session-a');
    fx.plane.bindProjectPlSession({ actor: OWNER, operationId: operation('bind'), projectId: projectA.id, plSessionId: 'session-a2' });
    assert.equal(fx.store.getProject(projectA.id).plSessionId, 'session-a2');
    const state = fx.plane.createProject({ actor: OWNER, operationId: operation('project2'), ownerId: OWNER.id, name: 'R3 second', workspaceDir: root, initialGoal: 'second', maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official', replanEveryN: 5 });
    const projectB = state.selected.project;
    fx.plane.bindProjectPlSession({ actor: OWNER, operationId: operation('bind'), projectId: projectB.id, plSessionId: 'session-b' });
    assert.equal(fx.store.getProject(projectB.id).plSessionId, 'session-b');
    assert.notEqual(fx.store.getProject(projectA.id).plSessionId, fx.store.getProject(projectB.id).plSessionId);
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});

test('PL Session binding is rejected for a stopped Project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r3-session-stop-'));
  let fx;
  try {
    fx = await fixture(root);
    const project = fx.store.getProject(fx.projectId);
    fx.plane.stopProject({ actor: OWNER, operationId: operation('stop'), projectId: project.id, expectedVersion: project.version, reason: 'stop' });
    assert.throws(() => fx.plane.bindProjectPlSession({
      actor: OWNER, operationId: operation('bind'), projectId: project.id, plSessionId: 'late-session',
    }), (error) => error.code === 'PROJECT_NOT_ACTIVE');
  } finally {
    await dispose(fx);
    rmSync(root, { recursive: true, force: true });
  }
});
