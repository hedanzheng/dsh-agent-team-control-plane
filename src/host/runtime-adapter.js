import { ControlPlaneError } from '../shared/contracts.js';

export class RuntimeAdapterRegistry {
  constructor(ctx, store) {
    this.ctx = ctx;
    this.store = store;
    this.live = new Map();
  }

  listAvailableRuntimes() {
    return this.store.listRuntimes().map((runtime) => ({
      providerKey: runtime.providerKey,
      kind: runtime.kind,
      availability: runtime.availability,
      authorized: runtime.authorized,
      capabilities: runtime.capabilities,
      adapter: runtime.kind === 'external-worker' ? 'one-shot-subagent' : 'native-harness-pl',
      taskExecution: runtime.kind === 'external-worker',
      managementSession: runtime.kind === 'harness-agent',
    }));
  }

  describe(providerKey) {
    const descriptor = this.listAvailableRuntimes().find((item) => item.providerKey === providerKey);
    if (!descriptor) throw new ControlPlaneError('RUNTIME_NOT_FOUND', `Runtime ${providerKey} is not registered`, 404);
    return descriptor;
  }

  async startRun(spec) {
    const descriptor = this.describe(spec.providerKey);
    if (descriptor.availability !== 'AVAILABLE' || !descriptor.authorized) {
      throw new ControlPlaneError('RUNTIME_NOT_AUTHORIZED', 'Runtime must be AVAILABLE and Human-authorized', 403);
    }
    if (!descriptor.taskExecution || !spec.providerKey.startsWith('subagent:')) {
      throw new ControlPlaneError('RUNTIME_ROLE_UNSUPPORTED', 'Harness Agent runtime is connected as the persistent PL management path, not a one-shot Worker', 409);
    }
    const providerName = spec.providerKey.slice('subagent:'.length);
    const provider = this.ctx.subagents.expectProvider(providerName);
    const controller = new AbortController();
    const handle = await provider.start({
      cwd: spec.cwd,
      label: spec.label,
      prompt: [{ type: 'text', text: spec.prompt }],
      parent: {},
      signal: controller.signal,
    });
    const record = {
      controlPlaneRunId: spec.runId,
      taskId: spec.taskId,
      agentId: spec.agentId,
      runtimeRunId: handle.id,
      handle,
      controller,
      state: 'RUNNING',
      startedAt: new Date().toISOString(),
      result: null,
    };
    this.live.set(spec.runId, record);
    return { runId: spec.runId, taskId: spec.taskId, agentId: spec.agentId, runtimeRunId: handle.id, capabilities: descriptor.capabilities };
  }

  observeRun(runId) {
    const record = this.live.get(runId);
    if (!record) return { runId, state: 'NOT_LIVE' };
    return { runId, taskId: record.taskId, agentId: record.agentId, runtimeRunId: record.runtimeRunId, state: record.state, startedAt: record.startedAt };
  }

  cancelRun(runId, reason = 'cancel requested') {
    const record = this.live.get(runId);
    if (!record || record.state !== 'RUNNING') return false;
    record.controller.abort(reason);
    record.state = 'CANCEL_REQUESTED';
    return true;
  }

  async collectRunResult(runId) {
    const record = this.live.get(runId);
    if (!record) throw new ControlPlaneError('RUN_NOT_LIVE', 'Runtime handle is not live in this Host process', 409);
    try {
      record.result = await record.handle.result;
      record.state = 'TERMINAL';
      return {
        runId, taskId: record.taskId, agentId: record.agentId,
        runtimeRunId: record.runtimeRunId,
        stopReason: record.result.stopReason,
        output: record.result.output ?? [],
        diagnostic: typeof record.result.diagnostic === 'string' ? record.result.diagnostic.slice(0, 4000) : null,
      };
    } finally {
      await record.handle.dispose().catch(() => undefined);
    }
  }

  disposeRun(runId) {
    this.live.delete(runId);
  }

  resumeSession() {
    throw new ControlPlaneError('UNSUPPORTED', 'one-shot Worker session resume is unsupported in MVP A', 409);
  }

  deliverLiveMessage() {
    throw new ControlPlaneError('UNSUPPORTED', 'live Worker messaging is unsupported in MVP A', 409);
  }

  close() {
    for (const [runId, record] of this.live) {
      if (record.state === 'RUNNING') record.controller.abort('Host shutdown');
      record.handle.dispose().catch(() => undefined);
      this.live.delete(runId);
    }
  }
}
