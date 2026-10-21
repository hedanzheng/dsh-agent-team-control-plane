import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';

const OWNER = { type: 'human', id: 'human-owner' };

function scanner(startCounter) {
  return {
    async scan() {
      startCounter.scans += 1;
      const lastScannedAt = new Date().toISOString();
      return {
        scannedAt: lastScannedAt,
        runtimes: [
          {
            providerKey: 'harness:deepseek-official', kind: 'harness-agent', displayName: 'DeepSeek Official',
            availability: 'AVAILABLE', authorized: false, capabilities: { oneShot: true, sessionResume: true },
            source: 'mock-host', lastScannedAt,
          },
          {
            providerKey: 'subagent:codex', kind: 'external-worker', displayName: 'Codex one-shot Worker',
            availability: 'AVAILABLE', authorized: false, capabilities: { oneShot: true, sessionResume: false },
            source: 'mock-host', lastScannedAt,
          },
        ],
        skillDiscovery: { complete: true, grillMeAvailable: false, skills: [] },
        errors: [],
      };
    },
  };
}

function operation(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

test('Phase 1 lifecycle is durable, bounded, authorized, and starts no runtimes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-team-phase1-'));
  const database = join(root, 'control-plane.sqlite');
  const counters = { scans: 0, modelStarts: 0 };
  let store = new ControlPlaneStore(database);
  try {
    let plane = new AgentTeamControlPlane(store, scanner(counters));
    let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: root });
    assert.equal(state.runtimes.length, 2);
    assert.equal(state.system.skillDiscovery.grillMeAvailable, false);

    for (const providerKey of ['harness:deepseek-official', 'subagent:codex']) {
      state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('auth'), providerKey, authorized: true });
    }
    assert.ok(state.runtimes.every((runtime) => runtime.authorized));

    state = plane.createProject({
      actor: OWNER, operationId: operation('project'), ownerId: OWNER.id,
      name: 'Phase 1 acceptance', workspaceDir: root, initialGoal: 'Build a durable three-agent control plane.',
      maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official',
    });
    let selected = state.selected;
    assert.equal(selected.project.status, 'CHARTER_INTERVIEW');
    assert.equal(selected.interview.mode, 'fallback');
    assert.equal(selected.interview.questions.length, 3);
    assert.deepEqual(selected.agents.map((agent) => agent.status), ['PENDING_APPROVAL']);
    assert.equal(counters.modelStarts, 0);

    const projectId = selected.project.id;
    assert.throws(() => plane.answerInterview({
      actor: OWNER, operationId: operation('stale'), projectId, expectedVersion: 99,
      answers: { scope_allowed: ['src'], constraints: ['Phase 1 only'], success_criteria: ['tests pass'] },
    }), (error) => error.code === 'VERSION_CONFLICT');

    state = plane.answerInterview({
      actor: OWNER, operationId: operation('interview'), projectId, expectedVersion: selected.project.version,
      answers: {
        scope_allowed: ['agent-team-plugin', 'tests', 'docs'],
        constraints: ['Stop before Phase 2', 'Do not start unassigned workers'],
        success_criteria: ['Three approved Agent Records persist after restart'],
      },
    });
    selected = state.selected;
    assert.equal(selected.project.status, 'CHARTER_PENDING_APPROVAL');
    assert.equal(selected.charters.at(-1).status, 'DRAFT');
    assert.ok(selected.charters.at(-1).userConfirmed.scopeAllowed.includes('agent-team-plugin'));
    assert.ok(selected.charters.at(-1).plAssumptions.length > 0);

    assert.throws(() => plane.approveCharter({
      actor: { type: 'pl', id: selected.project.leadAgentId }, operationId: operation('forbidden'),
      projectId, expectedVersion: selected.project.version,
    }), (error) => error.code === 'FORBIDDEN');

    state = plane.approveCharter({
      actor: OWNER, operationId: operation('charter-approval'), projectId,
      expectedVersion: selected.project.version,
    });
    selected = state.selected;
    assert.equal(selected.project.status, 'TEAM_PENDING_APPROVAL');
    assert.equal(selected.charters.at(-1).status, 'APPROVED');
    const proposed = selected.approvals.find((approval) => approval.kind === 'TEAM' && approval.status === 'PENDING').payload.members;
    assert.equal(proposed.length, 3);

    // Regression: a proposal created before a later Host scan may retain a stale
    // Worker key. Approval must rebind it to a currently authorized external runtime.
    const runtimeChangedAt = new Date().toISOString();
    store.upsertRuntime({
      providerKey: 'subagent:spawn', kind: 'external-worker', displayName: 'spawn one-shot Worker',
      availability: 'AVAILABLE', capabilities: { oneShot: true, sessionResume: false },
      source: 'mock-host', lastScannedAt: runtimeChangedAt,
    });
    store.markUnseenRuntimesUnavailable(new Set(['harness:deepseek-official', 'subagent:spawn']), runtimeChangedAt);
    store.setRuntimeAuthorized('subagent:spawn', true);

    const four = [...proposed, {
      id: 'AGENT-OVER-LIMIT', displayName: 'Extra', providerKey: 'subagent:codex',
      role: 'WORKER', permissions: ['task:execute-assigned'], skills: [],
    }];
    assert.throws(() => plane.proposeTeam({
      actor: { type: 'pl', id: selected.project.leadAgentId }, operationId: operation('over-limit'),
      projectId, expectedVersion: selected.project.version, members: four,
    }), (error) => error.code === 'AGENT_LIMIT_EXCEEDED');

    const approveOperation = operation('team-approval');
    state = plane.approveTeam({
      actor: OWNER, operationId: approveOperation, projectId, expectedVersion: selected.project.version,
    });
    selected = state.selected;
    assert.equal(selected.project.status, 'ACTIVE');
    assert.equal(selected.agents.length, 3);
    assert.deepEqual(new Set(selected.agents.map((agent) => agent.role)), new Set(['PROJECT_LEAD', 'WORKER', 'REVIEWER']));
    assert.ok(selected.agents.every((agent) => agent.status === 'IDLE' && agent.currentTaskId === null));
    assert.equal(selected.agents.find((agent) => agent.role === 'WORKER').providerKey, 'subagent:spawn');
    assert.equal(
      selected.approvals.find((approval) => approval.kind === 'TEAM' && approval.status === 'APPROVED')
        .payload.members.find((member) => member.role === 'WORKER').providerKey,
      'subagent:spawn',
    );
    assert.equal(counters.modelStarts, 0);

    assert.throws(() => plane.authorizeRuntime({
      actor: OWNER, operationId: approveOperation, providerKey: 'subagent:codex', authorized: false,
    }), (error) => error.code === 'OPERATION_ALREADY_APPLIED');

    store.close();
    store = null;
    store = new ControlPlaneStore(database);
    plane = new AgentTeamControlPlane(store, scanner(counters));
    selected = plane.snapshot(projectId).selected;
    assert.equal(selected.project.status, 'ACTIVE');
    assert.equal(selected.agents.length, 3);
    assert.ok(selected.agents.every((agent) => agent.status === 'IDLE'));
    assert.equal(counters.modelStarts, 0);
  } finally {
    if (store) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Human-selected team size creates one PL, one Reviewer, and the requested Worker count', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-team-size-'));
  const store = new ControlPlaneStore(join(root, 'control-plane.sqlite'));
  try {
    const plane = new AgentTeamControlPlane(store, scanner({ scans: 0 }));
    let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: root });
    for (const providerKey of ['harness:deepseek-official', 'subagent:codex']) {
      state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('auth'), providerKey, authorized: true });
    }
    assert.throws(() => plane.createProject({
      actor: OWNER, operationId: operation('too-small'), ownerId: OWNER.id,
      name: 'Invalid team', workspaceDir: root, initialGoal: 'Must reject a team smaller than the required roles.',
      maxAgents: 2, leadRuntimeKey: 'harness:deepseek-official',
    }), (error) => error.code === 'INVALID_INPUT');

    state = plane.createProject({
      actor: OWNER, operationId: operation('project'), ownerId: OWNER.id,
      name: 'Five Agent team', workspaceDir: root, initialGoal: 'Create a five-Agent governed team.',
      maxAgents: 5, leadRuntimeKey: 'harness:deepseek-official',
    });
    const projectId = state.selected.project.id;
    state = plane.answerInterview({
      actor: OWNER, operationId: operation('interview'), projectId,
      expectedVersion: state.selected.project.version,
      answers: { scope_allowed: ['src'], constraints: ['No dependencies'], success_criteria: ['Team has five active identities'] },
    });
    state = plane.approveCharter({
      actor: OWNER, operationId: operation('charter'), projectId,
      expectedVersion: state.selected.project.version,
    });
    const proposed = state.selected.approvals.find((item) => item.kind === 'TEAM' && item.status === 'PENDING').payload.members;
    assert.equal(proposed.length, 5);
    assert.equal(proposed.filter((item) => item.role === 'PROJECT_LEAD').length, 1);
    assert.equal(proposed.filter((item) => item.role === 'WORKER').length, 3);
    assert.equal(proposed.filter((item) => item.role === 'REVIEWER').length, 1);
    assert.deepEqual(proposed.filter((item) => item.role === 'WORKER').map((item) => item.displayName), [
      'Implementation Worker 1', 'Implementation Worker 2', 'Implementation Worker 3',
    ]);

    state = plane.approveTeam({
      actor: OWNER, operationId: operation('team'), projectId,
      expectedVersion: state.selected.project.version,
    });
    assert.equal(state.selected.agents.length, 5);
    assert.equal(state.selected.agents.every((agent) => agent.status === 'IDLE'), true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

