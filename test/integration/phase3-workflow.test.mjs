import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { TaskRunCoordinator } from '../../src/host/run-coordinator.js';
import { RESULT_MARKERS } from '../../src/host/result-parser.js';

const OWNER = { type: 'human', id: 'human-owner' };
const operation = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const terminalOutput = (value) => [{ type: 'text', text: `${RESULT_MARKERS.start}\n${JSON.stringify(value)}\n${RESULT_MARKERS.end}` }];
const success = (artifact = 'phase3/output.txt') => ({
  terminalKind: 'SUCCESS', changeSummary: 'Worker completed the assigned change', artifacts: [artifact],
  verifiedActions: ['Worker wrote the file'], testPlan: 'Host command', risks: [], unresolved: [], findings: [], evidenceRefs: [], checkpoint: null, requestProposal: null,
});

function scanner() {
  return { async scan() {
    const lastScannedAt = new Date().toISOString();
    return { scannedAt: lastScannedAt, runtimes: [
      { providerKey: 'harness:deepseek-official', kind: 'harness-agent', displayName: 'DeepSeek', availability: 'AVAILABLE', capabilities: { managementSession: true }, source: 'mock', lastScannedAt },
      { providerKey: 'subagent:codex', kind: 'external-worker', displayName: 'Codex', availability: 'AVAILABLE', capabilities: { oneShot: true }, source: 'mock', lastScannedAt },
    ], skillDiscovery: { complete: true, grillMeAvailable: false, skills: [] }, errors: [] };
  } };
}

class FakeAdapters {
  constructor(factory) { this.factory = factory; this.live = new Map(); }
  describe(providerKey) { return { providerKey, adapter: 'one-shot-subagent', taskExecution: true, capabilities: { oneShot: true, sessionResume: false } }; }
  async startRun(spec) {
    const record = { state: 'RUNNING', cancelled: false, spec };
    this.live.set(spec.runId, record);
    return { runId: spec.runId, runtimeRunId: `fake-${spec.runId}`, capabilities: { oneShot: true } };
  }
  observeRun(runId) { return { runId, state: this.live.get(runId)?.state ?? 'NOT_LIVE' }; }
  cancelRun(runId) { const item = this.live.get(runId); if (!item) return false; item.cancelled = true; item.state = 'CANCEL_REQUESTED'; return true; }
  async collectRunResult(runId) {
    const item = this.live.get(runId);
    const result = await this.factory(item);
    item.state = 'TERMINAL';
    return item.cancelled ? { stopReason: 'aborted', output: [] } : result;
  }
  disposeRun(runId) { this.live.delete(runId); }
  close() { for (const item of this.live.values()) item.cancelled = true; }
}

