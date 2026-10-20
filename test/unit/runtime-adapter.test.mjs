import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeAdapterRegistry } from '../../src/host/runtime-adapter.js';

function fixture({ provider = { name: 'fork', prepareContinuable() {} }, liveParent = true } = {}) {
  const parent = { id: 'SESSION-PL-1' };
  const agents = new Map(liveParent ? [[parent.id, parent]] : []);
  const calls = [];
  let disposed = 0;
  const activation = {
    childId: 'SESSION-WORKER-1',
    result: Promise.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: '{"terminalKind":"SUCCESS"}' }],
    }),
    async dispose() { disposed += 1; },
  };
  const ctx = {
    get(name) { return name === 'agents' ? agents : undefined; },
    subagents: {
      getProvider(name) { return name === 'fork' ? provider : undefined; },
      async startActivation(spec) { calls.push(spec); return activation; },
    },
  };
  const store = {
    listRuntimes() {
      return [{
        providerKey: 'subagent:fork', kind: 'external-worker', availability: 'AVAILABLE',
        authorized: true, capabilities: { oneShot: true },
      }];
    },
  };
  return { registry: new RuntimeAdapterRegistry(ctx, store), parent, calls, disposed: () => disposed };
}

test('continuable-only provider starts through the managed startActivation API', async () => {
  const fx = fixture();
  fx.registry.bindProjectParent('PROJECT-1', fx.parent);
  const started = await fx.registry.startRun({
    runId: 'RUN-1', taskId: 'TASK-1', agentId: 'AGENT-WORKER-1',
    projectId: 'PROJECT-1', providerKey: 'subagent:fork', cwd: 'D:\\work',
    label: 'task', prompt: 'implement task',
  });
  assert.equal(started.runtimeRunId, 'SESSION-WORKER-1');
  assert.equal(fx.calls.length, 1);
  assert.equal(fx.calls[0].provider, 'fork');
  assert.equal(fx.calls[0].delivery, 'caller');
  assert.equal(fx.calls[0].request.parent, fx.parent);
  assert.equal(fx.calls[0].request.cwd, 'D:\\work');
  const result = await fx.registry.collectRunResult('RUN-1');
  assert.equal(result.stopReason, 'completed');
  assert.equal(fx.disposed(), 1);
});

test('start is rejected before provider activation when no exact live PL parent exists', () => {
  const fx = fixture({ liveParent: false });
  assert.throws(
    () => fx.registry.assertCanStart({
      projectId: 'PROJECT-1', providerKey: 'subagent:fork', parentAgent: fx.parent,
    }),
    (error) => error.code === 'RUNTIME_PARENT_REQUIRED' && error.status === 409,
  );
  assert.equal(fx.calls.length, 0);
});

test('provider without start or prepareContinuable reports a capability error', () => {
  const fx = fixture({ provider: { name: 'fork' } });
  assert.throws(
    () => fx.registry.assertCanStart({
      projectId: 'PROJECT-1', providerKey: 'subagent:fork', parentAgent: fx.parent,
    }),
    (error) => error.code === 'RUNTIME_CAPABILITY_MISSING' && error.status === 409,
  );
});

test('cancelling an activation aborts and disposes the managed handle once', async () => {
  const fx = fixture();
  await fx.registry.startRun({
    runId: 'RUN-1', taskId: 'TASK-1', agentId: 'AGENT-WORKER-1',
    projectId: 'PROJECT-1', providerKey: 'subagent:fork', parentAgent: fx.parent,
    cwd: 'D:\\work', label: 'task', prompt: 'implement task',
  });
  assert.equal(fx.registry.cancelRun('RUN-1', 'test cancellation'), true);
  await fx.registry.collectRunResult('RUN-1');
  assert.equal(fx.disposed(), 1);
});
