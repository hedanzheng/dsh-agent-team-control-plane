import { ControlPlaneError } from '../shared/contracts.js';
import { mkdirSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export class RuntimeAdapterRegistry {
  constructor(ctx, store) {
    this.ctx = ctx;
    this.store = store;
    this.live = new Map();
    this.projectParents = new Map();
  }

  listAvailableRuntimes() {
    return this.store.listRuntimes().map((runtime) => {
      const providerName = runtime.providerKey.startsWith('subagent:')
        ? runtime.providerKey.slice('subagent:'.length)
        : null;
      const provider = providerName ? this.ctx.subagents.getProvider?.(providerName) : null;
      const backendMode = provider
        ? typeof provider.prepareContinuable === 'function' ? 'continuable'
          : typeof provider.start === 'function' ? 'external'
            : 'unsupported'
        : null;
      const activationAvailable = typeof this.ctx.subagents.startActivation === 'function';
      const taskExecution = runtime.kind === 'external-worker'
        && provider !== undefined
        && provider !== null
        && backendMode !== 'unsupported'
        && activationAvailable;
      return {
        providerKey: runtime.providerKey,
        kind: runtime.kind,
        availability: runtime.availability,
        authorized: runtime.authorized,
        capabilities: {
          ...runtime.capabilities,
          ...(providerName ? { activationApi: activationAvailable, backendMode } : {}),
        },
        adapter: runtime.kind === 'external-worker' ? 'managed-subagent-activation' : 'native-harness-pl',
        taskExecution,
        managementSession: runtime.kind === 'harness-agent',
      };
    });
  }

  describe(providerKey) {
    const descriptor = this.listAvailableRuntimes().find((item) => item.providerKey === providerKey);
    if (!descriptor) throw new ControlPlaneError('RUNTIME_NOT_FOUND', `Runtime ${providerKey} is not registered`, 404);
    return descriptor;
  }

  prepareWorkspace(cwd, { create = false } = {}) {
    if (typeof cwd !== 'string' || !cwd.trim() || !isAbsolute(cwd.trim())) {
      throw new ControlPlaneError('RUNTIME_CWD_INVALID', 'Task workspace must be a non-empty absolute path', 409);
    }
    const workspace = resolve(cwd.trim());
    try {
      if (create) mkdirSync(workspace, { recursive: true });
      const info = statSync(workspace);
      if (!info.isDirectory()) throw new ControlPlaneError('RUNTIME_CWD_INVALID', `Task workspace is not a directory: ${workspace}`, 409);
      return workspace;
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      if (error?.code === 'ENOENT') {
        throw new ControlPlaneError('RUNTIME_CWD_MISSING', `Task workspace does not exist: ${workspace}`, 409, { workspace });
      }
      const code = create ? 'RUNTIME_CWD_CREATE_FAILED' : 'RUNTIME_CWD_INVALID';
      throw new ControlPlaneError(code, `Task workspace is unavailable: ${workspace}: ${error instanceof Error ? error.message : String(error)}`, 409, { workspace });
    }
  }

  agentRegistry() {
    return this.ctx.get?.('agents') ?? this.ctx.agents ?? null;
  }

  isLiveParent(parent) {
    if (!parent?.id) return false;
    const registry = this.agentRegistry();
    return Boolean(registry && registry.get(parent.id) === parent);
  }

  bindProjectParent(projectId, parent) {
    if (!projectId || !this.isLiveParent(parent)) {
      throw new ControlPlaneError(
        'RUNTIME_PARENT_REQUIRED',
        'Worker activation requires the exact live PL Agent; reopen the Project PL conversation before starting the Run',
        409,
      );
    }
    this.projectParents.set(projectId, parent);
    return parent;
  }

  resolveProjectParent(projectId, suppliedParent) {
    if (this.isLiveParent(suppliedParent)) return suppliedParent;
    const bound = projectId ? this.projectParents.get(projectId) : null;
    if (this.isLiveParent(bound)) return bound;
    if (projectId) this.projectParents.delete(projectId);
    throw new ControlPlaneError(
      'RUNTIME_PARENT_REQUIRED',
      'Worker activation requires a live PL Agent; open the Project PL conversation and start the Run from that conversation',
      409,
    );
  }

  assertCanStart(spec) {
    const descriptor = this.describe(spec.providerKey);
    if (descriptor.availability !== 'AVAILABLE' || !descriptor.authorized) {
      throw new ControlPlaneError('RUNTIME_NOT_AUTHORIZED', 'Runtime must be AVAILABLE and Human-authorized', 403);
    }
    if (!spec.providerKey.startsWith('subagent:')) {
      throw new ControlPlaneError('RUNTIME_ROLE_UNSUPPORTED', 'Harness Agent runtime is connected as the persistent PL management path, not a Worker backend', 409);
    }
    const providerName = spec.providerKey.slice('subagent:'.length);
    const provider = this.ctx.subagents.getProvider?.(providerName);
    if (!provider) {
      throw new ControlPlaneError('RUNTIME_NOT_FOUND', `Subagent provider ${providerName} is not currently registered`, 404);
    }
    if (typeof this.ctx.subagents.startActivation !== 'function') {
      throw new ControlPlaneError('RUNTIME_CAPABILITY_MISSING', 'DSH subagent runtime does not expose startActivation()', 409);
    }
    if (typeof provider.prepareContinuable !== 'function' && typeof provider.start !== 'function') {
      throw new ControlPlaneError('RUNTIME_CAPABILITY_MISSING', `Subagent provider ${providerName} has no supported activation method`, 409);
    }
    const parent = this.resolveProjectParent(spec.projectId, spec.parentAgent);
    return { descriptor, providerName, parent };
  }

  async startRun(spec) {
    const { descriptor, providerName, parent } = this.assertCanStart(spec);
    const controller = new AbortController();
    const handle = await this.ctx.subagents.startActivation({
      provider: providerName,
      label: spec.label,
      request: {
        cwd: spec.cwd,
        prompt: [{ type: 'text', text: spec.prompt }],
        parent,
      },
      signal: controller.signal,
      delivery: 'caller',
    });
    const runtimeRunId = handle.childId ?? handle.id;
    if (!runtimeRunId || !handle.result || typeof handle.dispose !== 'function') {
      await handle.dispose?.().catch(() => undefined);
      throw new ControlPlaneError('RUNTIME_CAPABILITY_MISSING', `Subagent provider ${providerName} returned an invalid activation handle`, 409);
    }
    const record = {
      controlPlaneRunId: spec.runId,
      taskId: spec.taskId,
      agentId: spec.agentId,
      projectId: spec.projectId,
      parentId: parent.id,
      runtimeRunId,
      handle,
      controller,
      disposePromise: null,
      state: 'RUNNING',
      startedAt: new Date().toISOString(),
      result: null,
    };
    this.live.set(spec.runId, record);
    return { runId: spec.runId, taskId: spec.taskId, agentId: spec.agentId, runtimeRunId, capabilities: descriptor.capabilities };
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
    this.disposeRecord(record);
    return true;
  }

  disposeRecord(record) {
    if (!record.disposePromise) {
      record.disposePromise = Promise.resolve()
        .then(() => record.handle.dispose())
        .catch(() => undefined);
    }
    return record.disposePromise;
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
      await this.disposeRecord(record);
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
      this.disposeRecord(record);
      this.live.delete(runId);
    }
    this.projectParents.clear();
  }
}
