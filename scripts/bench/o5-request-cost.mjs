// Synthetic O5 scheduler cost baseline; uses only a temporary SQLite fixture.
// node scripts/bench/o5-request-cost.mjs > docs/optimization-o5-before.json
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { seed } from './optimization-baseline.mjs';
import { ControlPlaneStore } from '../../src/host/store.js';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { CollaborationGovernance } from '../../src/host/governance.js';
import { RequestDispatchScheduler } from '../../src/host/request-scheduler.js';

const root = mkdtempSync(join(tmpdir(), 'atcp-o5-bench-'));
const store = new ControlPlaneStore(join(root, 'fixture.sqlite'));
try {
  seed(store, { name: 'O5', tasks: 10, runs: 20, activities: 200 }, root);
  const plane = new AgentTeamControlPlane(store, null);
  const governance = new CollaborationGovernance({ store, controlPlane: plane, adapters: { describe: () => ({ taskExecution: false }) } });
  const originalPrepare = store.db.prepare;
  let sql = 0;
  store.db.prepare = function countedPrepare(...args) { sql += 1; return originalPrepare.apply(this, args); };
  const sample = (label) => {
    const runs = 1000;
    sql = 0;
    const started = performance.now();
    for (let index = 0; index < runs; index += 1) {
      governance.timeoutExpiredRequests();
      governance.dispatchPendingRequests();
    }
    return { label, runs, elapsedMs: Number((performance.now() - started).toFixed(3)), sqlPrepareCalls: sql, sqlPerTick: sql / runs };
  };
  const simulateScheduler = (label) => {
    const periodMs = 59999;
    let clock = Date.now();
    let timerId = 0;
    let timerCallbacks = 0;
    const timers = new Map();
    const scheduler = new RequestDispatchScheduler({
      governance, nowMs: () => clock,
      setTimer(fn, delay) { const id = ++timerId; timers.set(id, { due: clock + delay, fn }); return id; },
      clearTimer(id) { timers.delete(id); },
    });
    sql = 0;
    const started = performance.now();
    scheduler.start();
    const end = clock + periodMs;
    while (timers.size) {
      const next = [...timers].sort((left, right) => left[1].due - right[1].due)[0];
      if (next[1].due > end) break;
      assert.ok(++timerCallbacks < 100, 'scheduler did not stay bounded');
      clock = next[1].due;
      timers.delete(next[0]);
      next[1].fn();
    }
    scheduler.stop();
    return { label, periodMs, timerCallbacks, sqlPrepareCalls: sql, executionMs: Number((performance.now() - started).toFixed(3)) };
  };
  const idle = sample('no open Request');
  const idleScheduler = simulateScheduler('no open Request');
  // Pending Request addresses a busy recipient and cannot dispatch yet.
  const deadline = new Date(Date.now() + 15 * 60_000).toISOString();
  store.db.prepare("UPDATE requests SET status='PENDING', response_id=NULL, resolved_at=NULL, deadline_at=? WHERE id='REQUEST-0'").run(deadline);
  store.db.prepare("UPDATE tasks SET status='WAITING', waiting_on_ref='REQUEST-0' WHERE id='TASK-0'").run();
  store.db.prepare("UPDATE agents SET current_task_id='TASK-1' WHERE id='AGENT-PL'").run();
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status='PENDING'").get().n, 1);
  const pending = sample('one queued Request, recipient busy');
  const pendingScheduler = simulateScheduler('one queued Request, recipient busy');
  store.db.prepare = originalPrepare;
  process.stdout.write(`${JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, platform: process.platform, idle, pending, idleScheduler, pendingScheduler, legacyTimerIntervalMs: 1000 }, null, 2)}\n`);
} finally {
  store.close();
  const full = resolve(root);
  assert.ok(full.startsWith(resolve(tmpdir()) + sep) && full.includes('atcp-o5-bench-'));
  rmSync(root, { recursive: true, force: true });
}
