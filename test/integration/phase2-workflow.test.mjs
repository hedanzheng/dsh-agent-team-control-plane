import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';

const OWNER = { type: 'human', id: 'human-owner' };
const operation = (prefix) => `${prefix}-${crypto.randomUUID()}`;

function mockScanner(counters) {
  return {
    async scan() {
      counters.scans += 1;
      const lastScannedAt = new Date().toISOString();
      return {
        scannedAt: lastScannedAt,
        runtimes: [
          {
            providerKey: 'harness:deepseek-official', kind: 'harness-agent', displayName: 'DeepSeek',
            availability: 'AVAILABLE', capabilities: {}, source: 'mock', lastScannedAt,
          },
          {
            providerKey: 'subagent:codex', kind: 'external-worker', displayName: 'Codex',
            availability: 'AVAILABLE', capabilities: {}, source: 'mock', lastScannedAt,
          },
        ],
        skillDiscovery: { complete: true, grillMeAvailable: false, skills: [] },
        errors: [],
      };
    },
  };
}

async function activeProject(plane, root) {
  let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: root });
  for (const providerKey of ['harness:deepseek-official', 'subagent:codex']) {
    state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('auth'), providerKey, authorized: true });
  }
  state = plane.createProject({
    actor: OWNER, operationId: operation('project'), ownerId: OWNER.id, name: 'Phase 2 acceptance',
    workspaceDir: root, initialGoal: 'Build and validate a governed Task DAG.', maxAgents: 3,
    leadRuntimeKey: 'harness:deepseek-official',
  });
  const projectId = state.selected.project.id;
  state = plane.answerInterview({
    actor: OWNER, operationId: operation('interview'), projectId,
    expectedVersion: state.selected.project.version,
    answers: { scope_allowed: ['agent-team-plugin'], constraints: ['Phase 2 only'], success_criteria: ['Task DAG passes'] },
  });
  state = plane.approveCharter({
    actor: OWNER, operationId: operation('charter'), projectId, expectedVersion: state.selected.project.version,
  });
  state = plane.approveTeam({
    actor: OWNER, operationId: operation('team'), projectId, expectedVersion: state.selected.project.version,
  });
  return state;
}

function taskInput(state, title, dependencies = []) {
  return {
    actor: { type: 'pl', id: state.selected.project.leadAgentId }, operationId: operation(`create-${title}`),
    projectId: state.selected.project.id, expectedProjectVersion: state.selected.project.version,
    title, goal: `Deliver ${title}`, scope: { allowed: [`src/${title.toLowerCase()}/**`], forbidden: ['secrets/**'] },
    acceptance: [`${title} acceptance passes`], dependencies, controlLevel: 'IMPORTANT', reviewPolicy: 'PL',
  };
}

// R2.2: VERIFIED now requires a real SUCCESS Result with evidence that belongs
// to it. Seed a fully-formed Result + Evidence + Run so the DAG transition below
// exercises the genuine gate instead of a synthetic resultId string.
function seedVerifiedResult(store, task) {
  const project = store.getProject(task.projectId);
  const worker = store.listAgents(task.projectId).find((agent) => agent.role === 'WORKER');
  const runId = `RUN-${task.id}`;
  const resultId = `RESULT-${task.id}`;
  const evidenceId = `EVIDENCE-${task.id}`;
  const at = new Date().toISOString();
  store.db.prepare(`INSERT INTO task_runs(id, task_id, agent_id, provider_key, attempt, workspace_ref, write_intent,
    status, terminal_kind, terminal_payload_ref, capability_snapshot_json, verification_commands_json, watchdog_state, created_at)
    VALUES(?, ?, ?, ?, 1, ?, 0, 'SUCCEEDED', 'SUCCESS', ?, '{}', '[]', 'TERMINAL', ?)`).run(
    runId, task.id, worker.id, worker.providerKey, project.workspaceDir, resultId, at,
  );
  store.db.prepare(`INSERT INTO results(id, task_id, run_id, outcome, change_summary, artifacts_json, verified_actions_json,
    test_plan, risks_json, unresolved_json, findings_json, evidence_refs_json, checkpoint_json, request_proposal_json, raw_output_excerpt, created_at)
    VALUES(?, ?, ?, 'SUCCESS', 'seeded result', '[]', '[]', '', '[]', '[]', '[]', ?, NULL, NULL, '', ?)`).run(
    resultId, task.id, runId, JSON.stringify([evidenceId]), at,
  );
  store.db.prepare(`INSERT INTO evidence(id, result_id, kind, ref, status, details_json, created_at)
    VALUES(?, ?, 'FILE', ?, 'VERIFIED', '{}', ?)`).run(evidenceId, resultId, evidenceId, at);
  return { resultId, evidenceId };
}