async function fixture(factory) {
  const root = mkdtempSync(join(tmpdir(), 'agent-team-phase3-'));
  const store = new ControlPlaneStore(join(root, 'control-plane.sqlite'));
  const plane = new AgentTeamControlPlane(store, scanner());
  let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: root });
  for (const providerKey of ['harness:deepseek-official', 'subagent:codex']) {
    state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('auth'), providerKey, authorized: true });
  }
  state = plane.createProject({ actor: OWNER, operationId: operation('project'), ownerId: OWNER.id, name: 'Phase 3', workspaceDir: root, initialGoal: 'Execute governed Worker Tasks.', maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official' });
  const projectId = state.selected.project.id;
  state = plane.answerInterview({ actor: OWNER, operationId: operation('interview'), projectId, expectedVersion: state.selected.project.version, answers: { scope_allowed: ['phase3/**'], constraints: ['one-shot only'], success_criteria: ['evidence persists'] } });
  state = plane.approveCharter({ actor: OWNER, operationId: operation('charter'), projectId, expectedVersion: state.selected.project.version });
  state = plane.approveTeam({ actor: OWNER, operationId: operation('team'), projectId, expectedVersion: state.selected.project.version });
  const adapters = new FakeAdapters(factory);
  const coordinator = new TaskRunCoordinator({ store, controlPlane: plane, adapters, logger: { error() {}, warn() {} } });
  return { root, store, plane, coordinator, projectId };
}

function createAndAssign(fx, title = 'Run task') {
  let state = fx.store.snapshot(fx.projectId);
  state = fx.plane.createTask({
    actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('task'), projectId: fx.projectId,
    expectedProjectVersion: state.selected.project.version, title, goal: 'Write phase3/output.txt with exact content PHASE3_OK',
    scope: { allowed: ['phase3/**'], forbidden: [] }, acceptance: ['phase3/output.txt contains PHASE3_OK'], dependencies: [], controlLevel: 'IMPORTANT', reviewPolicy: 'PL',
  });
  const task = state.selected.tasks.at(-1);
  const worker = state.selected.agents.find((agent) => agent.role === 'WORKER');
  state = fx.plane.assignTask({ actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation('assign'), projectId: fx.projectId, taskId: task.id, expectedVersion: task.version, agentId: worker.id });
  return state.selected.tasks.find((item) => item.id === task.id);
}

async function waitTerminal(store, runId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const run = store.getTaskRun(runId);
    if (run && !['CREATED', 'STARTING', 'RUNNING'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Run did not become terminal');
}

test('Phase 3 persists a real Run/Result/Evidence boundary and never auto-verifies the Task', async () => {
  const fx = await fixture(async () => ({ stopReason: 'completed', output: terminalOutput(success()) }));
  try {
    mkdirSync(join(fx.root, 'phase3'), { recursive: true });
    writeFileSync(join(fx.root, 'phase3', 'output.txt'), 'PHASE3_OK\n');
    const task = createAndAssign(fx);
    const state = fx.coordinator.startTaskRun({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('run'), projectId: fx.projectId, taskId: task.id, expectedVersion: task.version, verificationCommands: [{ command: 'exit 0' }] });
    const runId = state.selected.taskRuns.at(-1).id;
    const run = await waitTerminal(fx.store, runId);
    assert.equal(run.status, 'SUCCEEDED');
    const result = fx.store.getResultByRun(runId);
    assert.equal(result.outcome, 'SUCCESS');
    assert.equal(fx.store.getTask(task.id).status, 'SUBMITTED');
    assert.notEqual(fx.store.getTask(task.id).status, 'VERIFIED');
    assert.ok(fx.store.listEvidence(fx.projectId).some((item) => item.kind === 'FILE' && item.status === 'VERIFIED' && item.details.sha256));
    assert.ok(fx.store.listEvidence(fx.projectId).some((item) => item.kind === 'COMMAND' && item.status === 'VERIFIED'));
    assert.equal(fx.store.db.prepare('SELECT COUNT(*) AS n FROM workspace_locks').get().n, 0);
  } finally { await fx.coordinator.close(); fx.store.close(); rmSync(fx.root, { recursive: true, force: true }); }
});

test('Phase 3 downgrades SUCCESS to PARTIAL when independent verification commands are absent', async () => {
  const fx = await fixture(async () => ({ stopReason: 'completed', output: terminalOutput(success()) }));
  try {
    mkdirSync(join(fx.root, 'phase3'), { recursive: true }); writeFileSync(join(fx.root, 'phase3', 'output.txt'), 'PHASE3_OK\n');
    const task = createAndAssign(fx);
    const state = fx.coordinator.startTaskRun({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('run'), projectId: fx.projectId, taskId: task.id, expectedVersion: task.version, verificationCommands: [] });
    const runId = state.selected.taskRuns.at(-1).id;
    assert.equal((await waitTerminal(fx.store, runId)).status, 'SUCCEEDED');
    assert.equal(fx.store.getResultByRun(runId).outcome, 'PARTIAL');
    assert.equal(fx.store.getTask(task.id).status, 'SUBMITTED');
  } finally { await fx.coordinator.close(); fx.store.close(); rmSync(fx.root, { recursive: true, force: true }); }
});

test('Phase 3 distinguishes cancellation and parse-unknown without fabricating VERIFIED', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fx = await fixture(async () => { await gate; return { stopReason: 'completed', output: [{ type: 'text', text: 'invalid terminal output' }] }; });
  try {
    const task = createAndAssign(fx, 'Cancel task');
    let state = fx.coordinator.startTaskRun({ actor: { type: 'pl', id: fx.store.getProject(fx.projectId).leadAgentId }, operationId: operation('run'), projectId: fx.projectId, taskId: task.id, expectedVersion: task.version, verificationCommands: [] });
    const runId = state.selected.taskRuns.at(-1).id;
    for (let i = 0; i < 100 && fx.store.getTaskRun(runId).status !== 'RUNNING'; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    fx.coordinator.cancelTaskRun({ actor: OWNER, operationId: operation('cancel'), runId });
    release();
    assert.equal((await waitTerminal(fx.store, runId)).status, 'CANCELLED');
    assert.equal(fx.store.getTask(task.id).status, 'CANCELLED');
    assert.notEqual(fx.store.getTask(task.id).status, 'VERIFIED');
  } finally { await fx.coordinator.close(); fx.store.close(); rmSync(fx.root, { recursive: true, force: true }); }

  const unknown = await fixture(async () => ({ stopReason: 'completed', output: [{ type: 'text', text: 'invalid terminal output' }] }));
  try {
    const task = createAndAssign(unknown, 'Unknown task');
    const state = unknown.coordinator.startTaskRun({ actor: { type: 'pl', id: unknown.store.getProject(unknown.projectId).leadAgentId }, operationId: operation('run'), projectId: unknown.projectId, taskId: task.id, expectedVersion: task.version, verificationCommands: [] });
    const runId = state.selected.taskRuns.at(-1).id;
    assert.equal((await waitTerminal(unknown.store, runId)).status, 'UNKNOWN');
    assert.equal(unknown.store.getResultByRun(runId).outcome, 'UNKNOWN');
    assert.equal(unknown.store.getTask(task.id).status, 'WAITING');
  } finally { await unknown.coordinator.close(); unknown.store.close(); rmSync(unknown.root, { recursive: true, force: true }); }
});

test('Phase 3 restart recovery marks active Runs UNKNOWN and does not replay', async () => {
  const fx = await fixture(async () => ({ stopReason: 'completed', output: terminalOutput(success()) }));
  try {
    const task = createAndAssign(fx, 'Recovery task');
    const runId = `RUN-${crypto.randomUUID()}`;
    const at = new Date().toISOString();
    const worker = fx.store.listAgents(fx.projectId).find((agent) => agent.role === 'WORKER');
    fx.store.db.prepare(`INSERT INTO task_runs(id, task_id, agent_id, provider_key, attempt, workspace_ref, write_intent, status, capability_snapshot_json, verification_commands_json, watchdog_state, heartbeat_at, created_at) VALUES(?, ?, ?, ?, 1, ?, 1, 'RUNNING', '{}', '[]', 'HEALTHY', ?, ?)`).run(runId, task.id, worker.id, worker.providerKey, fx.root, at, at);
    fx.store.db.prepare("UPDATE tasks SET status='RUNNING' WHERE id=?").run(task.id);
    fx.store.db.prepare('INSERT INTO workspace_locks(workspace_ref, run_id, acquired_at) VALUES(?, ?, ?)').run(fx.root, runId, at);
    assert.equal(fx.coordinator.recoverInterruptedRuns(), 1);
    assert.equal(fx.store.getTaskRun(runId).status, 'UNKNOWN');
    assert.equal(fx.store.getResultByRun(runId).outcome, 'UNKNOWN');
    assert.equal(fx.store.getTask(task.id).status, 'WAITING');
    assert.equal(fx.store.db.prepare('SELECT COUNT(*) AS n FROM workspace_locks').get().n, 0);
  } finally { await fx.coordinator.close(); fx.store.close(); rmSync(fx.root, { recursive: true, force: true }); }
});

