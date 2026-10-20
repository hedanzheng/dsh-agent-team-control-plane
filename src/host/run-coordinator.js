import { id, json, now, requireActor, requireInteger, requireString, requireStringArray, ControlPlaneError } from '../shared/contracts.js';
import { buildTaskRunContext } from './context-builder.js';
import { outputText, parseStructuredResult } from './result-parser.js';
import { runVerificationCommands, verifyArtifacts } from './verification.js';

const ACTIVE_RUN = new Set(['CREATED', 'STARTING', 'RUNNING']);

function actorKey(actor) {
  return `${actor.type}:${actor.id}`;
}

function normalizeCommands(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 8) throw new ControlPlaneError('INVALID_INPUT', 'verificationCommands must contain at most 8 commands');
  return value.map((item, index) => {
    const source = typeof item === 'string' ? { command: item } : item;
    if (!source || typeof source !== 'object') throw new ControlPlaneError('INVALID_INPUT', `verificationCommands[${index}] is invalid`);
    return {
      command: requireString(source.command, `verificationCommands[${index}].command`, { max: 4000 }),
      timeoutMs: requireInteger(source.timeoutMs ?? 120000, `verificationCommands[${index}].timeoutMs`, { min: 1000, max: 300000 }),
    };
  });
}

function terminalStatus(terminalKind) {
  return terminalKind === 'SUCCESS' ? 'SUCCEEDED' : terminalKind;
}

function syntheticResult(kind, summary, raw = '') {
  return {
    terminalKind: kind,
    changeSummary: summary,
    artifacts: [], verifiedActions: [], testPlan: '', risks: [], unresolved: [summary], findings: [], evidenceRefs: [],
    checkpoint: kind === 'NEEDS_INPUT' ? { progress: '', changedFiles: [], pending: summary, nextStep: '' } : null,
    requestProposal: null,
    rawOutputExcerpt: raw.slice(-20000),
  };
}

export class TaskRunCoordinator {
  constructor({ store, controlPlane, adapters, governance = null, logger, artifactVerifier = verifyArtifacts, commandVerifier = runVerificationCommands }) {
    this.store = store;
    this.controlPlane = controlPlane;
    this.adapters = adapters;
    this.governance = governance;
    this.logger = logger;
    this.artifactVerifier = artifactVerifier;
    this.commandVerifier = commandVerifier;
    this.jobs = new Map();
    this.cancelReasons = new Map();
    this.watchdogTimer = null;
  }

  addRunEvent(runId, fromStatus, toStatus, details, at = now()) {
    this.store.db.prepare(`INSERT INTO task_run_events(id, run_id, from_status, to_status, details_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?)`).run(id('RUN-EVENT'), runId, fromStatus, toStatus, json(details), at);
  }

