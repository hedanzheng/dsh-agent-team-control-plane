import test from 'node:test';
import assert from 'node:assert/strict';
import { createPLBridgeTools, installPLBridge } from '../../src/host/pl-bridge.js';

const project = {
  id: 'PROJECT-1',
  ownerId: 'human-owner',
  leadAgentId: 'AGENT-PL-1',
  version: 4,
};

function snapshot(extra = {}) {
  return {
    selected: {
      project: { ...project, status: 'ACTIVE' },
      interview: null,
      charters: [],
      approvals: [],
      agents: [],
      tasks: [],
      taskRuns: [],
      results: [],
      evidence: [],
      reviews: [],
      findings: [],
      planChecks: [],
      activities: [],
      ...extra,
    },
  };
}

function fixture() {
  const calls = [];
  const state = snapshot();
  const controlPlane = {
    requireProject(id) { assert.equal(id, project.id); return project; },
    requireTask(_project, id) { return { id, version: 2, resultId: 'RESULT-1' }; },
    requireProjectAgent(_project, id) { return { id, role: 'WORKER', status: 'IDLE' }; },
    snapshot(id) { calls.push(['snapshot', id]); return state; },
    answerInterview(input) { calls.push(['answerInterview', input]); return state; },
    createTask(input) { calls.push(['createTask', input]); return state; },
    assignTask(input) { calls.push(['assignTask', input]); return state; },
  };
  const coordinator = {
    startTaskRun(input) { calls.push(['startTaskRun', input]); return state; },
  };
  const governance = {
    submitReview(input) { calls.push(['submitReview', input]); return state; },
  };
  const store = {
    listAgents() { return [{ id: 'AGENT-WORKER-1', role: 'WORKER', status: 'IDLE', currentTaskId: null }]; },
    getResult() { return { id: 'RESULT-1', evidenceRefs: ['EVIDENCE-1'] }; },
  };
  const tools = createPLBridgeTools({
    controlPlane, coordinator, governance, store,
  });
  return { calls, tools };
}

function named(tools, name) {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool;
}

test('PL bridge exposes state and workflow tools without Human approval actions', () => {
  const { tools } = fixture();
  assert.deepEqual(tools.map((item) => item.name), [
    'agent_team_project_state',
    'agent_team_record_interview',
    'agent_team_create_task',
    'agent_team_assign_task',
    'agent_team_start_task_run',
    'agent_team_review_task',
  ]);
  assert.equal(tools.some((item) => /approve|stop_project/.test(item.name)), false);
});

test('record interview binds explicit answers to the Human owner and current version', async () => {
  const { calls, tools } = fixture();
  const value = await named(tools, 'agent_team_record_interview').execute({
    project_id: project.id,
    scope_allowed: ['src'],
    constraints: ['zero dependencies'],
    success_criteria: ['npm test passes'],
  });
  assert.equal(JSON.parse(value).project.id, project.id);
  const input = calls.find(([name]) => name === 'answerInterview')[1];
  assert.deepEqual(input.actor, { type: 'human', id: 'human-owner' });
  assert.equal(input.expectedVersion, 4);
  assert.deepEqual(input.answers.scope_forbidden, []);
  assert.match(input.operationId, /^pl-tool:record-interview:/);
});

test('formal Task operations always use the assigned PL identity', async () => {
  const { calls, tools } = fixture();
  await named(tools, 'agent_team_create_task').execute({
    project_id: project.id,
    title: 'T1', goal: 'Design', scope_allowed: ['docs/interface.md'],
    acceptance: ['contract written'], dependency_ids: [],
  });
  await named(tools, 'agent_team_assign_task').execute({ project_id: project.id, task_id: 'TASK-1' });
  await named(tools, 'agent_team_start_task_run').execute({
    project_id: project.id,
    task_id: 'TASK-1',
    verification_commands: ['npm test'],
  }, { signal: new AbortController().signal });
  for (const name of ['createTask', 'assignTask', 'startTaskRun']) {
    const input = calls.find(([called]) => called === name)[1];
    assert.deepEqual(input.actor, { type: 'pl', id: 'AGENT-PL-1' });
  }
  assert.deepEqual(calls.find(([name]) => name === 'startTaskRun')[1].verificationCommands, [{ command: 'npm test' }]);
});

test('PL review consumes authoritative Result evidence', async () => {
  const { calls, tools } = fixture();
  await named(tools, 'agent_team_review_task').execute({
    project_id: project.id,
    task_id: 'TASK-1',
    decision: 'APPROVE',
  });
  const input = calls.find(([name]) => name === 'submitReview')[1];
  assert.deepEqual(input.evidenceRefs, ['EVIDENCE-1']);
  assert.deepEqual(input.actor, { type: 'pl', id: 'AGENT-PL-1' });
});

test('installation registers policy and disposes every registration', () => {
  const registered = [];
  const disposed = [];
  const ctx = {
    tools: { register(tool) { registered.push(tool.name); return () => disposed.push(tool.name); } },
    systemPrompt: {
      getSectionOrder() { return 100; },
      section(section) { registered.push(section.name); return () => disposed.push(section.name); },
    },
  };
  const dispose = installPLBridge(ctx, {
    controlPlane: {
      requireProject: () => project,
      requireTask: () => ({ id: 'TASK-1', version: 1, resultId: 'RESULT-1' }),
      requireProjectAgent: () => ({ id: 'AGENT-WORKER-1' }),
      snapshot: () => snapshot(),
      answerInterview: () => snapshot(),
      createTask: () => snapshot(),
      assignTask: () => snapshot(),
    },
    coordinator: { startTaskRun: () => snapshot() },
    governance: { submitReview: () => snapshot() },
    store: { listAgents: () => [], getResult: () => ({ evidenceRefs: ['EVIDENCE-1'] }) },
  });
  assert.equal(registered.length, 7);
  dispose();
  assert.equal(disposed.length, 7);
  assert.equal(disposed.at(-1), 'agent_team_project_state');
});
