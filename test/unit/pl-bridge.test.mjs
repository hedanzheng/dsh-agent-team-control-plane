import test from 'node:test';
import assert from 'node:assert/strict';
import { createPLBridgeTools, installPLBridge } from '../../src/host/pl-bridge.js';

const project = {
  id: 'PROJECT-1',
  ownerId: 'human-owner',
  leadAgentId: 'AGENT-PL-1',
  plSessionId: 'SESSION-PL-1',
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
      reviewRuns: [],
      requests: [],
      responses: [],
      requestRuns: [],
      taskProposals: [],
      findings: [],
      planChecks: [],
      activities: [],
      verificationCommands: [],
      ...extra,
    },
  };
}

function fixture(overrides = {}) {
  const calls = [];
  const state = snapshot();
  const parentAgent = { id: project.plSessionId };
  const liveAgents = new Set();
  const projectRecord = overrides.project ?? { ...project };
  const plStatus = overrides.plStatus ?? 'IDLE';
  const controlPlane = {
    requireProject(id) { return projectRecord; },
    requireTask(_project, id) { return { id, version: 2, status: 'READY', resultId: 'RESULT-1' }; },
    requireProjectAgent(_project, id) { return { id, role: 'WORKER', status: 'IDLE' }; },
    snapshot(id) { calls.push(['snapshot', id]); return state; },
    answerInterview(input) { calls.push(['answerInterview', input]); return state; },
    createTask(input) { calls.push(['createTask', input]); return state; },
    assignTask(input) { calls.push(['assignTask', input]); return state; },
    transitionTask(input) { calls.push(['transitionTask', input]); return state; },
    resolveVerificationCommands(projectId, commandIds) {
      calls.push(['resolveVerificationCommands', { projectId, commandIds }]);
      return commandIds.map((commandId) => ({ command: `approved:${commandId}`, timeoutMs: 120000 }));
    },
  };
  const coordinator = {
    startTaskRun(input) { calls.push(['startTaskRun', input]); return state; },
  };
  const governance = {
    respondRequest(input) { calls.push(['respondRequest', input]); return state; },
    submitReview(input) { calls.push(['submitReview', input]); return state; },
    requestIndependentReview(input) { calls.push(['requestIndependentReview', input]); return state; },
  };
  const store = {
    listAgents() {
      return [
        { id: project.leadAgentId, role: 'PROJECT_LEAD', status: plStatus, currentTaskId: null },
        { id: 'AGENT-WORKER-1', role: 'WORKER', status: 'IDLE', currentTaskId: null },
      ];
    },
    getResult() { return { id: 'RESULT-1', evidenceRefs: ['EVIDENCE-1'] }; },
  };
  const adapters = {
    isLiveParent(agent) { return agent === parentAgent || liveAgents.has(agent); },
    bindProjectParent(projectId, parent) { calls.push(['bindProjectParent', { projectId, parent }]); },
  };
  const tools = createPLBridgeTools({
    controlPlane, coordinator, governance, store, adapters,
  });
  return { calls, tools, parentAgent, project: projectRecord, liveAgents };
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
    'agent_team_respond_request',
    'agent_team_cancel_task',
    'agent_team_request_review',
    'agent_team_review_task',
  ]);
  assert.equal(tools.some((item) => /approve|stop_project/.test(item.name)), false);
});

test('record interview submits a PL proposal with the assigned PL identity, not a Human actor', async () => {
  const { calls, tools, parentAgent } = fixture();
  const value = await named(tools, 'agent_team_record_interview').execute({
    project_id: project.id,
    scope_allowed: ['src'],
    constraints: ['zero dependencies'],
    success_criteria: ['npm test passes'],
  }, { agent: parentAgent });
  assert.equal(JSON.parse(value).project.id, project.id);
  const input = calls.find(([name]) => name === 'answerInterview')[1];
  // R1.2: the PL records interview facts as a proposal; the actor is never a
  // fabricated Human confirmation.
  assert.deepEqual(input.actor, { type: 'pl', id: 'AGENT-PL-1' });
  assert.equal(input.expectedVersion, 4);
  assert.deepEqual(input.answers.scope_forbidden, []);
  assert.match(input.operationId, /^pl-tool:record-interview:/);
});

test('formal Task operations always use the assigned PL identity', async () => {
  const { calls, tools, parentAgent } = fixture();
  const exec = { signal: new AbortController().signal, agent: parentAgent };
  await named(tools, 'agent_team_create_task').execute({
    project_id: project.id,
    title: 'T1', goal: 'Design', scope_allowed: ['docs/interface.md'],
    acceptance: ['contract written'], dependency_ids: [],
  }, exec);
  await named(tools, 'agent_team_assign_task').execute({ project_id: project.id, task_id: 'TASK-1' }, exec);
  await named(tools, 'agent_team_start_task_run').execute({
    project_id: project.id,
    task_id: 'TASK-1',
    verification_command_ids: ['VCMD-1'],
  }, exec);
  for (const name of ['createTask', 'assignTask', 'startTaskRun']) {
    const input = calls.find(([called]) => called === name)[1];
    assert.deepEqual(input.actor, { type: 'pl', id: 'AGENT-PL-1' });
  }
  // R1.4: only Human-approved command IDs are resolved to the whitelist.
  assert.deepEqual(calls.find(([name]) => name === 'startTaskRun')[1].verificationCommands, [{ command: 'approved:VCMD-1', timeoutMs: 120000 }]);
  assert.equal(calls.find(([name]) => name === 'startTaskRun')[1].parentAgent, parentAgent);
  assert.deepEqual(calls.find(([name]) => name === 'bindProjectParent')[1], { projectId: project.id, parent: parentAgent });
});

