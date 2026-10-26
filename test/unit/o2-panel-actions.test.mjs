import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fixture() {
  let definition;
  const hooks = new Map();
  let cells;
  let index;
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...(props || {}), children } }; },
    useState(initial) {
      const slot = index++;
      if (!cells[slot]) cells[slot] = { value: typeof initial === 'function' ? initial() : initial };
      const cell = cells[slot];
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useEffect() {},
  };
  const source = readFileSync(resolve('client.js'), 'utf8').replace(
    '    function ProjectDecisions({', '    window.__O2_COMPONENTS__ = { TaskBoard, GovernancePanel };\n    function ProjectDecisions({',
  );
  const window = { __ModuleLoader__: { load(value) { definition = value; } } };
  new Function('window', source)(window);
  definition.factory((name) => { assert.equal(name, 'react'); return React; });
  const calls = [];
  const act = async (action, body) => { calls.push({ action, body }); return true; };
  function renderNode(node, path = 'root') {
    if (node == null || typeof node === 'boolean') return null;
    if (Array.isArray(node)) return node.map((child, i) => renderNode(child, `${path}.${i}`)).filter((child) => child != null);
    if (typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const key = `${path}:${node.type.name}:${node.props.key || ''}`;
      const previous = cells;
      const previousIndex = index;
      cells = hooks.get(key) || [];
      hooks.set(key, cells);
      index = 0;
      const result = node.type(node.props);
      cells = previous;
      index = previousIndex;
      return renderNode(result, `${key}.render`);
    }
    return { type: node.type, props: { ...node.props, children: renderNode(node.props.children, `${path}.children`) } };
  }
  function render(Component, selected, extra = {}) {
    return renderNode(React.createElement(Component, { key: selected.project.id, selected, ownerId: selected.project.ownerId, busy: false, act, ...extra }));
  }
  return { ...window.__O2_COMPONENTS__, render, calls };
}

function all(node, predicate, found = []) {
  if (node == null || typeof node !== 'object') return found;
  if (Array.isArray(node)) { for (const child of node) all(child, predicate, found); return found; }
  if (predicate(node)) found.push(node);
  all(node.props?.children, predicate, found);
  return found;
}

function byId(node, id) { return all(node, (item) => item.props?.['data-testid'] === id)[0]; }
function project(id) { return { id, ownerId: `OWNER-${id}`, leadAgentId: `PL-${id}`, status: 'ACTIVE', version: 1 }; }
function selected(id, overrides = {}) {
  return {
    project: project(id), agents: [{ id: `PL-${id}`, role: 'PROJECT_LEAD', status: 'IDLE', currentTaskId: null }],
    tasks: [], taskRuns: [], results: [], evidence: [], approvals: [], requests: [], responses: [], reviews: [],
    reviewRuns: [], findings: [], planChecks: [], verificationCommands: [], taskProposals: [], ...overrides,
  };
}

