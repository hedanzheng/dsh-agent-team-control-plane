import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ControlPlaneError,
  DEFAULT_ROLE_PERMISSIONS,
  FALLBACK_INTERVIEW,
  assertExpectedVersion,
  requireActor,
  requireInteger,
  requireStringArray,
} from '../../src/shared/contracts.js';

test('fallback interview is deterministic and covers scope, constraints, and success', () => {
  assert.deepEqual(FALLBACK_INTERVIEW.map((item) => item.id), [
    'scope_allowed', 'constraints', 'success_criteria',
  ]);
  assert.equal(new Set(FALLBACK_INTERVIEW.map((item) => item.id)).size, 3);
});

test('role permissions remain separate and least-privilege oriented', () => {
  assert.ok(DEFAULT_ROLE_PERMISSIONS.PROJECT_LEAD.includes('team:propose'));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.WORKER.includes('task:execute-assigned'));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.WORKER.includes('task:propose'));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.REVIEWER.includes('review:submit'));
  assert.ok(DEFAULT_ROLE_PERMISSIONS.REVIEWER.includes('task:propose'));
  assert.ok(!DEFAULT_ROLE_PERMISSIONS.WORKER.includes('team:propose'));
});

test('validation rejects bad actors, bad arrays, integers, and stale versions', () => {
  assert.throws(() => requireActor({ type: 'worker', id: 'x' }), (error) => error instanceof ControlPlaneError && error.code === 'UNAUTHORIZED');
  assert.throws(() => requireStringArray([], 'items', { min: 1 }), /between 1 and 32/);
  assert.throws(() => requireInteger(1.5, 'version', { min: 1 }), /must be an integer/);
  assert.throws(() => assertExpectedVersion({ version: 3 }, 2), (error) => error.code === 'VERSION_CONFLICT' && error.status === 409);
});

