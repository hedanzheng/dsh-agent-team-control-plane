import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ControlPlaneStore } from '../../src/host/store.js';

function stamp(index) {
  return new Date(Date.UTC(2026, 9, 23, 0, 0, 0, index)).toISOString();
}

test('R5 Activity uses project-isolated keyset pages, reliable filters, and the compound index at 1,000+ rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'atcp-r5-activity-'));
  const store = new ControlPlaneStore(join(root, 'control-plane.sqlite'));
  try {
    for (let index = 0; index < 1_205; index += 1) {
      store.appendActivity({
        id: `ACTIVITY-A-${String(index).padStart(4, '0')}`,
        operationId: `operation-a-${index}`,
        projectId: 'PROJECT-A',
        eventType: index % 3 === 0 ? 'TASK_UPDATED' : 'TASK_RUN_TERMINAL',
        actorId: index % 2 === 0 ? 'AGENT-A' : 'AGENT-B',
        objectRef: `OBJECT-A-${index}`,
        taskId: index % 5 === 0 ? 'TASK-A-1' : 'TASK-A-2',
        summary: `Project A event ${index}`,
        createdAt: stamp(index),
      });
    }
    for (let index = 0; index < 31; index += 1) {
      store.appendActivity({
        id: `ACTIVITY-B-${String(index).padStart(4, '0')}`,
        operationId: `operation-b-${index}`,
        projectId: 'PROJECT-B',
        eventType: 'PROJECT_CREATED',
        actorId: 'AGENT-FOREIGN',
        objectRef: `OBJECT-B-${index}`,
        summary: `Project B event ${index}`,
        createdAt: stamp(index),
      });
    }

    const ids = [];
    let cursor = null;
    do {
      const page = store.listActivityPage({ projectId: 'PROJECT-A', limit: 50, cursor });
      assert.ok(page.items.length <= 50);
      assert.ok(page.items.every((item) => item.projectId === 'PROJECT-A'));
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      assert.equal(page.hasMore, Boolean(cursor));
    } while (cursor);
    assert.equal(ids.length, 1_205);
    assert.equal(new Set(ids).size, 1_205);
    assert.equal(ids.some((id) => id.startsWith('ACTIVITY-B-')), false);

    const filtered = store.listActivityPage({
      projectId: 'PROJECT-A', limit: 100, actorId: 'AGENT-A', eventType: 'TASK_UPDATED', taskId: 'TASK-A-1',
    });
    assert.ok(filtered.items.length > 0);
    assert.ok(filtered.items.every((item) => item.actorId === 'AGENT-A'
      && item.eventType === 'TASK_UPDATED' && item.taskId === 'TASK-A-1'));

    const plan = store.db.prepare(`EXPLAIN QUERY PLAN
      SELECT * FROM activities WHERE project_id=? ORDER BY created_at DESC, id DESC LIMIT 51`).all('PROJECT-A');
    assert.match(plan.map((row) => row.detail).join('\n'), /activities_project_created_id/);
    assert.equal(store.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value, '9');
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

