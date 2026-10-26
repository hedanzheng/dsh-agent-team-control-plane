import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve('client.js'), 'utf8');

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function equalDependencies(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
}

function panelHarness(fetchImpl) {
  const hooksByPath = new Map();
  let currentHooks = null;
  let hookIndex = 0;
  let dirty = true;
  let tree;
  let root;
  const pendingEffects = [];
  const sessionCalls = [];
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...(props || {}), children } }; },
    useState(initial) {
      const index = hookIndex++;
      if (!currentHooks[index]) currentHooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      const cell = currentHooks[index];
      return [cell.value, (next) => {
        const value = typeof next === 'function' ? next(cell.value) : next;
        if (!Object.is(value, cell.value)) { cell.value = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!currentHooks[index]) currentHooks[index] = { value: { current: initial } };
      return currentHooks[index].value;
    },
    useCallback(callback, dependencies) {
      const index = hookIndex++;
      if (!currentHooks[index] || !equalDependencies(currentHooks[index].dependencies, dependencies)) {
        currentHooks[index] = { value: callback, dependencies };
      }
      return currentHooks[index].value;
    },
    useEffect(effect, dependencies) {
      const index = hookIndex++;
      const previous = currentHooks[index];
      if (!previous || !equalDependencies(previous.dependencies, dependencies)) {
        const cell = { dependencies, cleanup: previous?.cleanup };
        currentHooks[index] = cell;
        pendingEffects.push(() => { cell.cleanup?.(); cell.cleanup = effect(); });
      }
    },
  };
  let definition;
  const window = { __ModuleLoader__: { load(value) { definition = value; } } };
  new Function('window', source)(window);
  const plugin = definition.factory((name) => { assert.equal(name, 'react'); return React; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const ctx = {
    slots: {
      inject(_slot, install) { install(); },
      register(meta, renderer) { if (meta.name === 'main') root = renderer(); return () => {}; },
    },
    layout: { selectPanel() {} },
    uiWorkspace: {
      openSession(sessionId) { sessionCalls.push(['openSession', sessionId]); },
      openWorkspace(workspaceId) { sessionCalls.push(['openWorkspace', workspaceId]); },
    },
    sessions: { list: { getSnapshot: () => ({ current: 'SESSION-EXISTING', ids: [], byId: {} }) }, binding: () => ({ ctx: {} }) },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'WORKSPACE-1', path: 'D:/fixture', createdAt: '2026-10-26T00:00:00Z', sessionIds: ['SESSION-EXISTING'] }] }) } },
    conversation: { input: { requestDraftInitialization() { sessionCalls.push(['draft']); }, for() { return { submit() { sessionCalls.push(['submit']); } }; } } },
  };
  plugin.apply(ctx);

  function renderNode(node, path = 'root') {
    if (node == null || typeof node === 'boolean') return null;
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}.${index}`)).filter((item) => item != null);
    if (typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const key = `${path}:${node.type.name}`;
      const prior = currentHooks;
      const priorIndex = hookIndex;
      currentHooks = hooksByPath.get(key) || [];
      hooksByPath.set(key, currentHooks);
      hookIndex = 0;
      const rendered = node.type(node.props);
      currentHooks = prior;
      hookIndex = priorIndex;
      return renderNode(rendered, `${path}.render`);
    }
    const children = renderNode(node.props.children, `${path}.children`);
    return { type: node.type, props: { ...node.props, children } };
  }

  async function settle() {
    for (let round = 0; round < 12; round += 1) {
      dirty = false;
      tree = renderNode(root);
      for (const effect of pendingEffects.splice(0)) effect();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      if (!dirty && pendingEffects.length === 0) return;
    }
    throw new Error('panel fixture did not settle');
  }

  function visit(node, predicate) {
    if (node == null || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) { const found = visit(child, predicate); if (found) return found; }
      return null;
    }
    if (predicate(node)) return node;
    return visit(node.props?.children, predicate);
  }

  function byTestId(id) { return visit(tree, (node) => node.props?.['data-testid'] === id); }
  function textOf(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(textOf).join(' ');
    if (typeof node === 'object') return textOf(node.props?.children);
    return String(node);
  }
  return { settle, byTestId, textOf, sessionCalls, close() {
    for (const cells of hooksByPath.values()) for (const cell of cells) cell?.cleanup?.();
    globalThis.fetch = originalFetch;
  } };
}

function project(id, status) {
  return { id, name: `Project ${id}`, status, ownerId: 'human-owner', leadAgentId: `PL-${id}`,
    leadRuntimeKey: 'harness:deepseek-official', workerRuntimeKey: 'subagent:fork',
    workspaceDir: 'D:/fixture', initialGoal: `Mission ${id}`, charterVersion: 1, version: id === 'B' ? 7 : 3,
    maxAgents: 3, plSessionId: `SESSION-${id}` };
}

function selectedState(projectRecord, overrides = {}) {
  return {
    project: projectRecord, interview: null,
    charters: [{ id: `CHARTER-${projectRecord.id}`, version: 1, mission: `Approved Mission ${projectRecord.id}`,
      scope: { allowed: ['src/**'], forbidden: [] }, constraints: [], successCriteria: [], plAssumptions: [] }],
    agents: [], approvals: [], activities: [], tasks: [], taskProposals: [], taskStateEvents: [], taskRuns: [],
    taskRunEvents: [], results: [], evidence: [], verificationRuns: [], requests: [], responses: [], requestRuns: [],
    reviews: [], reviewRuns: [], findings: [], planChecks: [], decisions: [], verificationCommands: [], ...overrides,
  };
}

function snapshot(selected) {
  return { schemaVersion: 9, projects: [project('A', 'ACTIVE'), project('B', 'CHARTER_PENDING_APPROVAL')],
    runtimes: [{ providerKey: 'harness:deepseek-official', displayName: 'DeepSeek', kind: 'harness-agent', authorized: true },
      { providerKey: 'subagent:fork', displayName: 'fork Worker', kind: 'external-worker', authorized: true }],
    selected };
}

function response(data, ok = true) { return { ok, status: ok ? 200 : 500, async json() { return data; } }; }

test('O1 cross-project approval fetches B before navigation, commits B identity, and never starts a PL session', async () => {
  const a = snapshot(selectedState(project('A', 'ACTIVE')));
  const b = snapshot(selectedState(project('B', 'CHARTER_PENDING_APPROVAL')));
  const pendingB = deferred();
  const calls = [];
  const harness = panelHarness(async (url, options = {}) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      calls.push(['POST', body]);
      return response({ ok: true, data: b });
    }
    const id = new URL(url, 'http://localhost').searchParams.get('projectId');
    calls.push(['GET', id]);
    return id === 'B' ? pendingB.promise : response({ ok: true, data: a });
  });
  try {
    await harness.settle();
    assert.ok(harness.byTestId('dashboard-approve-B'));
    const click = harness.byTestId('dashboard-approve-B').props.onClick();
    await harness.settle();
    assert.ok(harness.byTestId('project-switching'));
    assert.equal(harness.byTestId('charter-approval'), null);
    assert.ok(calls.some(([method, id]) => method === 'GET' && id === 'B'));
    pendingB.resolve(response({ ok: true, data: b }));
    assert.equal(await click, true);
    await harness.settle();
    assert.ok(harness.byTestId('charter-approval'));
    assert.equal(harness.byTestId('project-selector'), null); // Selector stays in the Project tab.
    await harness.byTestId('approve-charter').props.onClick();
    await harness.settle();
    const approval = calls.find(([method, body]) => method === 'POST' && body.action === 'approve-charter')?.[1];
    assert.equal(approval.projectId, 'B');
    assert.equal(approval.expectedVersion, 7);
    assert.deepEqual(harness.sessionCalls, []);
  } finally { harness.close(); }
});

test('O1 failed cross-project switch keeps A selected and never exposes B approval actions', async () => {
  const a = snapshot(selectedState(project('A', 'ACTIVE')));
  const harness = panelHarness(async (url) => {
    const id = new URL(url, 'http://localhost').searchParams.get('projectId');
    return id === 'B' ? response({ ok: false, error: { message: 'temporary Host error' } }, false) : response({ ok: true, data: a });
  });
  try {
    await harness.settle();
    const result = await harness.byTestId('dashboard-approve-B').props.onClick();
    assert.equal(result, false);
    await harness.settle();
    assert.match(harness.textOf(harness.byTestId('dashboard-current-project')), /Project A/);
    assert.equal(harness.byTestId('charter-approval'), null);
    assert.match(harness.textOf(harness.byTestId('error')), /切换 Project 失败/);
    assert.deepEqual(harness.sessionCalls, []);
  } finally { harness.close(); }
});

test('O1 rejects a successful HTTP response that contains the wrong Project', async () => {
  const a = snapshot(selectedState(project('A', 'ACTIVE')));
  const harness = panelHarness(async () => response({ ok: true, data: a }));
  try {
    await harness.settle();
    const result = await harness.byTestId('dashboard-approve-B').props.onClick();
    assert.equal(result, false);
    await harness.settle();
    assert.match(harness.textOf(harness.byTestId('error')), /Host 未返回 Project B 的状态/);
    assert.match(harness.textOf(harness.byTestId('dashboard-current-project')), /Project A/);
  } finally { harness.close(); }
});

test('O1 a late Project A poll cannot overwrite Project B after cross-project navigation', async () => {
  const a = snapshot(selectedState(project('A', 'ACTIVE'), {
    taskRuns: [{ id: 'RUN-POLL', taskId: 'TASK-POLL', agentId: 'WORKER-A', status: 'RUNNING' }],
  }));
  const b = snapshot(selectedState(project('B', 'CHARTER_PENDING_APPROVAL')));
  const lateA = deferred();
  let aRequests = 0;
  let timerCallback;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback) => { timerCallback = callback; return 1; };
  globalThis.clearInterval = () => {};
  const harness = panelHarness(async (url) => {
    const id = new URL(url, 'http://localhost').searchParams.get('projectId');
    if (id === 'B') return response({ ok: true, data: b });
    aRequests += 1;
    return aRequests > 1 ? lateA.promise : response({ ok: true, data: a });
  });
  try {
    await harness.settle();
    assert.equal(typeof timerCallback, 'function');
    timerCallback();
    await harness.settle();
    assert.ok(aRequests > 1);
    const switched = await harness.byTestId('dashboard-approve-B').props.onClick();
    assert.equal(switched, true);
    await harness.settle();
    lateA.resolve(response({ ok: true, data: a }));
    await harness.settle();
    assert.ok(harness.byTestId('charter-approval'));
    assert.match(harness.textOf(harness.byTestId('control-plane')), /Project B/);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    harness.close();
  }
});

test('O1 overview separates real Human work, PL/Reviewer queue, blockers and Host-reported Agent task states', async () => {
  const aProject = project('A', 'ACTIVE');
  const tasks = [
    { id: 'TASK-RUN', title: 'Build feature', status: 'RUNNING', assignedAgentId: 'WORKER-RUN' },
    { id: 'TASK-WAIT', title: 'Resolve dependency', status: 'WAITING', assignedAgentId: 'WORKER-WAIT', waiting: { reason: '等待 PL 回答' } },
    { id: 'TASK-DONE', title: 'Finished', status: 'VERIFIED' },
    { id: 'TASK-CANCEL', title: 'Old task', status: 'CANCELLED' },
    { id: 'TASK-PL', title: 'Review implementation', status: 'SUBMITTED', resultId: 'RESULT-PL', reviewPolicy: 'PL' },
    { id: 'TASK-REVIEWER', title: 'Critical review', status: 'SUBMITTED', resultId: 'RESULT-REVIEWER', reviewPolicy: 'REVIEWER_PL' },
    { id: 'TASK-RISK', title: 'Partial result', status: 'SUBMITTED', resultId: 'RESULT-RISK', reviewPolicy: 'PL' },
    { id: 'TASK-FAIL', title: 'Failed execution', status: 'FAILED' },
  ];
  const agents = [
    { id: 'PL-A', displayName: 'Project Lead', role: 'PROJECT_LEAD', providerKey: 'harness:deepseek-official', status: 'IDLE', currentTaskId: null },
    { id: 'WORKER-RUN', displayName: 'Running Worker', role: 'WORKER', providerKey: 'subagent:fork', status: 'RUNNING', currentTaskId: 'TASK-RUN' },
    { id: 'WORKER-WAIT', displayName: 'Waiting Worker', role: 'WORKER', providerKey: 'subagent:fork', status: 'IDLE', currentTaskId: 'TASK-WAIT' },
    { id: 'WORKER-IDLE', displayName: 'Idle Worker', role: 'WORKER', providerKey: 'subagent:fork', status: 'IDLE', currentTaskId: null },
    { id: 'WORKER-UNKNOWN', displayName: 'Unknown Worker', role: 'WORKER', providerKey: 'subagent:fork', status: 'RUNNING', currentTaskId: null },
    { id: 'REVIEWER-A', displayName: 'Independent Reviewer', role: 'REVIEWER', providerKey: 'harness:deepseek-official', status: 'IDLE', currentTaskId: null },
    { id: 'WORKER-OLD', displayName: 'Replaced Worker', role: 'WORKER', providerKey: 'subagent:fork', status: 'REPLACED', currentTaskId: null },
  ];
  const a = snapshot(selectedState(aProject, {
    tasks, agents,
    taskRuns: [{ id: 'RUN-A', taskId: 'TASK-RUN', agentId: 'WORKER-RUN', status: 'RUNNING' },
      { id: 'RUN-FAIL', taskId: 'TASK-FAIL', agentId: 'WORKER-IDLE', status: 'FAILED', error: { code: 'RUNTIME_ERROR' } }],
    results: [{ id: 'RESULT-PL', outcome: 'SUCCESS' }, { id: 'RESULT-REVIEWER', outcome: 'SUCCESS' },
      { id: 'RESULT-RISK', outcome: 'PARTIAL' }],
    requests: [{ id: 'REQUEST-PL', status: 'PENDING', toAgentId: 'PL-A' },
      { id: 'REQUEST-WORKER', status: 'PENDING', toAgentId: 'WORKER-IDLE' }],
    planChecks: [{ id: 'PLAN-1', status: 'PENDING' }],
    findings: [{ id: 'FINDING-1', status: 'OPEN' }],
  }));
  const harness = panelHarness(async () => response({ ok: true, data: a }));
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  try {
    await harness.settle();
    assert.match(harness.textOf(harness.byTestId('dashboard-task-progress')), /已验收 Task 1 \/ 有效 Task 7/);
    assert.match(harness.textOf(harness.byTestId('dashboard-human-queue')), /Human 待审批 · 2/); // B approval + PARTIAL risk.
    assert.match(harness.textOf(harness.byTestId('dashboard-agent-queue')), /PL \/ Reviewer 工作队列 · 4/);
    assert.match(harness.textOf(harness.byTestId('dashboard-blockers')), /阻塞 \/ 异常提醒 · 4/);
    assert.match(harness.textOf(harness.byTestId('dashboard-agent-WORKER-RUN')), /Build feature · 执行中/);
    assert.match(harness.textOf(harness.byTestId('dashboard-agent-WORKER-WAIT')), /Resolve dependency · 等待处理 · 等待原因：等待 PL 回答/);
    assert.match(harness.textOf(harness.byTestId('dashboard-agent-WORKER-IDLE')), /当前未占用 Task/);
    assert.match(harness.textOf(harness.byTestId('dashboard-agent-WORKER-UNKNOWN')), /当前任务未知/);
    assert.match(harness.textOf(harness.byTestId('dashboard-agent-PL-A')), /待 PL 审核（不代表模型正在运行）/);
    assert.match(harness.textOf(harness.byTestId('dashboard-agent-REVIEWER-A')), /待独立审核（不代表模型正在运行）/);
    assert.equal(harness.byTestId('dashboard-agent-WORKER-OLD'), null);
    assert.doesNotMatch(harness.textOf(harness.byTestId('view-dashboard')), /Codex 正在执行/);
    assert.match(harness.textOf(harness.byTestId('dashboard-agent-WORKER-RUN')), /实际模型：未报告/);
    assert.deepEqual(harness.sessionCalls, []);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    harness.close();
  }
});

test('O1 stopped Project history is not labeled as a live approval or blocker', async () => {
  const stopped = project('A', 'STOPPED');
  const a = snapshot(selectedState(stopped, {
    tasks: [{ id: 'TASK-HISTORY', title: 'Historical partial Task', status: 'SUBMITTED', resultId: 'RESULT-HISTORY', reviewPolicy: 'PL' },
      { id: 'TASK-OLD-WAIT', title: 'Historical wait', status: 'WAITING', waiting: { reason: 'old request' } }],
    results: [{ id: 'RESULT-HISTORY', outcome: 'PARTIAL' }],
    findings: [{ id: 'FINDING-HISTORY', status: 'OPEN' }],
  }));
  a.projects[0] = stopped;
  const harness = panelHarness(async () => response({ ok: true, data: a }));
  try {
    await harness.settle();
    assert.match(harness.textOf(harness.byTestId('dashboard-human-queue')), /Human 待审批 · 1/); // Only B charter approval.
    assert.match(harness.textOf(harness.byTestId('dashboard-agent-queue')), /PL \/ Reviewer 工作队列 · 0/);
    assert.match(harness.textOf(harness.byTestId('dashboard-blockers')), /阻塞 \/ 异常提醒 · 0/);
  } finally { harness.close(); }
});

test('O5 idle Panel makes one initial overview request and refreshes only on user action', async () => {
  const a = snapshot(selectedState(project('A', 'ACTIVE')));
  let gets = 0;
  let timers = 0;
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => { timers += 1; return timers; };
  const harness = panelHarness(async () => { gets += 1; return response({ ok: true, data: a }); });
  try {
    await harness.settle();
    assert.equal(gets, 1);
    assert.equal(timers, 0);
    await harness.byTestId('refresh-control-plane').props.onClick();
    await harness.settle();
    assert.equal(gets, 2);
    assert.equal(timers, 0);
  } finally { harness.close(); globalThis.setInterval = originalSetInterval; }
});

test('O5 Review-only and Request-only work each refreshes without a Worker Run', async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let nextTimer = 0;
  const timers = new Map();
  globalThis.setInterval = (fn, ms) => { assert.equal(ms, 3000); const id = ++nextTimer; timers.set(id, fn); return id; };
  globalThis.clearInterval = (id) => timers.delete(id);
  try {
    for (const active of [
      { reviewRuns: [{ id: 'REVIEW-RUN-1', status: 'RUNNING', taskId: 'TASK-1' }] },
      { requests: [{ id: 'REQUEST-1', status: 'PENDING', toAgentId: 'PL-A' }] },
    ]) {
      const a = snapshot(selectedState(project('A', 'ACTIVE'), active));
      let gets = 0;
      const harness = panelHarness(async () => { gets += 1; return response({ ok: true, data: a }); });
      try {
        await harness.settle();
        assert.equal(gets, 1);
        assert.equal(timers.size, 1);
        [...timers.values()][0]();
        await harness.settle();
        assert.equal(gets, 2);
      } finally { harness.close(); }
      assert.equal(timers.size, 0);
    }
  } finally { globalThis.setInterval = originalSetInterval; globalThis.clearInterval = originalClearInterval; }
});

test('O5 hidden Panel pauses polling and refreshes once when visible again', async () => {
  const originalDocument = globalThis.document;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  globalThis.setInterval = (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; };
  globalThis.clearInterval = (id) => timers.delete(id);
  const a = snapshot(selectedState(project('A', 'ACTIVE'), { taskRuns: [{ id: 'RUN-1', status: 'RUNNING' }] }));
  let gets = 0;
  const harness = panelHarness(async () => { gets += 1; return response({ ok: true, data: a }); });
  try {
    await harness.settle();
    assert.equal(timers.size, 1);
    globalThis.document.visibilityState = 'hidden';
    listeners.get('visibilitychange')();
    await harness.settle();
    assert.equal(timers.size, 0);
    assert.equal(gets, 1);
    globalThis.document.visibilityState = 'visible';
    listeners.get('visibilitychange')();
    await harness.settle();
    assert.equal(gets, 2);
    assert.equal(timers.size, 1);
  } finally {
    harness.close();
    assert.equal(listeners.size, 0);
    globalThis.document = originalDocument;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('O5 Activity keeps only the last filter response and skips facets on paging and automatic refresh', async () => {
  let overview = snapshot(selectedState(project('A', 'ACTIVE'), { activities: [{ id: 'ACT-0' }] }));
  const slowA = deferred();
  const activityCalls = [];
  const page = (items, hasMore = false) => response({ ok: true, data: {
    projectId: 'A', items, hasMore, nextCursor: hasMore ? { createdAt: '2026-10-26T00:00:00.000Z', id: 'ACT-B-1' } : null,
    facets: { actors: [{ value: 'AGENT-A', count: 1 }, { value: 'AGENT-B', count: 2 }], eventTypes: [] },
  } });
  const harness = panelHarness(async (url) => {
    const query = new URL(url, 'http://localhost').searchParams;
    if (query.get('view') !== 'activity') return response({ ok: true, data: overview });
    activityCalls.push(query.toString());
    if (query.get('actorId') === 'AGENT-A') return slowA.promise;
    if (query.get('actorId') === 'AGENT-B' && query.has('cursorId')) return page([{ id: 'ACT-B-2', summary: 'latest B page' }]);
    if (query.get('actorId') === 'AGENT-B') return page([{ id: 'ACT-B-1', summary: 'selected B event' }], true);
    return page([{ id: 'ACT-INIT', summary: 'initial event' }]);
  });
  try {
    await harness.settle();
    harness.byTestId('tab-activity').props.onClick();
    await harness.settle();
    const actorFilter = () => harness.byTestId('activity-filters').props.children[0];
    actorFilter().props.onChange({ target: { value: 'AGENT-A' } });
    await harness.settle();
    actorFilter().props.onChange({ target: { value: 'AGENT-B' } });
    await harness.settle();
    slowA.resolve(page([{ id: 'ACT-A', summary: 'stale A event' }]));
    await harness.settle();
    assert.match(harness.textOf(harness.byTestId('activity-feed')), /selected B event/);
    assert.doesNotMatch(harness.textOf(harness.byTestId('activity-feed')), /stale A event/);
    harness.byTestId('load-more-activities').props.onClick();
    await harness.settle();
    assert.match(harness.textOf(harness.byTestId('activity-feed')), /latest B page/);
    assert.match(activityCalls.at(-1), /includeFacets=false/);

    overview = snapshot(selectedState(project('A', 'ACTIVE'), { activities: [{ id: 'ACT-1' }] }));
    await harness.byTestId('refresh-control-plane').props.onClick();
    await harness.settle();
    assert.match(activityCalls.at(-1), /includeFacets=false/);
  } finally { harness.close(); }
});

test('O5 a late Activity page from Project A cannot enter Project B', async () => {
  const a = snapshot(selectedState(project('A', 'ACTIVE'), { activities: [{ id: 'ACT-A-0' }] }));
  const b = snapshot(selectedState(project('B', 'ACTIVE'), { activities: [{ id: 'ACT-B-0' }] }));
  b.projects[1] = project('B', 'ACTIVE');
  const lateA = deferred();
  const harness = panelHarness(async (url) => {
    const query = new URL(url, 'http://localhost').searchParams;
    if (query.get('view') === 'activity') {
      if (query.get('projectId') === 'A') return lateA.promise;
      return response({ ok: true, data: { projectId: 'B', items: [{ id: 'ACT-B', summary: 'B only event' }], nextCursor: null, hasMore: false, facets: { actors: [], eventTypes: [] } } });
    }
    return response({ ok: true, data: query.get('projectId') === 'B' ? b : a });
  });
  try {
    await harness.settle();
    harness.byTestId('tab-activity').props.onClick();
    await harness.settle();
    harness.byTestId('tab-project').props.onClick();
    await harness.settle();
    await harness.byTestId('project-selector').props.onChange({ target: { value: 'B' } });
    await harness.settle();
    harness.byTestId('tab-activity').props.onClick();
    await harness.settle();
    lateA.resolve(response({ ok: true, data: { projectId: 'A', items: [{ id: 'ACT-A', summary: 'stale A event' }], nextCursor: null, hasMore: false, facets: { actors: [], eventTypes: [] } } }));
    await harness.settle();
    assert.match(harness.textOf(harness.byTestId('activity-feed')), /B only event/);
    assert.doesNotMatch(harness.textOf(harness.byTestId('activity-feed')), /stale A event/);
  } finally { harness.close(); }
});