  startTaskRun(input) {
    const project = this.controlPlane.requireProject(input.projectId);
    const who = this.controlPlane.assertProjectLead(project, input.actor);
    const task = this.controlPlane.requireTask(project, input.taskId);
    const expectedVersion = requireInteger(input.expectedVersion, 'expectedVersion', { min: 1 });
    if (task.version !== expectedVersion) {
      throw new ControlPlaneError('VERSION_CONFLICT', 'Task version changed; reload before retrying', 409, { expectedVersion: input.expectedVersion, actualVersion: task.version });
    }
    if (task.status !== 'READY' || !task.assignedAgentId) throw new ControlPlaneError('TASK_NOT_RUNNABLE', 'Task must be READY and assigned', 409);
    if (!this.controlPlane.dependenciesVerified(project.id, task.dependencies)) throw new ControlPlaneError('DEPENDENCIES_NOT_VERIFIED', 'Task dependencies are not VERIFIED', 409);
    if (this.store.activeTaskRun(task.id)) throw new ControlPlaneError('TASK_RUN_ALREADY_ACTIVE', 'Task already has an active Run', 409);
    const agent = this.controlPlane.requireProjectAgent(project, task.assignedAgentId);
    if (agent.currentTaskId !== task.id || agent.role !== 'WORKER') throw new ControlPlaneError('AGENT_ASSIGNMENT_INVALID', 'assigned Worker does not hold this Task', 409);
    const runtime = this.controlPlane.requireUsableAuthorizedRuntime(agent.providerKey);
    const descriptor = this.adapters.describe(runtime.providerKey);
    if (!descriptor.taskExecution) throw new ControlPlaneError('RUNTIME_ROLE_UNSUPPORTED', 'assigned runtime cannot execute one-shot Worker Tasks', 409);
    const writeIntent = input.writeIntent !== false;
    this.adapters.prepareWorkspace(project.workspaceDir, { create: writeIntent });
    this.adapters.assertCanStart({
      providerKey: runtime.providerKey,
      projectId: project.id,
      parentAgent: input.parentAgent,
    });
    const operationId = this.controlPlane.assertNewOperation(input.operationId);
    const verificationCommands = normalizeCommands(input.verificationCommands);
    const timeoutMs = requireInteger(input.timeoutMs ?? 600000, 'timeoutMs', { min: 5000, max: 1800000 });
    const attempts = this.store.db.prepare('SELECT COALESCE(MAX(attempt), 0) AS value FROM task_runs WHERE task_id=?').get(task.id).value;
    const runId = id('RUN');
    const createdAt = now();
    const { prompt } = buildTaskRunContext(this.store, { project, task, agent, verificationCommands });
    this.store.transaction(() => {
      if (writeIntent) {
        const locked = this.store.db.prepare('SELECT run_id FROM workspace_locks WHERE workspace_ref=?').get(project.workspaceDir);
        if (locked) throw new ControlPlaneError('WORKSPACE_BUSY', `workspace has active write Run ${locked.run_id}`, 409);
      }
      this.store.db.prepare(`INSERT INTO task_runs(
        id, task_id, agent_id, provider_key, attempt, runtime_session_ref, workspace_ref, write_intent,
        status, terminal_kind, terminal_payload_ref, capability_snapshot_json, verification_commands_json,
        watchdog_state, error_code, error_message, started_at, ended_at, heartbeat_at, cancel_requested_at, created_at
      ) VALUES(?, ?, ?, ?, ?, NULL, ?, ?, 'CREATED', NULL, NULL, ?, ?, 'HEALTHY', NULL, NULL, NULL, NULL, ?, NULL, ?)`).run(
        runId, task.id, agent.id, agent.providerKey, attempts + 1, project.workspaceDir, writeIntent ? 1 : 0,
        json(descriptor.capabilities), json(verificationCommands), createdAt, createdAt,
      );
      this.addRunEvent(runId, null, 'CREATED', { operationId }, createdAt);
      this.store.db.prepare("UPDATE task_runs SET status='STARTING' WHERE id=?").run(runId);
      this.addRunEvent(runId, 'CREATED', 'STARTING', { adapter: descriptor.adapter }, createdAt);
      if (writeIntent) this.store.db.prepare('INSERT INTO workspace_locks(workspace_ref, run_id, acquired_at) VALUES(?, ?, ?)').run(project.workspaceDir, runId, createdAt);
      this.store.db.prepare('UPDATE tasks SET version=version+1, updated_at=? WHERE id=?').run(createdAt, task.id);
      this.controlPlane.activity({ operationId, projectId: project.id, eventType: 'TASK_RUN_CREATED', actor: who, objectRef: runId, summary: `Run ${runId} attempt ${attempts + 1} queued through ${descriptor.adapter}`, at: createdAt });
    });
    const job = Promise.resolve().then(() => this.execute({
      runId, project, task: this.store.getTask(task.id), agent, prompt, timeoutMs,
      parentAgent: input.parentAgent,
    }))
      .catch((error) => this.logger.error(`Task Run ${runId} coordinator failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`))
      .finally(() => this.jobs.delete(runId));
    this.jobs.set(runId, job);
    return this.store.snapshot(project.id);
  }

