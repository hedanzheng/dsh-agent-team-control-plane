// O0 only: isolated synthetic SQLite/workspace fixtures. No production data.
// Run: node --expose-gc scripts/bench/optimization-baseline.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { ControlPlaneStore } from '../../src/host/store.js';
import { createPLBridgeTools } from '../../src/host/pl-bridge.js';
import { snapshotWorkspace } from '../../src/host/workspace-diff.js';

const SCALES = [
  { name: 'S', tasks: 10, runs: 20, activities: 200 },
  { name: 'M', tasks: 100, runs: 300, activities: 5000 },
  { name: 'L', tasks: 500, runs: 2000, activities: 20000 },
];
const WORKSPACES = [100, 1000, 10000];
const projectId = 'PROJECT-BENCH';
const timestamp = (index) => new Date(Date.UTC(2026, 9, 1) + index * 1000).toISOString();
const numbers = (items) => {
  const sorted = [...items].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function insert(db, table, columns, values) {
  const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
  return db.prepare(sql).run(...values);
}

export function seed(store, scale, root) {
  const db = store.db;
  const counts = { ...scale, results: 0, evidence: 0, verificationRuns: 0, reviews: 0, requests: 0, responses: 0, dependencies: 0 };
  store.transaction(() => {
    for (const [key, kind] of [['harness:fixture', 'harness-agent'], ['subagent:fixture', 'external-worker']]) {
      insert(db, 'runtime_sources', ['provider_key', 'kind', 'display_name', 'availability', 'authorized', 'capabilities_json', 'source', 'last_scanned_at'],
        [key, kind, key, 'AVAILABLE', 1, '{}', 'synthetic-O0', timestamp(0)]);
    }
    insert(db, 'projects', ['id', 'name', 'owner_id', 'lead_agent_id', 'lead_runtime_key', 'worker_runtime_key', 'workspace_dir', 'initial_goal', 'charter_version', 'max_agents', 'status', 'version', 'pl_session_id', 'created_at', 'updated_at'],
      [projectId, `Synthetic ${scale.name}`, 'human-fixture', 'AGENT-PL', 'harness:fixture', 'subagent:fixture', root,
        'Synthetic measurement only', 1, 3, 'ACTIVE', 1, 'SESSION-PL', timestamp(0), timestamp(0)]);
    for (const [id, role, key] of [['AGENT-PL', 'PROJECT_LEAD', 'harness:fixture'], ['AGENT-WORKER', 'WORKER', 'subagent:fixture'], ['AGENT-REVIEWER', 'REVIEWER', 'harness:fixture']]) {
      insert(db, 'agents', ['id', 'project_id', 'display_name', 'provider_key', 'role', 'permissions_json', 'skills_json', 'status', 'created_at'],
        [id, projectId, id, key, role, '[]', '[]', 'IDLE', timestamp(0)]);
    }
    insert(db, 'charters', ['id', 'project_id', 'version', 'status', 'mission', 'scope_allowed_json', 'scope_forbidden_json', 'constraints_json', 'success_criteria_json', 'user_confirmed_json', 'pl_assumptions_json', 'created_at', 'approved_at'],
      ['CHARTER-1', projectId, 1, 'APPROVED', 'Synthetic benchmark', '["src/**"]', '[]', '[]', '["tests pass"]', '{}', '[]', timestamp(0), timestamp(1)]);
    for (let i = 0; i < scale.tasks; i += 1) {
      const taskId = `TASK-${i}`;
      const taskStatus = i % 7 === 0 ? 'WAITING' : i % 3 === 0 ? 'SUBMITTED' : 'VERIFIED';
      insert(db, 'tasks', ['id', 'project_id', 'title', 'goal', 'scope_allowed_json', 'scope_forbidden_json', 'acceptance_json', 'control_level', 'review_policy', 'assigned_agent_id', 'status', 'version', 'charter_version', 'result_id', 'waiting_reason', 'waiting_on_ref', 'created_at', 'updated_at'],
        [taskId, projectId, `Task ${i}`, `Goal ${i}`, '["src/**"]', '[]', '["tests pass"]', 'IMPORTANT', 'PL', 'AGENT-WORKER', taskStatus, 2, 1,
          `RESULT-${i}`, taskStatus === 'WAITING' ? 'Awaiting response' : null, null, timestamp(i), timestamp(i + 1)]);
      insert(db, 'task_state_events', ['id', 'task_id', 'from_status', 'to_status', 'actor_id', 'evidence_refs_json', 'created_at'],
        [`TASK-EVENT-${i}`, taskId, 'READY', taskStatus, 'AGENT-PL', '[]', timestamp(i + 1)]);
      if (i > 0) {
        insert(db, 'task_dependencies', ['task_id', 'dependency_task_id'], [taskId, `TASK-${i - 1}`]);
        counts.dependencies += 1;
      }
    }
    for (let i = 0; i < scale.runs; i += 1) {
      const taskIndex = i % scale.tasks;
      const taskId = `TASK-${taskIndex}`;
      const runId = `RUN-${i}`;
      const resultId = `RESULT-${i}`;
      insert(db, 'task_runs', ['id', 'task_id', 'agent_id', 'provider_key', 'attempt', 'workspace_ref', 'write_intent', 'status', 'capability_snapshot_json', 'verification_commands_json', 'workspace_baseline_json', 'workspace_diff_json', 'created_at', 'started_at', 'ended_at'],
        [runId, taskId, 'AGENT-WORKER', 'subagent:fixture', Math.floor(i / scale.tasks) + 1, root, 1, 'SUCCEEDED', '{}', '["VCMD-1"]',
          '{"src/file.js":{"size":10,"mtimeMs":1,"sha256":"fixture"}}', '{"added":[],"modified":[],"deleted":[]}', timestamp(i), timestamp(i), timestamp(i + 1)]);
      insert(db, 'task_run_events', ['id', 'run_id', 'from_status', 'to_status', 'details_json', 'created_at'],
        [`RUN-EVENT-${i}`, runId, 'RUNNING', 'SUCCEEDED', '{}', timestamp(i + 1)]);
      insert(db, 'results', ['id', 'task_id', 'run_id', 'outcome', 'change_summary', 'artifacts_json', 'verified_actions_json', 'test_plan', 'risks_json', 'unresolved_json', 'findings_json', 'evidence_refs_json', 'raw_output_excerpt', 'created_at'],
        [resultId, taskId, runId, i % 20 === 0 ? 'PARTIAL' : 'SUCCESS', `Change summary ${i}`, '["src/file.js"]', '[]', 'npm test', '[]', '[]', '[]',
          `["EVIDENCE-${i}"]`, 'synthetic output', timestamp(i + 1)]);
      counts.results += 1;
      insert(db, 'evidence', ['id', 'result_id', 'kind', 'ref', 'status', 'details_json', 'created_at'],
        [`EVIDENCE-${i}`, resultId, 'FILE', 'src/file.js', 'VERIFIED', '{"sha256":"fixture"}', timestamp(i + 1)]);
      counts.evidence += 1;
      insert(db, 'verification_runs', ['id', 'result_id', 'command_text', 'cwd', 'exit_code', 'status', 'stdout_excerpt', 'stderr_excerpt', 'started_at', 'ended_at'],
        [`VERIFY-${i}`, resultId, 'npm test', root, 0, 'PASSED', 'pass', '', timestamp(i), timestamp(i + 1)]);
      counts.verificationRuns += 1;
      if (i % 4 === 0) {
        insert(db, 'reviews', ['id', 'task_id', 'result_id', 'reviewer_agent_id', 'reviewer_role', 'decision', 'issues_json', 'evidence_refs_json', 'created_at'],
          [`REVIEW-${i}`, taskId, resultId, 'AGENT-PL', 'PL', 'APPROVE', '[]', `["EVIDENCE-${i}"]`, timestamp(i + 2)]);
        counts.reviews += 1;
      }
    }
    for (let i = 0; i < scale.tasks; i += 5) {
      const reqId = `REQUEST-${i}`;
      insert(db, 'requests', ['id', 'project_id', 'source_task_id', 'source_result_id', 'from_agent_id', 'to_agent_id', 'body', 'blocking', 'status', 'response_id', 'deadline_at', 'created_at', 'resolved_at'],
        [reqId, projectId, `TASK-${i}`, `RESULT-${i}`, 'AGENT-WORKER', 'AGENT-PL', `Question ${i}`, 1, 'RESOLVED', `RESPONSE-${i}`, timestamp(i + 100), timestamp(i), timestamp(i + 1)]);
      insert(db, 'responses', ['id', 'request_id', 'from_agent_id', 'outcome', 'body', 'evidence_refs_json', 'created_at'],
        [`RESPONSE-${i}`, reqId, 'AGENT-PL', 'ANSWER', `Answer ${i}`, '[]', timestamp(i + 1)]);
      counts.requests += 1;
      counts.responses += 1;
    }
    for (let i = 0; i < scale.activities; i += 1) {
      insert(db, 'activities', ['id', 'operation_id', 'project_id', 'event_type', 'actor_id', 'object_ref', 'task_id', 'summary', 'created_at'],
        [`ACTIVITY-${i}`, `operation-${i}`, projectId, i % 3 ? 'TASK_RUN_TERMINAL' : 'TASK_ASSIGNED', i % 2 ? 'AGENT-PL' : 'AGENT-WORKER',
          `TASK-${i % scale.tasks}`, `TASK-${i % scale.tasks}`, `Synthetic event ${i}`, timestamp(i)]);
    }
  });
  return counts;
}

async function sample(store, fn) {
  let queries = 0;
  const db = store.db;
  const originalPrepare = db.prepare;
  db.prepare = function countedPrepare(...args) { queries += 1; return originalPrepare.apply(this, args); };
  const start = performance.now();
  try {
    const value = await fn();
    return { ms: performance.now() - start, queries,
      bytes: Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value)),
      rssBytes: process.memoryUsage().rss };
  } finally {
    db.prepare = originalPrepare;
  }
}