test('free-text verification commands are rejected before any Run starts', async () => {
  const { calls, tools, parentAgent } = fixture();
  await assert.rejects(
    named(tools, 'agent_team_start_task_run').execute({
      project_id: project.id,
      task_id: 'TASK-1',
      verification_commands: [{ command: 'npm test' }],
    }, { agent: parentAgent }),
    (error) => error.code === 'VERIFICATION_COMMANDS_REJECTED',
  );
  // No command resolution and no Worker Run may be created.
  assert.equal(calls.some(([name]) => name === 'resolveVerificationCommands'), false);
  assert.equal(calls.some(([name]) => name === 'startTaskRun'), false);
});

test('a Worker Run without an approved verification command ID is rejected before start', async () => {
  const { calls, tools, parentAgent } = fixture();
  await assert.rejects(
    named(tools, 'agent_team_start_task_run').execute({
      project_id: project.id,
      task_id: 'TASK-1',
      verification_command_ids: [],
    }, { agent: parentAgent }),
    (error) => error.code === 'VERIFICATION_COMMAND_REQUIRED',
  );
  assert.equal(calls.some(([name]) => name === 'resolveVerificationCommands'), false);
  assert.equal(calls.some(([name]) => name === 'startTaskRun'), false);
});

test('project state defaults to a compact summary and supports focused Task detail', async () => {
  const state = snapshot({
    tasks: [{ id: 'TASK-1', title: 'T1', status: 'WAITING', version: 2, assignedAgentId: 'AGENT-WORKER-1', dependencies: [], reviewPolicy: 'PL', resultId: null, waiting: { onRef: 'REQUEST-1' }, scope: { allowed: ['src/**'], forbidden: [] }, acceptance: ['done'] }],
    taskRuns: [{ id: 'RUN-1', taskId: 'TASK-1', attempt: 1, status: 'TIMED_OUT', terminalKind: 'TIMED_OUT' }],
    requests: [{ id: 'REQUEST-1', sourceTaskId: 'TASK-1', status: 'PENDING', toAgentId: project.leadAgentId, body: 'Need a decision' }],
    verificationCommands: [{ id: 'VCMD-1', status: 'APPROVED', command: 'npm test' }],
  });
  const fx = fixture();
  // Replace the fixture snapshot return while preserving its authorization setup.
  const stateTool = named(createPLBridgeTools({
    controlPlane: {
      requireProject: () => fx.project,
      snapshot: () => state,
    },
    coordinator: {}, governance: {},
    store: { listAgents: () => [{ id: project.leadAgentId, role: 'PROJECT_LEAD', status: 'IDLE' }] },
    adapters: { isLiveParent: (agent) => agent === fx.parentAgent, bindProjectParent() {} },
  }), 'agent_team_project_state');
  const summary = JSON.parse(await stateTool.execute({ project_id: project.id }, { agent: fx.parentAgent }));
  assert.equal(summary.tasks[0].latestRun.id, 'RUN-1');
  assert.equal(summary.openRequests[0].id, 'REQUEST-1');
  assert.equal(summary.taskRuns, undefined);
  const detail = JSON.parse(await stateTool.execute({ project_id: project.id, task_id: 'TASK-1' }, { agent: fx.parentAgent }));
  assert.equal(detail.task.id, 'TASK-1');
  assert.equal(detail.taskRuns.length, 1);
});

test('PL can answer an addressed Worker Request and cancel a superseded Task', async () => {
  const { calls, tools, parentAgent } = fixture();
  await named(tools, 'agent_team_respond_request').execute({
    project_id: project.id,
    request_id: 'REQUEST-1',
    outcome: 'ANSWER',
    body: 'Use the final contract and replace the placeholder assertion.',
  }, { agent: parentAgent });
  await named(tools, 'agent_team_cancel_task').execute({
    project_id: project.id,
    task_id: 'TASK-1',
    reason: 'Superseded by a corrected Task',
  }, { agent: parentAgent });
  assert.deepEqual(calls.find(([name]) => name === 'respondRequest')[1].actor, { type: 'pl', id: project.leadAgentId });
  assert.equal(calls.find(([name]) => name === 'transitionTask')[1].toStatus, 'CANCELLED');
});

