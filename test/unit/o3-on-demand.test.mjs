import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';

import { seed } from '../../scripts/bench/optimization-baseline.mjs';
import { buildTaskRunContext } from '../../src/host/context-builder.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { ControlPlaneStore } from '../../src/host/store.js';
import { createPLBridgeTools } from '../../src/host/pl-bridge.js';

const projectId = 'PROJECT-BENCH';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'atcp-o3-test-'));
  const store = new ControlPlaneStore(join(root, 'fixture.sqlite'));
  seed(store, { name: 'L', tasks: 500, runs: 2000, activities: 20000 }, root);
  return { root, store, plane: new AgentTeamControlPlane(store, null) };
}

function cleanup({ root, store }) {
  store.close();
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('atcp-o3-test-'));
  rmSync(root, { recursive: true, force: true });
}

test('O3 500 Task / 2,000 Run overview is current-state only, PL summary never reads full history', async () => {
  const ctx = fixture();
  try {
    const { store, plane } = ctx;
    const full = store.snapshot(projectId);
    assert.equal(full.selected.tasks.length, 500);
    assert.equal(full.selected.taskRuns.length, 2000);
    assert.equal(full.selected.evidence.length, 2000);

    const sql = [];
    const prepare = store.db.prepare;
    store.db.prepare = function trackedPrepare(statement, ...args) {
      sql.push(statement);
      return prepare.call(this, statement, ...args);
    };
    let overview;
    try { overview = plane.getProjectOverview(projectId); } finally { store.db.prepare = prepare; }
    assert.equal(overview.view, 'overview');
    assert.equal(overview.selected.tasks.length, 500);
    assert.equal(overview.selected.taskRuns.length, 500);
    assert.equal('workspaceBaseline' in overview.selected.taskRuns[0], false);
    assert.equal('workspaceDiff' in overview.selected.taskRuns[0], false);
    assert.ok(overview.selected.evidence.length < full.selected.evidence.length);
    assert.deepEqual(overview.selected.tasks.map((item) => item.id), full.selected.tasks.map((item) => item.id));
    assert.deepEqual(overview.selected.tasks.map((item) => item.dependencies), full.selected.tasks.map((item) => item.dependencies));
    assert.deepEqual(overview.selected.taskRuns.map((item) => item.id),
      full.selected.taskRuns.filter((run) => run.attempt === 4).map((item) => item.id));
    assert.equal(sql.some((statement) => /\bFROM\s+task_run_events\b|\bFROM\s+verification_runs\b|\bFROM\s+task_state_events\b/i.test(statement)), false);
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, data: overview })) < Buffer.byteLength(JSON.stringify({ ok: true, data: full })) / 2);

    const tools = createPLBridgeTools({ controlPlane: {
      requireProject: (id) => plane.requireProject(id),
      getProjectOverview: (id) => plane.getProjectOverview(id),
      getTaskDetail: (input) => plane.getTaskDetail(input),
      snapshot: () => { throw new Error('default PL summary loaded full snapshot'); },
    }, store, adapters: { isLiveParent: () => true, bindProjectParent() {} } });
    const stateTool = tools.find((tool) => tool.name === 'agent_team_project_state');
    const summary = JSON.parse(await stateTool.execute({ project_id: projectId }, { agent: { id: 'SESSION-PL' } }));
    assert.equal(summary.tasks.length, 500);
    assert.equal(summary.tasks.at(-1).latestRun.id, 'RUN-1999');
  } finally { cleanup(ctx); }
});