test('O2 Request drafts are per request, submit cleans only one, and project switch resets drafts', async () => {
  const fx = fixture();
  const requests = ['REQ-1', 'REQ-2'].map((id) => ({ id, status: 'PENDING', fromAgentId: 'WORKER', toAgentId: 'PL-A', body: id }));
  const a = selected('A', { requests });
  let tree = fx.render(fx.GovernancePanel, a);
  const inputs = all(tree, (node) => node.props?.['data-testid'] === 'request-response-body');
  assert.equal(inputs.length, 2);
  inputs.find((item) => item.props['data-request-id'] === 'REQ-1').props.onChange({ target: { value: 'answer one' } });
  inputs.find((item) => item.props['data-request-id'] === 'REQ-2').props.onChange({ target: { value: 'answer two' } });
  tree = fx.render(fx.GovernancePanel, a);
  await byId(tree, 'respond-REQ-1').props.onClick();
  assert.deepEqual(fx.calls[0], { action: 'respond-request', body: {
    actor: { type: 'pl', id: 'PL-A' }, projectId: 'A', requestId: 'REQ-1', outcome: 'ANSWER', body: 'answer one', evidenceRefs: [],
  } });
  tree = fx.render(fx.GovernancePanel, a);
  assert.equal(all(tree, (node) => node.props?.['data-request-id'] === 'REQ-1')[0].props.value, '');
  assert.equal(all(tree, (node) => node.props?.['data-request-id'] === 'REQ-2')[0].props.value, 'answer two');
  const b = selected('B', { requests: [{ ...requests[1], toAgentId: 'PL-B' }] });
  tree = fx.render(fx.GovernancePanel, b);
  assert.equal(byId(tree, 'request-response-body').props.value, '');
  assert.equal(byId(tree, 'respond-REQ-2').props.disabled, true);
  assert.match(readFileSync(resolve('client.js'), 'utf8'), /h\(GovernancePanel, \{ key: selected\.project\.id/);
});

test('O2 Review issues are per Task; Actor, Task and Project identifiers stay paired', async () => {
  const fx = fixture();
  const tasks = ['TASK-1', 'TASK-2'].map((id) => ({ id, title: id, status: 'SUBMITTED', resultId: `RESULT-${id}`, reviewPolicy: 'PL' }));
  const results = tasks.map((task) => ({ id: task.resultId, outcome: 'SUCCESS', evidenceRefs: [`EV-${task.id}`] }));
  const evidence = tasks.map((task) => ({ id: `EV-${task.id}`, resultId: task.resultId, kind: 'COMMAND', status: 'VERIFIED', ref: 'npm test' }));
  const a = selected('A', { tasks, results, evidence });
  let tree = fx.render(fx.GovernancePanel, a);
  const inputs = all(tree, (node) => node.props?.['data-testid'] === 'review-issue');
  assert.equal(inputs.length, 2);
  inputs[0].props.onChange({ target: { value: 'first issue' } });
  inputs[1].props.onChange({ target: { value: 'second issue' } });
  tree = fx.render(fx.GovernancePanel, a);
  await byId(tree, 'reject-review-TASK-1').props.onClick();
  assert.deepEqual(fx.calls[0], { action: 'submit-review', body: {
    actor: { type: 'pl', id: 'PL-A' }, projectId: 'A', taskId: 'TASK-1', decision: 'REJECT',
    issues: ['first issue'], evidenceRefs: ['EV-TASK-1'], acceptRisk: false,
  } });
  tree = fx.render(fx.GovernancePanel, a);
  assert.equal(all(tree, (node) => node.props?.['data-task-id'] === 'TASK-1' && node.props?.['data-testid'] === 'review-issue')[0].props.value, '');
  assert.equal(all(tree, (node) => node.props?.['data-task-id'] === 'TASK-2' && node.props?.['data-testid'] === 'review-issue')[0].props.value, 'second issue');
  await byId(tree, 'reject-review-TASK-2').props.onClick();
  assert.equal(fx.calls[1].body.taskId, 'TASK-2');
  assert.deepEqual(fx.calls[1].body.issues, ['second issue']);
});

test('O2 missing and FAILED evidence surface explicit Owner risk actions without PL approve bypass', async () => {
  const fx = fixture();
  const tasks = ['TASK-MISSING', 'TASK-FAILED'].map((id) => ({ id, title: id, status: 'SUBMITTED', resultId: `RESULT-${id}`, reviewPolicy: 'PL' }));
  const a = selected('A', { tasks,
    results: [{ id: 'RESULT-TASK-MISSING', outcome: 'SUCCESS', evidenceRefs: ['EV-MISSING'] },
      { id: 'RESULT-TASK-FAILED', outcome: 'SUCCESS', evidenceRefs: ['EV-COMMAND', 'EV-FAILED'] }],
    evidence: [{ id: 'EV-MISSING', resultId: 'RESULT-TASK-MISSING', kind: 'FILE', status: 'VERIFIED', ref: 'src/a.js' },
      { id: 'EV-COMMAND', resultId: 'RESULT-TASK-FAILED', kind: 'COMMAND', status: 'VERIFIED', ref: 'npm test' },
      { id: 'EV-FAILED', resultId: 'RESULT-TASK-FAILED', kind: 'FILE', status: 'FAILED', ref: 'src/b.js' }],
  });
  const tree = fx.render(fx.GovernancePanel, a);
  assert.ok(byId(tree, 'owner-accept-risk-TASK-MISSING'));
  assert.ok(byId(tree, 'owner-accept-risk-TASK-FAILED'));
  assert.equal(byId(tree, 'approve-review-TASK-MISSING'), undefined);
  assert.equal(byId(tree, 'approve-review-TASK-FAILED'), undefined);
  assert.equal(all(tree, (node) => node.type === 'details' && node.props?.['data-testid'] === 'governance-history')[0].props.open, undefined);
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    await byId(tree, 'owner-accept-risk-TASK-FAILED').props.onClick();
    assert.equal(fx.calls[0].body.actor.id, 'OWNER-A');
    assert.equal(fx.calls[0].body.acceptRisk, true);
    assert.equal(fx.calls[0].body.projectId, 'A');
    assert.equal(fx.calls[0].body.taskId, 'TASK-FAILED');
  } finally { globalThis.confirm = originalConfirm; }
});

test('O2 large Task list paginates; latest Run opens inside Task details, history stays collapsed', async () => {
  const fx = fixture();
  const tasks = Array.from({ length: 80 }, (_, i) => ({ id: `TASK-${i}`, title: `Task ${i}`, status: i < 40 ? 'READY' : 'VERIFIED',
    assignedAgentId: i === 0 ? 'WORKER-A' : null, dependencies: [], version: 1, charterVersion: 1, scope: { allowed: ['src/**'], forbidden: [] } }));
  const a = selected('A', { tasks, agents: [{ id: 'PL-A', role: 'PROJECT_LEAD', status: 'IDLE' },
    { id: 'WORKER-A', role: 'WORKER', displayName: 'Worker', status: 'IDLE', currentTaskId: null }],
  taskRuns: Array.from({ length: 120 }, (_, i) => ({ id: `RUN-${i}`, taskId: 'TASK-0', attempt: i + 1, status: i === 119 ? 'FAILED' : 'SUCCEEDED' })) });
  let tree = fx.render(fx.TaskBoard, a);
  assert.equal(all(tree, (node) => node.props?.['data-testid'] === 'task-record').length, 30);
  assert.equal(byId(tree, 'task-form').props.open, undefined);
  assert.equal(byId(tree, 'verification-command-form').props.open, undefined);
  assert.equal(byId(tree, 'start-run-TASK-0').props.disabled, true);
  byId(tree, 'start-run-TASK-0').props.onClick();
  assert.equal(fx.calls.length, 0);
  let task0 = all(tree, (node) => node.props?.['data-task-id'] === 'TASK-0' && node.props?.['data-testid'] === 'task-record')[0];
  assert.equal(byId(task0, 'task-run'), undefined);
  byId(task0, 'task-details').props.onToggle({ currentTarget: { open: true } });
  tree = fx.render(fx.TaskBoard, a);
  task0 = all(tree, (node) => node.props?.['data-task-id'] === 'TASK-0' && node.props?.['data-testid'] === 'task-record')[0];
  const runDetails = all(task0, (node) => node.props?.['data-testid'] === 'task-run');
  assert.equal(runDetails.length, 120);
  assert.equal(runDetails[0].props.open, true);
  assert.ok(runDetails.slice(1).every((node) => node.props.open === false));
  assert.ok(byId(task0, 'pl-diagnosis-RUN-119'));
  byId(tree, 'task-filter-verified').props.onClick();
  tree = fx.render(fx.TaskBoard, a);
  assert.equal(all(tree, (node) => node.props?.['data-testid'] === 'task-record').length, 30);
  assert.ok(byId(tree, 'task-pagination'));
  a.verificationCommands = [{ id: 'VCMD-1', displayName: 'npm test', command: 'npm test', status: 'APPROVED' }];
  byId(tree, 'task-filter-active').props.onClick();
  tree = fx.render(fx.TaskBoard, a);
  byId(tree, 'run-verification-commands-TASK-0').props.onChange({ target: { value: 'VCMD-1' } });
  tree = fx.render(fx.TaskBoard, a);
  assert.equal(byId(tree, 'start-run-TASK-0').props.disabled, false);
  await byId(tree, 'start-run-TASK-0').props.onClick();
  assert.deepEqual(fx.calls[0], { action: 'start-task-run', body: {
    actor: { type: 'pl', id: 'PL-A' }, projectId: 'A', taskId: 'TASK-0', expectedVersion: 1,
    verification_command_ids: ['VCMD-1'], writeIntent: true,
  } });
});