  async execute(spec) {
    let timeout;
    let runtimeStarted = false;
    try {
      const started = await this.adapters.startRun({
        runId: spec.runId, taskId: spec.task.id, agentId: spec.agent.id,
        providerKey: spec.agent.providerKey, projectId: spec.project.id,
        parentAgent: spec.parentAgent, cwd: spec.project.workspaceDir,
        label: `${spec.task.id}-${spec.task.title}`.slice(0, 100), prompt: spec.prompt,
      });
      runtimeStarted = true;
      const at = now();
      this.store.transaction(() => {
        this.store.db.prepare(`UPDATE task_runs SET status='RUNNING', runtime_session_ref=?, started_at=?, heartbeat_at=? WHERE id=?`).run(started.runtimeRunId, at, at, spec.runId);
        this.addRunEvent(spec.runId, 'STARTING', 'RUNNING', { runtimeRunId: started.runtimeRunId }, at);
        this.store.db.prepare("UPDATE tasks SET status='RUNNING', version=version+1, updated_at=? WHERE id=?").run(at, spec.task.id);
        this.controlPlane.addTaskStateEvent({ taskId: spec.task.id, fromStatus: 'READY', toStatus: 'RUNNING', actor: { type: 'agent', id: spec.agent.id }, reason: `TaskRun ${spec.runId} started`, at });
        this.store.db.prepare("UPDATE agents SET status='RUNNING', current_task_id=? WHERE id=?").run(spec.task.id, spec.agent.id);
      });
      timeout = setTimeout(() => {
        this.cancelReasons.set(spec.runId, 'timeout');
        this.adapters.cancelRun(spec.runId, 'Task Run timeout');
      }, spec.timeoutMs);
      if (this.cancelReasons.get(spec.runId) === 'cancel') {
        this.adapters.cancelRun(spec.runId, 'Human/PL cancellation requested while starting');
      }
      const runtimeResult = await this.adapters.collectRunResult(spec.runId);
      await this.finishFromRuntime(spec, runtimeResult);
    } catch (error) {
      await this.finishSynthetic(
        spec,
        runtimeStarted ? 'UNKNOWN' : 'CANNOT_START',
        error instanceof ControlPlaneError
          ? error.code
          : runtimeStarted ? 'RUNTIME_EXECUTION_ERROR' : 'RUNTIME_START_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      this.adapters.disposeRun(spec.runId);
      this.cancelReasons.delete(spec.runId);
    }
  }

  async finishFromRuntime(spec, runtimeResult) {
    const cancellation = this.cancelReasons.get(spec.runId);
    if (runtimeResult.stopReason === 'aborted') {
      const kind = cancellation === 'timeout' ? 'TIMED_OUT' : 'CANCELLED';
      await this.persistTerminal(spec, syntheticResult(kind, kind === 'TIMED_OUT' ? 'Runtime timed out; workspace outcome requires inspection' : 'Run cancelled by Human/PL'), runtimeResult, []);
      return;
    }
    if (runtimeResult.stopReason !== 'completed') {
      const diagnostic = runtimeResult.diagnostic ? `: ${runtimeResult.diagnostic}` : '';
      await this.persistTerminal(spec, syntheticResult('UNKNOWN', `Runtime ended with stop reason ${runtimeResult.stopReason}${diagnostic}`, outputText(runtimeResult.output)), runtimeResult, []);
      return;
    }
    let parsed;
    try {
      parsed = parseStructuredResult(runtimeResult.output);
    } catch (error) {
      await this.persistTerminal(spec, syntheticResult('UNKNOWN', error instanceof Error ? error.message : String(error), outputText(runtimeResult.output)), runtimeResult, []);
      return;
    }
    const artifactEvidence = await this.artifactVerifier(spec.project.workspaceDir, spec.task, parsed.artifacts);
    const commands = this.store.getTaskRun(spec.runId).verificationCommands;
    const verificationRuns = ['SUCCESS', 'PARTIAL'].includes(parsed.terminalKind)
      ? await this.commandVerifier(spec.project.workspaceDir, commands) : [];
    const terminal = await this.persistTerminal(spec, parsed, runtimeResult, verificationRuns, artifactEvidence);
    if (terminal && this.governance) this.governance.processTerminalResult({
      project: spec.project, task: this.store.getTask(spec.task.id), agent: spec.agent,
      resultId: terminal.resultId, parsed,
    });
  }

  async finishSynthetic(spec, kind, code, message) {
    const current = this.store.getTaskRun(spec.runId);
    if (!current || !ACTIVE_RUN.has(current.status)) return;
    await this.persistTerminal(spec, syntheticResult(kind, message), { stopReason: 'error', output: [] }, [], [], { code, message });
  }

  async persistTerminal(spec, parsed, runtimeResult, verificationRuns = [], artifactEvidence = [], explicitError = null) {
    const run = this.store.getTaskRun(spec.runId);
    if (!run || !ACTIVE_RUN.has(run.status)) return;
    const currentTask = this.store.getTask(spec.task.id);
    const resultId = id('RESULT');
    const at = now();
    let outcome = parsed.terminalKind;
    if (parsed.terminalKind === 'SUCCESS') {
      const commandsPass = verificationRuns.length > 0 && verificationRuns.every((item) => item.status === 'PASSED');
      const filesPass = artifactEvidence.every((item) => item.status === 'VERIFIED');
      if (!commandsPass || !filesPass) outcome = 'PARTIAL';
    }
    const verificationUnresolved = [];
    if (parsed.terminalKind === 'SUCCESS' && verificationRuns.length === 0) {
      verificationUnresolved.push('Host verification incomplete: no verification command was configured');
    }
    for (const item of artifactEvidence.filter((entry) => entry.status !== 'VERIFIED')) {
      verificationUnresolved.push(`Host artifact verification failed for ${item.ref}: ${item.details?.error ?? item.status}`);
    }
    for (const item of verificationRuns.filter((entry) => entry.status !== 'PASSED')) {
      const diagnostic = item.stderrExcerpt || item.stdoutExcerpt || item.status;
      verificationUnresolved.push(`Host command verification ${item.status.toLowerCase()} (exit ${item.exitCode ?? 'unknown'}): ${item.command}: ${diagnostic}`.slice(0, 4000));
    }
    const unresolved = [...new Set([...(parsed.unresolved ?? []), ...verificationUnresolved])];
    const commandEvidence = verificationRuns.map((item) => ({
      kind: 'COMMAND', ref: item.command, status: item.status === 'PASSED' ? 'VERIFIED' : 'FAILED',
      details: { exitCode: item.exitCode, stdoutExcerpt: item.stdoutExcerpt, stderrExcerpt: item.stderrExcerpt },
    }));
    const runtimeEvidence = {
      kind: 'RUNTIME', ref: run.runtimeSessionRef ?? spec.runId,
      status: parsed.terminalKind === 'UNKNOWN' ? 'UNVERIFIED' : ['FAILED', 'CANNOT_START', 'CANCELLED', 'TIMED_OUT'].includes(parsed.terminalKind) ? 'FAILED' : 'VERIFIED',
      details: { stopReason: runtimeResult.stopReason, diagnostic: runtimeResult.diagnostic ?? null, providerKey: run.providerKey, capabilities: run.capabilities },
    };
    const allEvidence = [...artifactEvidence, ...commandEvidence, runtimeEvidence].map((item) => ({ ...item, id: id('EVIDENCE') }));
    const verifiedActions = [
      ...artifactEvidence.filter((item) => item.status === 'VERIFIED').map((item) => `Host hashed artifact ${item.ref}`),
      ...verificationRuns.filter((item) => item.status === 'PASSED').map((item) => `Host command passed: ${item.command}`),
    ];
    let taskStatus;
    if (['SUCCESS', 'PARTIAL'].includes(outcome)) taskStatus = 'SUBMITTED';
    else if (['NEEDS_INPUT', 'TIMED_OUT', 'UNKNOWN'].includes(outcome)) taskStatus = 'WAITING';
    else if (outcome === 'CANNOT_START') taskStatus = 'READY';
    else taskStatus = outcome;
    const runStatus = terminalStatus(parsed.terminalKind);
    const error = explicitError ?? (['UNKNOWN', 'TIMED_OUT'].includes(outcome) ? { code: outcome, message: parsed.changeSummary } : null);
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO results(
        id, task_id, run_id, outcome, change_summary, artifacts_json, verified_actions_json, test_plan,
        risks_json, unresolved_json, findings_json, evidence_refs_json, checkpoint_json,
        request_proposal_json, raw_output_excerpt, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        resultId, spec.task.id, spec.runId, outcome, parsed.changeSummary, json(parsed.artifacts), json(verifiedActions),
        parsed.testPlan, json(parsed.risks), json(unresolved), json(parsed.findings),
        json([...parsed.evidenceRefs, ...allEvidence.map((item) => item.id)]), json(parsed.checkpoint),
        json(parsed.requestProposal), parsed.rawOutputExcerpt, at,
      );
      for (const item of allEvidence) {
        this.store.db.prepare(`INSERT INTO evidence(id, result_id, kind, ref, status, details_json, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?)`).run(item.id, resultId, item.kind, item.ref, item.status, json(item.details), at);
      }
      for (const item of verificationRuns) {
        this.store.db.prepare(`INSERT INTO verification_runs(
          id, result_id, command_text, cwd, exit_code, status, stdout_excerpt, stderr_excerpt, started_at, ended_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id('VERIFY'), resultId, item.command, item.cwd, item.exitCode, item.status,
          item.stdoutExcerpt, item.stderrExcerpt, item.startedAt, item.endedAt,
        );
      }
      this.store.db.prepare(`UPDATE task_runs SET status=?, terminal_kind=?, terminal_payload_ref=?,
        error_code=?, error_message=?, ended_at=?, heartbeat_at=?, watchdog_state='TERMINAL' WHERE id=?`).run(
        runStatus, parsed.terminalKind, resultId, error?.code ?? null, error?.message ?? null, at, at, spec.runId,
      );
      this.addRunEvent(spec.runId, run.status, runStatus, { resultId, outcome, stopReason: runtimeResult.stopReason }, at);
      const waitingReason = taskStatus === 'WAITING' ? parsed.changeSummary : null;
      const waitingOn = taskStatus === 'WAITING' ? (parsed.requestProposal?.toAgentId ?? resultId) : null;
      this.store.db.prepare(`UPDATE tasks SET status=?, result_id=?, waiting_reason=?, waiting_on_ref=?, checkpoint_ref=?,
        waiting_deadline=NULL, version=version+1, updated_at=? WHERE id=?`).run(
        taskStatus, resultId, waitingReason, waitingOn, taskStatus === 'WAITING' ? resultId : null, at, spec.task.id,
      );
      if (taskStatus !== currentTask.status) this.controlPlane.addTaskStateEvent({
        taskId: spec.task.id, fromStatus: currentTask.status, toStatus: taskStatus,
        actor: { type: 'agent', id: spec.agent.id }, reason: `TaskRun ${spec.runId} ended as ${outcome}`,
        evidenceRefs: allEvidence.map((item) => item.id), at,
      });
      if (taskStatus === 'WAITING') {
        this.store.db.prepare("UPDATE agents SET status='WAITING', current_task_id=? WHERE id=?").run(spec.task.id, spec.agent.id);
      } else if (taskStatus === 'READY') {
        this.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=? WHERE id=?").run(spec.task.id, spec.agent.id);
      } else {
        this.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=NULL WHERE id=? AND current_task_id=?").run(spec.agent.id, spec.task.id);
      }
      this.store.db.prepare('DELETE FROM workspace_locks WHERE run_id=?').run(spec.runId);
      this.controlPlane.activity({
        operationId: `${spec.runId}:terminal`, projectId: spec.project.id, eventType: 'TASK_RUN_TERMINAL',
        actor: { type: 'agent', id: spec.agent.id }, objectRef: spec.runId,
        summary: `Run ${runStatus}; Result ${outcome}; Task ${taskStatus}${verificationUnresolved.length ? `; ${verificationUnresolved.join(' | ').slice(0, 1200)}` : ''}`, at,
      });
    });
    return { resultId, outcome, taskStatus, runStatus };
  }

  cancelTaskRun(input) {
    const run = this.store.getTaskRun(requireString(input.runId, 'runId', { max: 128 }));
    if (!run || !ACTIVE_RUN.has(run.status)) throw new ControlPlaneError('RUN_NOT_ACTIVE', 'Task Run is not active', 409);
    const task = this.store.getTask(run.taskId);
    const project = this.controlPlane.requireProject(task.projectId);
    const who = requireActor(input.actor);
    if (!((who.type === 'human' && who.id === project.ownerId) || (who.type === 'pl' && who.id === project.leadAgentId))) {
      throw new ControlPlaneError('FORBIDDEN', 'only Human Owner or PL may cancel a Run', 403);
    }
    const operationId = this.controlPlane.assertNewOperation(input.operationId);
    const at = now();
    const requested = this.adapters.cancelRun(run.id, 'Human/PL cancellation');
    this.cancelReasons.set(run.id, 'cancel');
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE task_runs SET cancel_requested_at=?, watchdog_state=? WHERE id=?").run(at, requested ? 'CANCEL_REQUESTED' : 'CANCEL_PENDING_NOT_LIVE', run.id);
      this.controlPlane.activity({ operationId, projectId: project.id, eventType: 'TASK_RUN_CANCEL_REQUESTED', actor: who, objectRef: run.id, summary: requested ? 'Runtime abort signal sent' : 'Run handle not live; outcome remains pending/unknown', at });
    });
    return this.store.snapshot(project.id);
  }

  recoverInterruptedRuns() {
    const rows = this.store.db.prepare("SELECT * FROM task_runs WHERE status IN ('CREATED','STARTING','RUNNING')").all();
    for (const row of rows) {
      const run = this.store.getTaskRun(row.id);
      const task = this.store.getTask(run.taskId);
      if (!task) continue;
      const project = this.controlPlane.requireProject(task.projectId);
      const at = now();
      const resultId = id('RESULT');
      this.store.transaction(() => {
        this.store.db.prepare(`INSERT INTO results(
          id, task_id, run_id, outcome, change_summary, artifacts_json, verified_actions_json, test_plan,
          risks_json, unresolved_json, findings_json, evidence_refs_json, checkpoint_json, request_proposal_json,
          raw_output_excerpt, created_at
        ) VALUES(?, ?, ?, 'UNKNOWN', ?, '[]', '[]', '', '[]', ?, '[]', '[]', NULL, NULL, '', ?)`).run(
          resultId, task.id, run.id, 'Host restarted while Run was active; workspace outcome requires inspection',
          json(['Do not replay until workspace and provider outcome are checked']), at,
        );
        this.store.db.prepare(`UPDATE task_runs SET status='UNKNOWN', terminal_kind='UNKNOWN', terminal_payload_ref=?,
          error_code='HOST_RESTART', error_message='Host restarted while Run was active', ended_at=?, heartbeat_at=?, watchdog_state='TERMINAL' WHERE id=?`).run(resultId, at, at, run.id);
        this.addRunEvent(run.id, run.status, 'UNKNOWN', { recoveredAfterHostRestart: true, resultId }, at);
        this.store.db.prepare(`UPDATE tasks SET status='WAITING', result_id=?, waiting_reason=?, waiting_on_ref=?, checkpoint_ref=?,
          version=version+1, updated_at=? WHERE id=?`).run(resultId, 'Run outcome unknown after Host restart', resultId, resultId, at, task.id);
        this.store.db.prepare("UPDATE agents SET status='WAITING', current_task_id=? WHERE id=?").run(task.id, run.agentId);
        this.store.db.prepare('DELETE FROM workspace_locks WHERE run_id=?').run(run.id);
        this.controlPlane.addTaskStateEvent({ taskId: task.id, fromStatus: task.status, toStatus: 'WAITING', actor: { type: 'pl', id: 'recovery' }, reason: 'active Run became UNKNOWN after Host restart', evidenceRefs: [resultId], at });
        this.controlPlane.activity({ operationId: `${run.id}:recovery`, projectId: project.id, eventType: 'TASK_RUN_RECOVERED_UNKNOWN', actor: { type: 'pl', id: 'recovery' }, objectRef: run.id, summary: 'Interrupted Run marked UNKNOWN; Task moved to WAITING without replay', at });
      });
    }
    return rows.length;
  }

  startWatchdog({ intervalMs = 30000, staleMs = 300000 } = {}) {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      try {
        const cutoff = Date.now() - staleMs;
        for (const run of this.store.db.prepare("SELECT id, heartbeat_at FROM task_runs WHERE status='RUNNING'").all()) {
          if (Date.parse(run.heartbeat_at) >= cutoff) continue;
          const observed = this.adapters.observeRun(run.id);
          const state = observed.state === 'RUNNING' || observed.state === 'CANCEL_REQUESTED' ? 'ACTIVE_NO_HEARTBEAT' : 'SUSPECTED_LOST';
          this.store.db.prepare('UPDATE task_runs SET watchdog_state=? WHERE id=?').run(state, run.id);
        }
      } catch (error) {
        this.logger.warn(`Task Run watchdog check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, intervalMs);
    this.watchdogTimer.unref?.();
  }

  async close() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.adapters.close();
    await Promise.allSettled(this.jobs.values());
  }
}