test('O3 Task detail, history keyset, Activity pagination and SQL plans stay project-scoped', () => {
  const ctx = fixture();
  try {
    const { store, plane } = ctx;
    const db = store.db;
    db.prepare(`INSERT INTO projects(id,name,owner_id,lead_agent_id,lead_runtime_key,worker_runtime_key,workspace_dir,initial_goal,charter_version,max_agents,status,version,created_at,updated_at)
      VALUES('PROJECT-B','Foreign','human-b','AGENT-B','harness:fixture','subagent:fixture',?, 'Foreign',0,3,'ACTIVE',1,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')`).run(ctx.root);
    db.prepare(`INSERT INTO agents(id,project_id,display_name,provider_key,role,permissions_json,skills_json,status,created_at)
      VALUES('AGENT-B','PROJECT-B','Foreign Agent','subagent:fixture','WORKER','[]','[]','IDLE','2026-10-01T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO tasks(id,project_id,title,goal,scope_allowed_json,scope_forbidden_json,acceptance_json,control_level,review_policy,status,version,charter_version,created_at,updated_at)
      VALUES('TASK-B','PROJECT-B','Foreign','Foreign','[]','[]','[]','ROUTINE','AUTO','READY',1,0,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO task_runs(id,task_id,agent_id,provider_key,attempt,workspace_ref,write_intent,status,capability_snapshot_json,verification_commands_json,created_at)
      VALUES('RUN-B','TASK-B','AGENT-B','subagent:fixture',1,?,0,'SUCCEEDED','{}','[]','2026-10-01T00:00:00.000Z')`).run(ctx.root);

    assert.equal(plane.getProjectOverview('PROJECT-B').selected.tasks.length, 1);
    assert.equal(plane.getProjectOverview('PROJECT-B').selected.taskRuns[0].id, 'RUN-B');
    assert.equal(plane.getTaskDetail({ projectId, taskId: 'TASK-0' }).taskRuns.length, 4);
    assert.equal(plane.getTaskDetail({ projectId, taskId: 'TASK-0' }).evidence.length, 4);
    assert.equal(plane.getTaskDetail({ projectId, taskId: 'TASK-0' }).verificationRuns.length, 4);
    assert.equal(plane.getTaskDetail({ projectId, taskId: 'TASK-0' }).requests.length, 1);
    assert.equal(plane.getTaskDetail({ projectId, taskId: 'TASK-0' }).responses.length, 1);
    assert.throws(() => plane.getTaskDetail({ projectId, taskId: 'TASK-B' }), { code: 'TASK_NOT_FOUND', status: 404 });
    assert.throws(() => plane.getTaskDetail({ projectId: 'PROJECT-B', taskId: 'TASK-0' }), { code: 'TASK_NOT_FOUND', status: 404 });

    const runIds = [];
    let cursor = null;
    do {
      const page = plane.getProjectHistoryPage({ projectId, kind: 'task-runs', cursor, limit: 50 });
      runIds.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(runIds.length, 2000);
    assert.equal(new Set(runIds).size, 2000);
    assert.ok(!runIds.includes('RUN-B'));
    assert.deepEqual(plane.getProjectHistoryPage({ projectId: 'PROJECT-B', kind: 'task-runs' }).items.map((item) => item.id), ['RUN-B']);
    for (const [kind, count] of [['reviews', 500], ['evidence', 2000], ['requests', 100]]) {
      const ids = [];
      let historyCursor = null;
      do {
        const page = plane.getProjectHistoryPage({ projectId, kind, cursor: historyCursor, limit: 37 });
        ids.push(...page.items.map((item) => item.id));
        historyCursor = page.nextCursor;
      } while (historyCursor);
      assert.equal(ids.length, count, kind);
      assert.equal(new Set(ids).size, count, kind);
    }
    for (const kind of ['reviews', 'evidence', 'approvals', 'requests', 'findings', 'plan-checks']) {
      assert.equal(plane.getProjectHistoryPage({ projectId: 'PROJECT-B', kind }).items.length, 0);
    }

    const first = plane.activityPage({ projectId, limit: 50 });
    assert.equal(first.items.length, 50);
    assert.ok(first.facets);
    store.activityFacets = () => { throw new Error('facets repeated on load more'); };
    const second = plane.activityPage({ projectId, limit: 50, cursor: first.nextCursor, includeFacets: false });
    assert.equal(second.items.length, 50);
    assert.equal('facets' in second, false);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 100);
    assert.ok(second.items.every((item) => item.projectId === projectId));

    const runPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT r.* FROM tasks t JOIN task_runs r ON r.id=(
      SELECT x.id FROM task_runs x WHERE x.task_id=t.id ORDER BY x.attempt DESC LIMIT 1)
      WHERE t.project_id=? ORDER BY t.created_at,t.id`).all(projectId).map((row) => row.detail).join('\n');
    assert.match(runPlan, /task_runs_task/);
    const dependenciesPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT d.task_id,d.dependency_task_id FROM task_dependencies d
      JOIN tasks t ON t.id=d.task_id WHERE t.project_id=? ORDER BY d.task_id,d.dependency_task_id`).all(projectId).map((row) => row.detail).join('\n');
    assert.match(dependenciesPlan, /tasks_project_status|task_dependencies/);
  } finally { cleanup(ctx); }
});

