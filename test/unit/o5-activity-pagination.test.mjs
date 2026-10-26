import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { seed } from '../../scripts/bench/optimization-baseline.mjs';
import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { ControlPlaneStore } from '../../src/host/store.js';

test('O5 Activity 20,000 rows page by 50 without duplicate facets, omissions or cross-filter leakage', () => {
  const root = mkdtempSync(join(tmpdir(), 'atcp-o5-activity-'));
  const store = new ControlPlaneStore(join(root, 'fixture.sqlite'));
  try {
    seed(store, { name: 'O5', tasks: 10, runs: 20, activities: 20000 }, root);
    const plane = new AgentTeamControlPlane(store, null);
    const projectId = 'PROJECT-BENCH';
    const facets = store.activityFacets.bind(store);
    let facetCalls = 0;
    store.activityFacets = (...args) => { facetCalls += 1; return facets(...args); };
    const ids = [];
    let cursor = null;
    let pageCount = 0;
    do {
      const page = plane.activityPage({ projectId, limit: 50, cursor, includeFacets: pageCount === 0 });
      if (pageCount === 0) assert.ok(page.facets);
      else assert.equal('facets' in page, false);
      assert.ok(page.items.length <= 50);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pageCount += 1;
      assert.ok(pageCount <= 400);
    } while (cursor);
    assert.equal(pageCount, 400);
    assert.equal(ids.length, 20000);
    assert.equal(new Set(ids).size, 20000);
    assert.equal(facetCalls, 1);

    const filter = { projectId, limit: 50, actorId: 'AGENT-PL', eventType: 'TASK_RUN_TERMINAL', taskId: 'TASK-1' };
    const filtered = plane.activityPage({ ...filter, includeFacets: true });
    assert.ok(filtered.items.length > 0);
    assert.ok(filtered.items.every((item) => item.actorId === filter.actorId && item.eventType === filter.eventType && item.taskId === filter.taskId));
    assert.equal(facetCalls, 2);
    const next = plane.activityPage({ ...filter, cursor: filtered.nextCursor, includeFacets: false });
    assert.equal('facets' in next, false);
    assert.equal(facetCalls, 2);
    assert.equal(new Set([...filtered.items, ...next.items].map((item) => item.id)).size, filtered.items.length + next.items.length);
  } finally {
    store.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('atcp-o5-activity-'));
    rmSync(root, { recursive: true, force: true });
  }
});
