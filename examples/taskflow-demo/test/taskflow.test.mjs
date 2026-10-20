import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskApi } from '../src/task-api.js';
import { validateTaskInput } from '../src/contract.js';

test('contract rejects empty and overlong titles', () => {
  assert.equal(validateTaskInput({ title: '   ' }).ok, false);
  assert.equal(validateTaskInput({ title: 'x'.repeat(121) }).ok, false);
});

test('API creates, lists, updates, and rejects invalid state', () => {
  let tick = 0;
  const api = new TaskApi(() => `2026-10-20T00:00:0${tick++}.000Z`);
  const created = api.create({ title: 'Ship TaskFlow' });
  assert.equal(created.status, 201);
  assert.deepEqual(api.list(), [created.body]);
  assert.equal(api.updateStatus(created.body.id, 'DONE').body.status, 'DONE');
  assert.equal(api.updateStatus(created.body.id, 'UNKNOWN').status, 400);
  assert.equal(api.updateStatus('missing', 'DONE').status, 404);
});