async function measure(store, fn) {
  for (let i = 0; i < 2; i += 1) await sample(store, fn);
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    global.gc?.();
    samples.push(await sample(store, fn));
  }
  return {
    medianMs: Number(numbers(samples.map((item) => item.ms)).toFixed(3)),
    sqlCalls: numbers(samples.map((item) => item.queries)),
    medianJsonBytes: numbers(samples.map((item) => item.bytes)),
    medianRssBytes: numbers(samples.map((item) => item.rssBytes)),
    rangeMs: [Math.min(...samples.map((item) => item.ms)), Math.max(...samples.map((item) => item.ms))].map((x) => Number(x.toFixed(3))),
  };
}

function assertIsolatedTemp(root) {
  const resolved = resolve(root);
  const temp = resolve(tmpdir());
  assert.ok(resolved.startsWith(temp + sep) && resolved.includes('atcp-o0-bench-'), 'cleanup target must be this benchmark temporary directory');
}

async function main() {
  const output = { kind: 'O0 synthetic baseline', measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`, gcExposed: typeof global.gc === 'function', database: [], workspace: [] };
  for (const scale of SCALES) {
    const root = mkdtempSync(join(tmpdir(), 'atcp-o0-bench-'));
    assertIsolatedTemp(root);
    const store = new ControlPlaneStore(join(root, 'fixture.sqlite'));
    try {
      const records = seed(store, scale, root);
      const plane = { requireProject: (id) => store.getProject(id), snapshot: (id) => store.snapshot(id),
        getProjectOverview: (id) => store.getProjectOverview(id), getTaskDetail: ({ projectId, taskId }) => store.getTaskDetail(projectId, taskId) };
      const tools = createPLBridgeTools({ controlPlane: plane, store, adapters: { isLiveParent: () => true, bindProjectParent() {} } });
      const stateTool = tools.find((tool) => tool.name === 'agent_team_project_state');
      const result = {
        scale: scale.name,
        records,
        sqliteAndWalBytes: statSync(store.path).size + statSync(`${store.path}-wal`).size,
        snapshot: await measure(store, () => store.snapshot(projectId)),
        overview: await measure(store, () => store.getProjectOverview(projectId)),
        httpOverview: await measure(store, () => ({ ok: true, data: store.getProjectOverview(projectId) })),
        plDefault: await measure(store, () => stateTool.execute({ project_id: projectId }, { agent: { id: 'SESSION-PL' } })),
        taskList: await measure(store, () => store.listTasks(projectId)),
        taskDetail: await measure(store, () => store.getTaskDetail(projectId, 'TASK-0')),
        historyFirstPage: await measure(store, () => store.getProjectHistoryPage(projectId, 'task-runs', null, 50)),
        activityFirstPage: await measure(store, () => store.listActivityPage({ projectId, limit: 50 })),
        activityFacets: await measure(store, () => store.activityFacets(projectId)),
      };
      output.database.push(result);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
  for (const count of WORKSPACES) {
    const root = mkdtempSync(join(tmpdir(), 'atcp-o0-bench-'));
    assertIsolatedTemp(root);
    try {
      const payload = Buffer.alloc(256, 97);
      const prefix = join(root, 'src');
      mkdirSync(prefix);
      for (let i = 0; i < count; i += 1) {
        const directory = join(prefix, String(Math.floor(i / 100)));
        if (i % 100 === 0) mkdirSync(directory);
        writeFileSync(join(directory, `file-${i}.txt`), payload);
      }
      const samples = [];
      for (let i = 0; i < 7; i += 1) {
        global.gc?.();
        const start = performance.now();
        const snapshot = snapshotWorkspace(root);
        const ms = performance.now() - start;
        assert.equal(snapshot.size, count);
        samples.push({ ms, rssBytes: process.memoryUsage().rss, baselineBytes: Buffer.byteLength(JSON.stringify([...snapshot])) });
      }
      const steady = samples.slice(2);
      output.workspace.push({ files: count, contentBytes: count * payload.length,
        medianMs: Number(numbers(steady.map((item) => item.ms)).toFixed(3)),
        rangeMs: [Math.min(...steady.map((item) => item.ms)), Math.max(...steady.map((item) => item.ms))].map((x) => Number(x.toFixed(3))),
        medianRssBytes: numbers(steady.map((item) => item.rssBytes)),
        baselineJsonBytes: numbers(steady.map((item) => item.baselineBytes)) });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