test('Phase 2 Task DAG, assignment, state, concurrency, proposal, and persistence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-team-phase2-'));
  const database = join(root, 'control-plane.sqlite');
  const counters = { scans: 0, modelStarts: 0 };
  let store = new ControlPlaneStore(database);
  try {
    let plane = new AgentTeamControlPlane(store, mockScanner(counters));
    let state = await activeProject(plane, root);
    const projectId = state.selected.project.id;
    const leadId = state.selected.project.leadAgentId;
    const pl = { type: 'pl', id: leadId };
    const worker = state.selected.agents.find((agent) => agent.role === 'WORKER');
    const reviewer = state.selected.agents.find((agent) => agent.role === 'REVIEWER');
    assert.ok(worker.permissions.includes('task:propose'));

    assert.throws(() => plane.createTask({
      ...taskInput(state, 'Forbidden'), actor: { type: 'agent', id: worker.id },
    }), (error) => error.code === 'FORBIDDEN');
    assert.throws(() => plane.createTask({
      ...taskInput(state, 'WeakCritical'), controlLevel: 'CRITICAL', reviewPolicy: 'AUTO',
    }), (error) => error.code === 'REVIEW_POLICY_TOO_WEAK');

    state = plane.createTask(taskInput(state, 'A'));
    const taskA = state.selected.tasks.find((task) => task.title === 'A');
    state = plane.createTask(taskInput(state, 'B'));
    const taskB = state.selected.tasks.find((task) => task.title === 'B');
    state = plane.createTask(taskInput(state, 'C', [taskA.id, taskB.id]));
    let taskC = state.selected.tasks.find((task) => task.title === 'C');
    assert.equal(state.selected.tasks.find((task) => task.id === taskA.id).status, 'READY');
    assert.equal(state.selected.tasks.find((task) => task.id === taskB.id).status, 'READY');
    assert.equal(taskC.status, 'PENDING');
    assert.equal(taskC.charterVersion, 1);

    assert.throws(() => plane.updateTask({
      actor: pl, operationId: operation('cycle'), projectId, taskId: taskA.id,
      expectedVersion: taskA.version, dependencies: [taskC.id],
    }), (error) => error.code === 'TASK_DAG_CYCLE');
    assert.throws(() => plane.assignTask({
      actor: pl, operationId: operation('blocked-c'), projectId, taskId: taskC.id,
      expectedVersion: taskC.version, agentId: worker.id,
    }), (error) => error.code === 'TASK_NOT_READY');
    assert.throws(() => plane.assignTask({
      actor: pl, operationId: operation('wrong-role'), projectId, taskId: taskA.id,
      expectedVersion: taskA.version, agentId: reviewer.id,
    }), (error) => error.code === 'AGENT_ROLE_FORBIDDEN');

    const sharedVersion = taskA.version;
    state = plane.assignTask({
      actor: pl, operationId: operation('race-winner'), projectId, taskId: taskA.id,
      expectedVersion: sharedVersion, agentId: worker.id,
    });
    assert.throws(() => plane.assignTask({
      actor: pl, operationId: operation('race-loser'), projectId, taskId: taskA.id,
      expectedVersion: sharedVersion, agentId: worker.id,
    }), (error) => error.code === 'VERSION_CONFLICT');
    let assignedA = state.selected.tasks.find((task) => task.id === taskA.id);
    assert.equal(assignedA.assignedAgentId, worker.id);
    assert.throws(() => plane.assignTask({
      actor: pl, operationId: operation('double-agent'), projectId, taskId: taskB.id,
      expectedVersion: taskB.version, agentId: worker.id,
    }), (error) => error.code === 'AGENT_ALREADY_OCCUPIED');

    state = plane.transitionTask({
      actor: { type: 'agent', id: worker.id }, operationId: operation('a-running'), projectId,
      taskId: taskA.id, expectedVersion: assignedA.version, toStatus: 'RUNNING',
    });
    let runningA = state.selected.tasks.find((task) => task.id === taskA.id);
    assert.equal(runningA.status, 'RUNNING');
    assert.throws(() => plane.transitionTask({
      actor: { type: 'agent', id: worker.id }, operationId: operation('bad-wait'), projectId,
      taskId: taskA.id, expectedVersion: runningA.version, toStatus: 'WAITING', reason: 'Need input', waiting: {},
    }), (error) => error.code === 'INVALID_INPUT');
    state = plane.transitionTask({
      actor: { type: 'agent', id: worker.id }, operationId: operation('a-waiting'), projectId,
      taskId: taskA.id, expectedVersion: runningA.version, toStatus: 'WAITING', reason: 'Need approved detail',
      waiting: { onRef: 'DECISION-TEST', checkpointRef: 'CHECKPOINT-A', deadline: '2026-10-20T00:00:00.000Z' },
    });
    let waitingA = state.selected.tasks.find((task) => task.id === taskA.id);
    assert.equal(waitingA.waiting.onRef, 'DECISION-TEST');
    state = plane.transitionTask({
      actor: pl, operationId: operation('a-ready-again'), projectId, taskId: taskA.id,
      expectedVersion: waitingA.version, toStatus: 'READY',
    });
    let readyA = state.selected.tasks.find((task) => task.id === taskA.id);
    assert.equal(readyA.waiting, null);
    state = plane.transitionTask({
      actor: { type: 'agent', id: worker.id }, operationId: operation('a-running-2'), projectId,
      taskId: taskA.id, expectedVersion: readyA.version, toStatus: 'RUNNING',
    });
    runningA = state.selected.tasks.find((task) => task.id === taskA.id);
    const seedA = seedVerifiedResult(store, taskA);
    state = plane.transitionTask({
      actor: { type: 'agent', id: worker.id }, operationId: operation('a-submit'), projectId,
      taskId: taskA.id, expectedVersion: runningA.version, toStatus: 'SUBMITTED',
      resultId: seedA.resultId, evidenceRefs: [seedA.evidenceId],
    });
    let submittedA = state.selected.tasks.find((task) => task.id === taskA.id);
    state = plane.transitionTask({
      actor: pl, operationId: operation('a-verify'), projectId, taskId: taskA.id,
      expectedVersion: submittedA.version, toStatus: 'VERIFIED', evidenceRefs: [seedA.evidenceId],
    });
    taskC = state.selected.tasks.find((task) => task.id === taskC.id);
    assert.equal(taskC.status, 'PENDING', 'C remains blocked until both A and B are VERIFIED');

    let currentB = state.selected.tasks.find((task) => task.id === taskB.id);
    state = plane.assignTask({ actor: pl, operationId: operation('b-assign'), projectId, taskId: taskB.id, expectedVersion: currentB.version, agentId: worker.id });
    currentB = state.selected.tasks.find((task) => task.id === taskB.id);
    state = plane.transitionTask({ actor: { type: 'agent', id: worker.id }, operationId: operation('b-run'), projectId, taskId: taskB.id, expectedVersion: currentB.version, toStatus: 'RUNNING' });
    currentB = state.selected.tasks.find((task) => task.id === taskB.id);
    const seedB = seedVerifiedResult(store, taskB);
    state = plane.transitionTask({
      actor: { type: 'agent', id: worker.id }, operationId: operation('b-submit'), projectId,
      taskId: taskB.id, expectedVersion: currentB.version, toStatus: 'SUBMITTED',
      resultId: seedB.resultId, evidenceRefs: [seedB.evidenceId],
    });
    currentB = state.selected.tasks.find((task) => task.id === taskB.id);
    state = plane.transitionTask({ actor: pl, operationId: operation('b-verify'), projectId, taskId: taskB.id, expectedVersion: currentB.version, toStatus: 'VERIFIED', evidenceRefs: [seedB.evidenceId] });
    taskC = state.selected.tasks.find((task) => task.id === taskC.id);
    assert.equal(taskC.status, 'READY');

    const beforeProposalTaskCount = state.selected.tasks.length;
    state = plane.proposeTask({
      actor: { type: 'agent', id: worker.id }, operationId: operation('proposal'), projectId,
      title: 'Worker suggestion', goal: 'Suggest a follow-up without creating official state',
      scope: { allowed: ['src/suggestion/**'], forbidden: [] }, acceptance: ['PL decides'], dependencies: [],
      controlLevel: 'ROUTINE', reviewPolicy: 'AUTO',
    });
    const proposal = state.selected.taskProposals.at(-1);
    assert.equal(proposal.status, 'PENDING');
    assert.equal(state.selected.tasks.length, beforeProposalTaskCount, 'proposal must not auto-create a formal Task');
    state = plane.createTask({
      actor: pl, operationId: operation('accept-proposal'), projectId, proposalId: proposal.id,
      expectedProjectVersion: state.selected.project.version,
    });
    assert.equal(state.selected.taskProposals.find((item) => item.id === proposal.id).status, 'ACCEPTED');
    assert.ok(state.selected.taskProposals.find((item) => item.id === proposal.id).resultingTaskId);
    assert.equal(state.selected.tasks.length, beforeProposalTaskCount + 1);
    assert.equal(counters.modelStarts, 0);

    store.close();
    store = null;
    store = new ControlPlaneStore(database);
    plane = new AgentTeamControlPlane(store, mockScanner(counters));
    const restored = plane.snapshot(projectId).selected;
    assert.equal(restored.tasks.find((task) => task.id === taskC.id).status, 'READY');
    assert.ok(restored.taskStateEvents.length >= 10);
    assert.equal(restored.taskProposals.find((item) => item.id === proposal.id).status, 'ACCEPTED');
    assert.equal(counters.modelStarts, 0);
  } finally {
    if (store) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