test('the dependencies alias is rejected loudly, never silently dropped', async () => {
  const { calls, tools, parentAgent } = fixture();
  await assert.rejects(
    named(tools, 'agent_team_create_task').execute({
      project_id: project.id,
      title: 'T1', goal: 'Design', scope_allowed: ['src/**'],
      acceptance: ['contract written'],
      dependencies: ['TASK-0'],
    }, { agent: parentAgent }),
    (error) => error.code === 'INVALID_INPUT',
  );
  // The misspelled call must not create a Task with missing edges.
  assert.equal(calls.some(([name]) => name === 'createTask'), false);
});

test('PL review consumes authoritative Result evidence', async () => {
  const { calls, tools, parentAgent } = fixture();
  await named(tools, 'agent_team_review_task').execute({
    project_id: project.id,
    task_id: 'TASK-1',
    decision: 'APPROVE',
  }, { agent: parentAgent });
  const input = calls.find(([name]) => name === 'submitReview')[1];
  assert.deepEqual(input.evidenceRefs, ['EVIDENCE-1']);
  assert.deepEqual(input.actor, { type: 'pl', id: 'AGENT-PL-1' });
});

test('PL can launch a real independent Reviewer Run with the live parent Agent', async () => {
  const { calls, tools, parentAgent } = fixture();
  await named(tools, 'agent_team_request_review').execute({
    project_id: project.id,
    task_id: 'TASK-1',
  }, { agent: parentAgent });
  const input = calls.find(([name]) => name === 'requestIndependentReview')[1];
  assert.deepEqual(input.actor, { type: 'pl', id: 'AGENT-PL-1' });
  assert.equal(input.parentAgent, parentAgent);
  assert.match(input.operationId, /^pl-tool:request-review:/);
});

test('missing executing Agent context is rejected without side effects', async () => {
  const { calls, tools } = fixture();
  await assert.rejects(
    named(tools, 'agent_team_create_task').execute({
      project_id: project.id,
      title: 'T1', goal: 'Design', scope_allowed: ['src'],
      acceptance: ['contract'], dependency_ids: [],
    }),
    (error) => error.code === 'PL_AGENT_REQUIRED',
  );
  assert.equal(calls.length, 0);
});

test('an Agent that is not in the live Host registry is rejected', async () => {
  const { tools } = fixture();
  const unknownAgent = { id: 'SESSION-PL-1', ghost: true };
  await assert.rejects(
    named(tools, 'agent_team_project_state').execute({ project_id: project.id }, { agent: unknownAgent }),
    (error) => error.code === 'PL_AGENT_NOT_LIVE',
  );
});

test('an ordinary Session that is not the bound PL Session is rejected', async () => {
  const { calls, tools, liveAgents } = fixture();
  const ordinaryAgent = { id: 'SESSION-ORDINARY' };
  liveAgents.add(ordinaryAgent);
  await assert.rejects(
    named(tools, 'agent_team_create_task').execute({
      project_id: project.id,
      title: 'T1', goal: 'Design', scope_allowed: ['src'],
      acceptance: ['contract'], dependency_ids: [],
    }, { agent: ordinaryAgent }),
    (error) => error.code === 'PL_SESSION_MISMATCH',
  );
  assert.equal(calls.length, 0);
});

test("another Project's bound PL Session cannot operate this Project", async () => {
  const { calls, tools, liveAgents } = fixture();
  const foreignAgent = { id: 'SESSION-OTHER-PROJECT-PL' };
  liveAgents.add(foreignAgent);
  await assert.rejects(
    named(tools, 'agent_team_project_state').execute({ project_id: project.id }, { agent: foreignAgent }),
    (error) => error.code === 'PL_SESSION_MISMATCH',
  );
  assert.equal(calls.length, 0);
});

test('a Project without a bound PL Session rejects every agent_team_* tool', async () => {
  const { calls, tools, parentAgent } = fixture({ project: { ...project, plSessionId: null } });
  await assert.rejects(
    named(tools, 'agent_team_project_state').execute({ project_id: project.id }, { agent: parentAgent }),
    (error) => error.code === 'PL_SESSION_NOT_BOUND',
  );
  assert.equal(calls.length, 0);
});

test('a replaced Project Lead Session is rejected and leaves no parent binding', async () => {
  const { calls, tools, parentAgent } = fixture({ plStatus: 'REPLACED' });
  await assert.rejects(
    named(tools, 'agent_team_create_task').execute({
      project_id: project.id,
      title: 'T1', goal: 'Design', scope_allowed: ['src'],
      acceptance: ['contract'], dependency_ids: [],
    }, { agent: parentAgent }),
    (error) => error.code === 'PL_AGENT_REPLACED',
  );
  assert.equal(calls.length, 0);
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
      transitionTask: () => snapshot(),
    },
    coordinator: { startTaskRun: () => snapshot() },
    governance: { submitReview: () => snapshot(), requestIndependentReview: () => snapshot(), respondRequest: () => snapshot() },
    store: { listAgents: () => [], getResult: () => ({ evidenceRefs: ['EVIDENCE-1'] }) },
    adapters: { isLiveParent: () => false, bindProjectParent() {} },
  });
  assert.equal(registered.length, 10);
  dispose();
  assert.equal(disposed.length, 10);
  assert.equal(disposed.at(-1), 'agent_team_project_state');
});