test('O3 listTasks uses two SQL queries and Run context reads only Task plus dependencies', () => {
  const ctx = fixture();
  try {
    const { store } = ctx;
    const prepare = store.db.prepare;
    let calls = 0;
    store.db.prepare = function countedPrepare(...args) { calls += 1; return prepare.apply(this, args); };
    try { assert.equal(store.listTasks(projectId).length, 500); } finally { store.db.prepare = prepare; }
    assert.equal(calls, 2);

    const task = store.getTask('TASK-1');
    const project = store.getProject(projectId);
    const agent = store.listAgents(projectId).find((item) => item.id === 'AGENT-WORKER');
    for (const method of ['listResults', 'listRequests', 'listReviews', 'listDecisions']) {
      store[method] = () => { throw new Error(`${method} scanned full history`); };
    }
    const { authoritative } = buildTaskRunContext(store, { project, task, agent, verificationCommands: [] });
    assert.equal(authoritative.dependencyResults.length, 1);
    assert.equal(authoritative.dependencyResults[0].taskId, 'TASK-0');
    assert.equal(authoritative.dependencyResults[0].result.id, 'RESULT-1500');
    assert.equal(authoritative.latestRequestResponse, null);
    assert.equal(authoritative.reviewHistory.length <= 5, true);
  } finally { cleanup(ctx); }
});

test('O3 overview JSON stays bounded when Run history grows without adding Tasks', () => {
  const root = mkdtempSync(join(tmpdir(), 'atcp-o3-test-'));
  const store = new ControlPlaneStore(join(root, 'fixture.sqlite'));
  try {
    seed(store, { name: 'S', tasks: 10, runs: 20, activities: 200 }, root);
    const before = store.getProjectOverview(projectId);
    const beforeBytes = Buffer.byteLength(JSON.stringify(before));
    const fullBeforeBytes = Buffer.byteLength(JSON.stringify(store.snapshot(projectId)));
    store.transaction(() => {
      const insert = store.db.prepare(`INSERT INTO task_runs(id,task_id,agent_id,provider_key,attempt,workspace_ref,write_intent,status,capability_snapshot_json,verification_commands_json,created_at)
        VALUES(?,?,?,?,?,?,1,'SUCCEEDED','{}','[]',?)`);
      for (let i = 0; i < 500; i += 1) {
        insert.run(`RUN-HISTORY-${i}`, `TASK-${i % 10}`, 'AGENT-WORKER', 'subagent:fixture', 3 + Math.floor(i / 10), root,
          new Date(Date.UTC(2026, 9, 2) + i * 1000).toISOString());
      }
    });
    const after = store.getProjectOverview(projectId);
    const afterBytes = Buffer.byteLength(JSON.stringify(after));
    const fullAfterBytes = Buffer.byteLength(JSON.stringify(store.snapshot(projectId)));
    assert.equal(after.selected.tasks.length, 10);
    assert.equal(after.selected.taskRuns.length, 10);
    assert.ok(afterBytes < beforeBytes * 1.1, `${beforeBytes} -> ${afterBytes}`);
    assert.ok(fullAfterBytes > fullBeforeBytes * 2, `${fullBeforeBytes} -> ${fullAfterBytes}`);
  } finally { cleanup({ root, store }); }
});

test('O3 overview mutation response carries the fresh optimistic version for the next action', () => {
  const root = mkdtempSync(join(tmpdir(), 'atcp-o3-test-'));
  const store = new ControlPlaneStore(join(root, 'fixture.sqlite'));
  try {
    seed(store, { name: 'S', tasks: 10, runs: 20, activities: 200 }, root);
    const plane = new AgentTeamControlPlane(store, null);
    const create = (version, name, responseView) => plane.createTask({
      actor: { type: 'human', id: 'human-fixture' }, operationId: `o3-create-${name}`,
      projectId, expectedProjectVersion: version, responseView,
      title: name, goal: name, scope: { allowed: ['src/**'], forbidden: [] },
      acceptance: ['test'], dependencies: [], controlLevel: 'ROUTINE', reviewPolicy: 'AUTO',
    });
    const first = create(1, 'first', 'overview');
    assert.equal(first.view, 'overview');
    assert.equal(first.selected.project.version, 2);
    assert.equal(first.selected.tasks.length, 11);
    assert.equal(create(first.selected.project.version, 'second', 'overview').selected.project.version, 3);
    assert.throws(() => create(1, 'stale', 'overview'), { code: 'VERSION_CONFLICT' });
    const legacy = create(3, 'legacy');
    assert.equal(legacy.view, undefined);
    assert.equal(legacy.selected.project.version, 4);
    assert.equal(legacy.selected.tasks.length, 13);
  } finally { cleanup({ root, store }); }
});
