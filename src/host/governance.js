import { CHARTER_IMPACT, ControlPlaneError, id, json, now, requireActor, requireString, requireStringArray } from '../shared/contracts.js';
import { diffWorkspace, snapshotWorkspaceAsync } from './workspace-diff.js';

function actorKey(actor) { return `${actor.type}:${actor.id}`; }

function enumValue(value, field, allowed) {
  const normalized = requireString(value, field, { max: 32 }).toUpperCase();
  if (!allowed.includes(normalized)) throw new ControlPlaneError('INVALID_INPUT', `${field} must be one of ${allowed.join(', ')}`);
  return normalized;
}

export class CollaborationGovernance {
  constructor({ store, controlPlane, adapters = null, logger = console, workspaceSnapshooter = snapshotWorkspaceAsync, workspaceDiffer = diffWorkspace }) {
    this.store = store;
    this.controlPlane = controlPlane;
    this.adapters = adapters;
    this.logger = logger;
    this.workspaceSnapshooter = workspaceSnapshooter;
    this.workspaceDiffer = workspaceDiffer;
    this.requestJobs = new Map();
    this.reviewJobs = new Map();
  }

  responsePrompt(project, request, recipient) {
    const charter = this.store.getCurrentCharter(project.id);
    const sourceResult = this.store.getResult(request.sourceResultId);
    return [
      'You are the addressed Agent answering one bounded collaboration Request at a terminal boundary.',
      'Do not modify files, create Tasks, delegate to another Agent, or expand scope. Answer only from the authoritative context and clearly say UNABLE_TO_ANSWER if evidence is insufficient.',
      'AUTHORITATIVE_STATE',
      JSON.stringify({
        project: { id: project.id, workspaceDir: project.workspaceDir },
        charter: { version: charter.version, mission: charter.mission, scope: charter.scope, constraints: charter.constraints },
        recipient: { id: recipient.id, role: recipient.role, permissions: recipient.permissions, skills: recipient.skills },
        request: { id: request.id, fromAgentId: request.fromAgentId, body: request.body, blocking: request.blocking },
        sourceResult: { id: sourceResult.id, outcome: sourceResult.outcome, changeSummary: sourceResult.changeSummary, artifacts: sourceResult.artifacts, unresolved: sourceResult.unresolved },
        approvedDecisions: this.store.listDecisions(project.id, 'APPROVED').slice(-12),
      }, null, 2),
      'End with AGENT_TEAM_RESPONSE_START, one JSON object, and AGENT_TEAM_RESPONSE_END.',
      JSON.stringify({ outcome: 'ANSWER | UNABLE_TO_ANSWER', body: 'concise bounded answer', evidenceRefs: [] }),
    ].join('\n\n');
  }

  parseResponseOutput(output) {
    const text = Array.isArray(output) ? output.filter((item) => item?.type === 'text').map((item) => item.text).join('\n') : '';
    const startMarker = 'AGENT_TEAM_RESPONSE_START';
    const endMarker = 'AGENT_TEAM_RESPONSE_END';
    const start = text.lastIndexOf(startMarker);
    const end = start < 0 ? -1 : text.indexOf(endMarker, start + startMarker.length);
    if (start < 0 || end < 0) throw new ControlPlaneError('RESPONSE_PARSE_FAILED', 'Response markers are missing', 409);
    let value;
    try { value = JSON.parse(text.slice(start + startMarker.length, end).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch (error) { throw new ControlPlaneError('RESPONSE_PARSE_FAILED', `Response JSON is invalid: ${error instanceof Error ? error.message : String(error)}`, 409); }
    return {
      outcome: enumValue(value.outcome, 'response.outcome', ['ANSWER', 'UNABLE_TO_ANSWER']),
      body: requireString(value.body, 'response.body', { max: 5000 }),
      evidenceRefs: requireStringArray(value.evidenceRefs ?? [], 'response.evidenceRefs', { max: 32, itemMax: 1000 }),
      raw: text.slice(-12000),
    };
  }

  reviewPrompt(project, task, result, reviewer) {
    const charter = this.store.getCurrentCharter(project.id);
    const evidence = this.store.listEvidence(project.id).filter((item) => item.resultId === result.id);
    return [
      'You are an independent Reviewer for one submitted Agent Team Task.',
      'Inspect the submitted Result, Host evidence, acceptance criteria, and workspace as needed. Do not modify files, create Tasks, delegate, or approve work without sufficient evidence.',
      'AUTHORITATIVE_REVIEW_STATE',
      JSON.stringify({
        project: { id: project.id, workspaceDir: project.workspaceDir },
        charter: { version: charter?.version, mission: charter?.mission, constraints: charter?.constraints },
        reviewer: { id: reviewer.id, role: reviewer.role },
        task: { id: task.id, title: task.title, goal: task.goal, scope: task.scope, acceptance: task.acceptance, controlLevel: task.controlLevel, reviewPolicy: task.reviewPolicy },
        result: { id: result.id, outcome: result.outcome, changeSummary: result.changeSummary, artifacts: result.artifacts, verifiedActions: result.verifiedActions, testPlan: result.testPlan, risks: result.risks, unresolved: result.unresolved },
        evidence,
      }, null, 2),
      'End with AGENT_TEAM_REVIEW_START, one JSON object, and AGENT_TEAM_REVIEW_END.',
      JSON.stringify({ decision: 'APPROVE | REJECT', issues: ['required concrete issue when rejecting'], evidenceRefs: ['at least one current Result evidence id'] }),
    ].join('\n\n');
  }

  parseReviewOutput(output, result) {
    const text = Array.isArray(output) ? output.filter((item) => item?.type === 'text').map((item) => item.text).join('\n') : '';
    const startMarker = 'AGENT_TEAM_REVIEW_START';
    const endMarker = 'AGENT_TEAM_REVIEW_END';
    const start = text.lastIndexOf(startMarker);
    const end = start < 0 ? -1 : text.indexOf(endMarker, start + startMarker.length);
    if (start < 0 || end < 0) throw new ControlPlaneError('REVIEW_PARSE_FAILED', 'Independent review markers are missing', 409);
    let value;
    try { value = JSON.parse(text.slice(start + startMarker.length, end).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch (error) { throw new ControlPlaneError('REVIEW_PARSE_FAILED', `Independent review JSON is invalid: ${error instanceof Error ? error.message : String(error)}`, 409); }
    const decision = enumValue(value.decision, 'review.decision', ['APPROVE', 'REJECT']);
    const issues = requireStringArray(value.issues ?? [], 'review.issues', { max: 32, itemMax: 2000 });
    const evidenceRefs = requireStringArray(value.evidenceRefs ?? [], 'review.evidenceRefs', { min: 1, max: 32, itemMax: 1000 });
    if (decision === 'REJECT' && issues.length === 0) throw new ControlPlaneError('REVIEW_ISSUES_REQUIRED', 'Independent Reviewer rejection requires at least one concrete issue', 409);
    const validEvidence = new Set(result.evidenceRefs);
    if (evidenceRefs.some((ref) => !validEvidence.has(ref))) {
      throw new ControlPlaneError('REVIEW_EVIDENCE_INVALID', 'Independent review referenced evidence outside the current Result', 409);
    }
    return { decision, issues, evidenceRefs, raw: text.slice(-20000) };
  }

  dispatchPendingRequests() {
    if (!this.adapters) return 0;
    let started = 0;
    const pending = this.store.db.prepare("SELECT id FROM requests WHERE status='PENDING' ORDER BY created_at").all();
    for (const row of pending) {
      const request = this.store.getRequest(row.id);
      const project = this.store.getProject(request.projectId);
      const sourceTask = this.store.getTask(request.sourceTaskId);
      if (project?.status !== 'ACTIVE' || sourceTask?.status !== 'WAITING' || sourceTask.waiting?.onRef !== request.id) {
        const at = now();
        this.store.transaction(() => {
          this.store.db.prepare("UPDATE requests SET status='REJECTED', resolved_at=? WHERE id=? AND status='PENDING'").run(at, request.id);
          this.controlPlane.activity({
            operationId: `${request.id}:dispatch-guard`, projectId: request.projectId, eventType: 'REQUEST_REJECTED',
            actor: { type: 'pl', id: 'request-guard' }, objectRef: request.id,
            summary: 'Stale collaboration Request rejected because its Project is inactive or source Task is no longer waiting', at,
          });
        });
        continue;
      }
      const recipient = this.store.listAgents(request.projectId).find((agent) => agent.id === request.toAgentId);
      if (!recipient || recipient.currentTaskId || recipient.status !== 'IDLE') continue;
      const descriptor = this.adapters.describe(recipient.providerKey);
      if (!descriptor.taskExecution || this.store.db.prepare('SELECT id FROM request_runs WHERE request_id=?').get(request.id)) continue;
      this.startRequestRunInternal(request, recipient);
      started += 1;
    }
    return started;
  }

  startRequestRunInternal(request, recipient) {
    const project = this.controlPlane.requireProject(request.projectId);
    const sourceTask = this.store.getTask(request.sourceTaskId);
    if (project.status !== 'ACTIVE' || sourceTask?.status !== 'WAITING' || sourceTask.waiting?.onRef !== request.id) {
      throw new ControlPlaneError('REQUEST_SOURCE_NOT_WAITING', 'Request Run requires an ACTIVE Project and its source Task waiting on this Request', 409);
    }
    const requestRunId = id('REQUEST-RUN');
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO request_runs(id, request_id, agent_id, provider_key, runtime_session_ref,
        status, terminal_kind, error_code, error_message, started_at, ended_at, created_at)
        VALUES(?, ?, ?, ?, NULL, 'STARTING', NULL, NULL, NULL, NULL, NULL, ?)`).run(requestRunId, request.id, recipient.id, recipient.providerKey, at);
      this.store.db.prepare("UPDATE requests SET status='IN_PROGRESS', started_at=? WHERE id=?").run(at, request.id);
      this.store.db.prepare("UPDATE agents SET status='RUNNING' WHERE id=? AND current_task_id IS NULL").run(recipient.id);
      this.controlPlane.activity({ operationId: `${requestRunId}:start`, projectId: project.id, eventType: 'REQUEST_RUN_STARTED', actor: { type: 'agent', id: recipient.id }, objectRef: requestRunId, summary: `Bounded one-shot response Run started for ${request.id}`, at });
    });
    const job = Promise.resolve().then(() => this.executeRequestRun({ requestRunId, request, recipient, project }))
      .catch((error) => this.logger.error(`Request Run ${requestRunId} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`))
      .finally(() => this.requestJobs.delete(requestRunId));
    this.requestJobs.set(requestRunId, job);
  }

  async executeRequestRun({ requestRunId, request, recipient, project }) {
    let timeout;
    let timedOut = false;
    try {
      const started = await this.adapters.startRun({
        runId: requestRunId, taskId: request.sourceTaskId, agentId: recipient.id,
        providerKey: recipient.providerKey, projectId: project.id, cwd: project.workspaceDir,
        label: `${request.id}-response`.slice(0, 100), prompt: this.responsePrompt(project, request, recipient),
      });
      const at = now();
      this.store.db.prepare("UPDATE request_runs SET status='RUNNING', runtime_session_ref=?, started_at=? WHERE id=?").run(started.runtimeRunId, at, requestRunId);
      timeout = setTimeout(() => { timedOut = true; this.adapters.cancelRun(requestRunId, 'Request response timeout'); }, 120000);
      const result = await this.adapters.collectRunResult(requestRunId);
      if (result.stopReason !== 'completed') {
        await this.finishRequestRunFailure({ requestRunId, request, recipient, status: timedOut ? 'TIMED_OUT' : result.stopReason === 'aborted' ? 'CANCELLED' : 'UNKNOWN', code: timedOut ? 'REQUEST_TIMEOUT' : 'REQUEST_RUNTIME_TERMINAL', message: `Runtime stop reason ${result.stopReason}${result.diagnostic ? `: ${result.diagnostic}` : ''}` });
        return;
      }
      const parsed = this.parseResponseOutput(result.output);
      const endedAt = now();
      this.store.db.prepare("UPDATE request_runs SET status='SUCCEEDED', terminal_kind=?, ended_at=? WHERE id=?").run(parsed.outcome, endedAt, requestRunId);
      this.store.db.prepare("UPDATE agents SET status='IDLE' WHERE id=? AND current_task_id IS NULL AND status='RUNNING'").run(recipient.id);
      this.respondRequest({ actor: { type: recipient.role === 'PROJECT_LEAD' ? 'pl' : 'agent', id: recipient.id }, operationId: `${requestRunId}:response`, requestId: request.id, outcome: parsed.outcome, body: parsed.body, evidenceRefs: parsed.evidenceRefs });
    } catch (error) {
      await this.finishRequestRunFailure({ requestRunId, request, recipient, status: 'UNKNOWN', code: 'REQUEST_RUNTIME_ERROR', message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.adapters.disposeRun(requestRunId);
    }
  }

  async finishRequestRunFailure({ requestRunId, request, recipient, status, code, message }) {
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE request_runs SET status=?, terminal_kind=?, error_code=?, error_message=?, ended_at=? WHERE id=?').run(status, status, code, message, at, requestRunId);
      this.store.db.prepare("UPDATE requests SET status='PENDING', started_at=NULL WHERE id=? AND status='IN_PROGRESS'").run(request.id);
      this.store.db.prepare("UPDATE agents SET status='IDLE' WHERE id=? AND current_task_id IS NULL AND status='RUNNING'").run(recipient.id);
      this.controlPlane.activity({ operationId: `${requestRunId}:failure`, projectId: request.projectId, eventType: 'REQUEST_RUN_FAILED', actor: { type: 'agent', id: recipient.id }, objectRef: requestRunId, summary: `${status}: ${message}; Request remains queued for explicit handling`, at });
    });
  }

  async close() {
    for (const runId of this.requestJobs.keys()) this.adapters?.cancelRun(runId, 'Host shutdown');
    for (const runId of this.reviewJobs.keys()) this.adapters?.cancelRun(runId, 'Host shutdown');
    await Promise.allSettled([...this.requestJobs.values(), ...this.reviewJobs.values()]);
  }

  recoverInterruptedRequestRuns() {
    const rows = this.store.db.prepare(`SELECT x.id, x.request_id, x.agent_id, r.project_id
      FROM request_runs x JOIN requests r ON r.id=x.request_id
      WHERE x.status IN ('STARTING','RUNNING')`).all();
    const at = now();
    for (const row of rows) {
      this.store.transaction(() => {
        this.store.db.prepare("UPDATE request_runs SET status='UNKNOWN', terminal_kind='UNKNOWN', error_code='HOST_RESTART', error_message='Host restarted while collaboration Request processing was active', ended_at=? WHERE id=? AND status IN ('STARTING','RUNNING')").run(at, row.id);
        this.store.db.prepare("UPDATE requests SET status='PENDING', started_at=NULL WHERE id=? AND status='IN_PROGRESS'").run(row.request_id);
        this.store.db.prepare("UPDATE agents SET status='IDLE' WHERE id=? AND current_task_id IS NULL AND status='RUNNING'").run(row.agent_id);
        this.controlPlane.activity({ operationId: `${row.id}:host-restart`, projectId: row.project_id, eventType: 'REQUEST_RUN_RECOVERED', actor: { type: 'agent', id: row.agent_id }, objectRef: row.id, summary: 'Interrupted collaboration Request Run marked UNKNOWN; Request returned to explicit handling without automatic replay', at });
      });
    }
    return rows.length;
  }

  recoverInterruptedReviewRuns() {
    const rows = this.store.db.prepare("SELECT id, reviewer_agent_id, task_id FROM review_runs WHERE status IN ('STARTING','RUNNING')").all();
    const at = now();
    for (const row of rows) {
      const task = this.store.getTask(row.task_id);
      if (!task) continue;
      this.store.transaction(() => {
        this.store.db.prepare("UPDATE review_runs SET status='UNKNOWN', error_code='HOST_RESTART', error_message='Host restarted while independent review was active', ended_at=? WHERE id=?").run(at, row.id);
        this.store.db.prepare("UPDATE agents SET status='IDLE' WHERE id=? AND current_task_id IS NULL AND status='RUNNING'").run(row.reviewer_agent_id);
        this.controlPlane.activity({ operationId: `${row.id}:host-restart`, projectId: task.projectId, eventType: 'REVIEW_RUN_RECOVERED', actor: { type: 'agent', id: row.reviewer_agent_id }, objectRef: row.id, summary: 'Interrupted independent Review Run marked UNKNOWN; explicit retry is required', at });
      });
    }
    return rows.length;
  }

  requestWouldCycle(projectId, fromAgentId, toAgentId) {
    const rows = this.store.db.prepare(`SELECT from_agent_id, to_agent_id FROM requests
      WHERE project_id=? AND status IN ('PENDING','IN_PROGRESS')`).all(projectId);
    const graph = new Map();
    for (const row of rows) {
      if (!graph.has(row.from_agent_id)) graph.set(row.from_agent_id, []);
      graph.get(row.from_agent_id).push(row.to_agent_id);
    }
    if (!graph.has(fromAgentId)) graph.set(fromAgentId, []);
    graph.get(fromAgentId).push(toAgentId);
    const stack = [toAgentId];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (current === fromAgentId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(graph.get(current) ?? []));
    }
    return false;
  }

  createRequest({ project, task, resultId, fromAgent, proposal }) {
    if (project.status !== 'ACTIVE') throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'collaboration Requests require an ACTIVE project', 409);
    if (!fromAgent.permissions.includes('request:create')) throw new ControlPlaneError('FORBIDDEN', 'Agent lacks request:create', 403);
    if (task.status !== 'WAITING') throw new ControlPlaneError('REQUEST_SOURCE_NOT_WAITING', 'Request may only be created at a NEEDS_INPUT terminal boundary', 409);
    const sourceResult = this.store.getResult(resultId);
    if (!sourceResult || sourceResult.taskId !== task.id || sourceResult.outcome !== 'NEEDS_INPUT') {
      throw new ControlPlaneError('REQUEST_SOURCE_INVALID', 'Request requires the Task NEEDS_INPUT Result', 409);
    }
    const target = this.controlPlane.requireProjectAgent(project, proposal.toAgentId);
    if (target.id === fromAgent.id) throw new ControlPlaneError('REQUEST_SELF_TARGET', 'Agent cannot request itself', 409);
    const body = requireString(proposal.body, 'request.body', { max: 5000 });
    const evidenceRefs = requireStringArray(proposal.evidenceRefs ?? [], 'request.evidenceRefs', { max: 32, itemMax: 1000 });
    const total = this.store.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE source_task_id=?').get(task.id).n;
    if (total >= 3) throw new ControlPlaneError('REQUEST_BUDGET_EXCEEDED', 'Task has used its 3-request budget', 409);
    const open = this.store.db.prepare("SELECT id FROM requests WHERE source_task_id=? AND status IN ('PENDING','IN_PROGRESS')").get(task.id);
    if (open) throw new ControlPlaneError('REQUEST_ALREADY_OPEN', `Task already waits on ${open.id}`, 409);
    const mailbox = this.store.db.prepare("SELECT COUNT(*) AS n FROM requests WHERE to_agent_id=? AND status IN ('PENDING','IN_PROGRESS')").get(target.id).n;
    if (mailbox >= 3) throw new ControlPlaneError('MAILBOX_FULL', 'Recipient mailbox already has 3 pending requests', 409);
    if (this.requestWouldCycle(project.id, fromAgent.id, target.id)) throw new ControlPlaneError('REQUEST_CYCLE', 'Request would form a direct or indirect wait cycle', 409);
    const requestId = id('REQUEST');
    const at = now();
    const deadlineAt = new Date(Date.parse(at) + 15 * 60 * 1000).toISOString();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO requests(
        id, project_id, source_task_id, source_result_id, from_agent_id, to_agent_id, body, blocking,
        status, response_id, deadline_at, created_at, started_at, resolved_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, NULL, NULL)`).run(
        requestId, project.id, task.id, resultId, fromAgent.id, target.id, body, proposal.blocking ? 1 : 0, deadlineAt, at,
      );
      this.store.db.prepare(`UPDATE tasks SET waiting_reason=?, waiting_on_ref=?, checkpoint_ref=?, waiting_deadline=?,
        version=version+1, updated_at=? WHERE id=?`).run(`Waiting for ${target.id}: ${body}`, requestId, resultId, deadlineAt, at, task.id);
      this.controlPlane.activity({ operationId: `${requestId}:created`, projectId: project.id, eventType: 'REQUEST_CREATED', actor: { type: 'agent', id: fromAgent.id }, objectRef: requestId, summary: `${fromAgent.id} requested ${target.id}; mailbox delivery is deferred while recipient is busy`, at });
    });
    return requestId;
  }

  processTerminalResult({ project, task, agent, resultId, parsed }) {
    for (let index = 0; index < parsed.findings.length; index += 1) {
      this.createFindingInternal({ project, task, agent, description: parsed.findings[index], evidenceRefs: parsed.evidenceRefs, severity: 'MEDIUM', operationId: `${resultId}:finding:${index}`, deduplicate: true });
    }
    if (parsed.terminalKind === 'NEEDS_INPUT' && parsed.requestProposal) {
      try {
        this.createRequest({ project, task: this.store.getTask(task.id), resultId, fromAgent: agent, proposal: parsed.requestProposal });
        queueMicrotask(() => {
          try { this.dispatchPendingRequests(); }
          catch (error) { this.logger.warn(`Request dispatch failed: ${error instanceof Error ? error.message : String(error)}`); }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const at = now();
        this.store.transaction(() => {
          this.store.db.prepare(`UPDATE tasks SET waiting_reason=?, waiting_on_ref=?, waiting_deadline=NULL,
            version=version+1, updated_at=? WHERE id=?`).run(`Request rejected: ${message}`, resultId, at, task.id);
          this.controlPlane.activity({ operationId: `${resultId}:request-rejected`, projectId: project.id, eventType: 'REQUEST_REJECTED', actor: { type: 'agent', id: agent.id }, objectRef: resultId, summary: message, at });
        });
      }
    }
    if (parsed.terminalKind === 'SUCCESS') this.tryAutoVerify(project.id, task.id, resultId);
  }

  tryAutoVerify(projectId, taskId, resultId) {
    const task = this.store.getTask(taskId);
    const result = this.store.getResult(resultId);
    if (!task || task.status !== 'SUBMITTED' || task.controlLevel !== 'ROUTINE' || task.reviewPolicy !== 'AUTO' || result?.outcome !== 'SUCCESS') return false;
    const evidence = this.store.db.prepare('SELECT kind, status FROM evidence WHERE result_id=?').all(resultId);
    const sufficient = evidence.some((item) => item.kind === 'COMMAND' && item.status === 'VERIFIED')
      && evidence.filter((item) => item.kind === 'FILE').every((item) => item.status === 'VERIFIED')
      && !evidence.some((item) => item.status === 'FAILED');
    if (!sufficient) return false;
    const at = now();
    this.store.transaction(() => {
      const reviewId = id('REVIEW');
      this.store.db.prepare(`INSERT INTO reviews(id, task_id, result_id, reviewer_agent_id, reviewer_role, decision,
        issues_json, evidence_refs_json, created_at) VALUES(?, ?, ?, NULL, 'AUTO', 'APPROVE', '[]', ?, ?)`).run(
        reviewId, task.id, resultId, json(result.evidenceRefs), at,
      );
      this.verifyTask({ projectId, task, reviewId, actor: { type: 'pl', id: 'automatic-verifier' }, evidenceRefs: result.evidenceRefs, at });
      this.controlPlane.activity({ operationId: `${reviewId}:auto`, projectId, eventType: 'TASK_AUTO_VERIFIED', actor: { type: 'pl', id: 'automatic-verifier' }, objectRef: task.id, summary: 'ROUTINE Task automatically verified from complete Host evidence', at });
    });
    return true;
  }

  verifyTask({ projectId, task, reviewId, actor, evidenceRefs, at, riskAccepted = false }) {
    const project = this.controlPlane.requireProject(projectId);
    if (['STOPPED', 'COMPLETED'].includes(project.status)) {
      throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'Tasks cannot be VERIFIED in a stopped or completed Project', 409);
    }
    this.store.db.prepare(`UPDATE tasks SET status='VERIFIED', waiting_reason=NULL, waiting_on_ref=NULL,
      checkpoint_ref=NULL, waiting_deadline=NULL, version=version+1, updated_at=? WHERE id=?`).run(at, task.id);
    this.controlPlane.addTaskStateEvent({ taskId: task.id, fromStatus: task.status, toStatus: 'VERIFIED', actor, reason: riskAccepted ? `Approved by ${reviewId} with Human-accepted unverified risk` : `Approved by ${reviewId}`, evidenceRefs, at });
    this.controlPlane.refreshReadyTasks(projectId, at);
    this.maybeTriggerPlanCheck(projectId, 'VERIFIED_COUNT', at);
  }

  respondRequest(input) {
    const request = this.store.getRequest(requireString(input.requestId, 'requestId', { max: 128 }));
    if (!request) throw new ControlPlaneError('REQUEST_NOT_FOUND', 'Request does not exist', 404);
    if (!['PENDING', 'IN_PROGRESS'].includes(request.status)) throw new ControlPlaneError('REQUEST_NOT_OPEN', 'Request is no longer open', 409);
    const project = this.controlPlane.requireProject(request.projectId);
    const task = this.store.getTask(request.sourceTaskId);
    if (project.status !== 'ACTIVE') throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'Request responses require an ACTIVE project', 409);
    if (!task || task.status !== 'WAITING' || task.waiting?.onRef !== request.id) {
      throw new ControlPlaneError('REQUEST_SOURCE_NOT_WAITING', 'Request source Task is no longer waiting on this Request', 409);
    }
    const actor = requireActor(input.actor);
    if (!['agent', 'pl'].includes(actor.type) || actor.id !== request.toAgentId) throw new ControlPlaneError('FORBIDDEN', 'only the addressed Agent may respond', 403);
    const recipient = this.controlPlane.requireProjectAgent(project, request.toAgentId);
    if (['REPLACED', 'UNAVAILABLE'].includes(recipient.status)) throw new ControlPlaneError('RECEIVER_INACTIVE', `Request recipient ${recipient.id} is ${recipient.status}`, 409);
    if (recipient.currentTaskId && recipient.currentTaskId !== request.sourceTaskId) throw new ControlPlaneError('RECEIVER_BUSY', 'Request remains queued until recipient finishes its formal Task', 409);
    const outcome = enumValue(input.outcome, 'outcome', ['ANSWER', 'UNABLE_TO_ANSWER']);
    const body = requireString(input.body, 'body', { max: 5000 });
    const evidenceRefs = requireStringArray(input.evidenceRefs ?? [], 'evidenceRefs', { max: 32, itemMax: 1000 });
    const operationId = this.controlPlane.assertNewOperation(input.operationId);
    const responseId = id('RESPONSE');
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO responses(id, request_id, from_agent_id, outcome, body, evidence_refs_json, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?)`).run(responseId, request.id, recipient.id, outcome, body, json(evidenceRefs), at);
      this.store.db.prepare("UPDATE requests SET status='RESOLVED', response_id=?, resolved_at=? WHERE id=?").run(responseId, at, request.id);
      this.store.db.prepare(`UPDATE tasks SET status='READY', waiting_reason=NULL, waiting_on_ref=NULL, waiting_deadline=NULL,
        version=version+1, updated_at=? WHERE id=?`).run(at, task.id);
      this.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=? WHERE id=?").run(task.id, request.fromAgentId);
      this.controlPlane.addTaskStateEvent({ taskId: task.id, fromStatus: task.status, toStatus: 'READY', actor, reason: `Request ${request.id} resolved as ${outcome}`, evidenceRefs, at });
      this.controlPlane.activity({ operationId, projectId: project.id, eventType: 'REQUEST_RESOLVED', actor, objectRef: request.id, summary: `${outcome}; source Task returned to READY for a new one-shot Run`, at });
    });
    return (input.responseView === 'overview' ? this.store.getProjectOverview(project.id) : this.store.snapshot(project.id));
  }

  timeoutExpiredRequests(at = now()) {
    const rows = this.store.db.prepare("SELECT id FROM requests WHERE status IN ('PENDING','IN_PROGRESS') AND deadline_at<=?").all(at);
    for (const row of rows) {
      const request = this.store.getRequest(row.id);
      const task = this.store.getTask(request.sourceTaskId);
      const project = this.store.getProject(request.projectId);
      if (project?.status !== 'ACTIVE' || task?.status !== 'WAITING' || task.waiting?.onRef !== request.id) {
        this.store.db.prepare("UPDATE requests SET status='REJECTED', resolved_at=? WHERE id=? AND status IN ('PENDING','IN_PROGRESS')").run(at, request.id);
        continue;
      }
      const responseId = id('RESPONSE');
      this.store.transaction(() => {
        this.store.db.prepare(`INSERT INTO responses(id, request_id, from_agent_id, outcome, body, evidence_refs_json, created_at)
          VALUES(?, ?, ?, 'REQUEST_TIMEOUT', 'Request deadline elapsed before a response was available', '[]', ?)`).run(responseId, request.id, request.toAgentId, at);
        this.store.db.prepare("UPDATE requests SET status='TIMED_OUT', response_id=?, resolved_at=? WHERE id=?").run(responseId, at, request.id);
        this.store.db.prepare("UPDATE tasks SET status='READY', waiting_reason=NULL, waiting_on_ref=NULL, waiting_deadline=NULL, version=version+1, updated_at=? WHERE id=?").run(at, task.id);
        this.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=? WHERE id=?").run(task.id, request.fromAgentId);
        this.controlPlane.addTaskStateEvent({ taskId: task.id, fromStatus: task.status, toStatus: 'READY', actor: { type: 'pl', id: 'request-timeout' }, reason: `Request ${request.id} timed out`, evidenceRefs: [responseId], at });
        this.controlPlane.activity({ operationId: `${request.id}:timeout`, projectId: request.projectId, eventType: 'REQUEST_TIMED_OUT', actor: { type: 'pl', id: 'request-timeout' }, objectRef: request.id, summary: 'Timeout response returned to source Task; no automatic re-request', at });
      });
    }
    return rows.length;
  }

  submitReview(input) {
    const task = this.store.getTask(requireString(input.taskId, 'taskId', { max: 128 }));
    if (!task) throw new ControlPlaneError('TASK_NOT_FOUND', 'Task does not exist', 404);
    const project = this.controlPlane.requireProject(task.projectId);
    // R3.2: a late review decision must not revive a Task in a stopped or
    // completed Project.
    if (project.status !== 'ACTIVE') throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'Task review requires an ACTIVE Project', 409);
    if (task.status !== 'SUBMITTED' || !task.resultId) throw new ControlPlaneError('TASK_NOT_SUBMITTED', 'Review requires a submitted Task Result', 409);
    const actor = requireActor(input.actor);
    const decision = enumValue(input.decision, 'decision', ['APPROVE', 'REJECT']);
    const issues = requireStringArray(input.issues ?? [], 'issues', { max: 32, itemMax: 2000 });
    const evidenceRefs = requireStringArray(input.evidenceRefs ?? [], 'evidenceRefs', { min: 1, max: 32, itemMax: 1000 });
    if (decision === 'REJECT' && issues.length === 0) throw new ControlPlaneError('REVIEW_ISSUES_REQUIRED', 'Reject review requires at least one concrete issue', 409);
    const result = this.store.getResult(task.resultId);
    if (!result) throw new ControlPlaneError('RESULT_NOT_FOUND', 'Submitted Result is missing', 409);
    // R2.2: review evidence references must exist and belong to the CURRENT Result.
    const validEvidence = new Set(result.evidenceRefs);
    if (evidenceRefs.some((ref) => !validEvidence.has(ref))) {
      throw new ControlPlaneError('REVIEW_EVIDENCE_INVALID', 'Review referenced evidence outside the current Result', 409);
    }
    let reviewerRole;
    let reviewerAgentId = null;
    if (actor.type === 'agent') {
      const reviewer = this.controlPlane.requireProjectAgent(project, actor.id);
      if (reviewer.role !== 'REVIEWER' || !reviewer.permissions.includes('review:submit')) throw new ControlPlaneError('FORBIDDEN', 'Agent is not an authorized Reviewer', 403);
      if (reviewer.status !== 'IDLE' || reviewer.currentTaskId) throw new ControlPlaneError('REVIEWER_INACTIVE', `Reviewer ${reviewer.id} is ${reviewer.status} and cannot submit a review`, 409);
      if (reviewer.id === task.assignedAgentId) throw new ControlPlaneError('SELF_REVIEW_FORBIDDEN', 'Implementer cannot review its own Result', 403);
      reviewerRole = 'REVIEWER'; reviewerAgentId = reviewer.id;
    } else if ((actor.type === 'pl' && actor.id === project.leadAgentId) || (actor.type === 'human' && actor.id === project.ownerId)) {
      reviewerRole = 'PL'; reviewerAgentId = project.leadAgentId;
    } else throw new ControlPlaneError('FORBIDDEN', 'Actor may not review this Task', 403);
    if (task.reviewPolicy === 'REVIEWER_PL' && reviewerRole === 'PL') {
      const reviewerApproval = this.store.db.prepare("SELECT id FROM reviews WHERE task_id=? AND result_id=? AND reviewer_role='REVIEWER' AND decision='APPROVE' ORDER BY created_at DESC LIMIT 1").get(task.id, task.resultId);
      if (!reviewerApproval) throw new ControlPlaneError('REVIEWER_APPROVAL_REQUIRED', 'Independent Reviewer approval is required before PL decision', 409);
    }
    if (task.reviewPolicy !== 'REVIEWER_PL' && reviewerRole === 'REVIEWER') throw new ControlPlaneError('PL_REVIEW_REQUIRED', 'This Task is routed to PL review', 409);
    // R2.2/O2: a SUCCESS label alone is insufficient; require the current
    // Result's referenced, verified Host command evidence as in auto-verify.
    const resultEvidence = this.store.listEvidence(task.projectId).filter((item) => item.resultId === result.id);
    const evidenceById = new Map(resultEvidence.map((item) => [item.id, item]));
    const missingEvidence = result.evidenceRefs.some((ref) => !evidenceById.has(ref));
    const verifiedCommand = result.evidenceRefs.some((ref) => {
      const item = evidenceById.get(ref);
      return item?.kind === 'COMMAND' && item.status === 'VERIFIED';
    });
    const failedEvidence = resultEvidence.some((item) => item.status === 'FAILED' || (item.kind === 'FILE' && item.status !== 'VERIFIED'));
    const hostVerificationIncomplete = result.outcome !== 'SUCCESS' || missingEvidence || !verifiedCommand || failedEvidence;
    let riskAccepted = false;
    if (decision === 'APPROVE' && hostVerificationIncomplete) {
      riskAccepted = actor.type === 'human' && actor.id === project.ownerId && input.acceptRisk === true;
      if (!riskAccepted) {
        throw new ControlPlaneError('VERIFICATION_INCOMPLETE', 'Host verification is incomplete (PARTIAL outcome, missing verified COMMAND evidence, missing or FAILED evidence); only the Human Owner may explicitly accept this risk', 409);
      }
    }
    const operationId = this.controlPlane.assertNewOperation(input.operationId);
    const reviewId = id('REVIEW');
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO reviews(id, task_id, result_id, reviewer_agent_id, reviewer_role, decision,
        issues_json, evidence_refs_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        reviewId, task.id, task.resultId, reviewerAgentId, reviewerRole, decision, json(issues), json(evidenceRefs), at,
      );
      const finalApprove = decision === 'APPROVE' && (reviewerRole === 'PL' || task.reviewPolicy !== 'REVIEWER_PL');
      if (finalApprove) this.verifyTask({ projectId: project.id, task, reviewId, actor, evidenceRefs, at, riskAccepted });
      if (decision === 'REJECT') this.returnForRework({ project, task, reviewId, actor, issues, evidenceRefs, at });
      this.controlPlane.activity({ operationId, projectId: project.id, eventType: `REVIEW_${decision}`, actor, objectRef: reviewId, summary: `${reviewerRole} ${decision}${finalApprove ? (riskAccepted ? '; Task VERIFIED with Human-accepted unverified risk' : '; Task VERIFIED') : decision === 'REJECT' ? '; Task returned for rework' : '; awaiting PL'}`, at });
    });
    return (input.responseView === 'overview' ? this.store.getProjectOverview(project.id) : this.store.snapshot(project.id));
  }

  requestIndependentReview(input) {
    if (!this.adapters) throw new ControlPlaneError('REVIEW_RUNTIME_UNAVAILABLE', 'No runtime adapter is available for independent review', 409);
    const task = this.store.getTask(requireString(input.taskId, 'taskId', { max: 128 }));
    if (!task) throw new ControlPlaneError('TASK_NOT_FOUND', 'Task does not exist', 404);
    const project = this.controlPlane.requireProject(task.projectId);
    if (project.status !== 'ACTIVE') throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'Independent review requires an ACTIVE project', 409);
    const actor = requireActor(input.actor);
    const permitted = (actor.type === 'pl' && actor.id === project.leadAgentId)
      || (actor.type === 'human' && actor.id === project.ownerId);
    if (!permitted) throw new ControlPlaneError('FORBIDDEN', 'only the Human Owner or assigned PL may request independent review', 403);
    if (task.status !== 'SUBMITTED' || !task.resultId) throw new ControlPlaneError('TASK_NOT_SUBMITTED', 'Independent review requires a submitted Task Result', 409);
    if (task.reviewPolicy !== 'REVIEWER_PL') throw new ControlPlaneError('INDEPENDENT_REVIEW_NOT_REQUIRED', 'This Task does not use REVIEWER_PL policy', 409);
    const result = this.store.getResult(task.resultId);
    if (!result) throw new ControlPlaneError('RESULT_NOT_FOUND', 'Submitted Result is missing', 409);
    const existingReview = this.store.db.prepare("SELECT id FROM reviews WHERE task_id=? AND result_id=? AND reviewer_role='REVIEWER' ORDER BY created_at DESC LIMIT 1").get(task.id, result.id);
    if (existingReview) throw new ControlPlaneError('REVIEW_ALREADY_SUBMITTED', 'The current Result already has an independent Reviewer decision', 409);
    const activeRun = this.store.db.prepare("SELECT id FROM review_runs WHERE task_id=? AND result_id=? AND status IN ('STARTING','RUNNING')").get(task.id, result.id);
    if (activeRun) throw new ControlPlaneError('REVIEW_RUN_ALREADY_ACTIVE', `Independent review Run ${activeRun.id} is already active`, 409);
    const reviewer = this.store.listAgents(project.id).find((agent) => agent.role === 'REVIEWER' && agent.status === 'IDLE' && !agent.currentTaskId);
    if (!reviewer) throw new ControlPlaneError('REVIEWER_UNAVAILABLE', 'No current idle Reviewer Agent is available', 409);
    const available = this.adapters.listAvailableRuntimes().filter((item) => item.taskExecution && item.availability === 'AVAILABLE' && item.authorized);
    const runtime = available.find((item) => item.providerKey === reviewer.providerKey)
      ?? available.find((item) => item.providerKey === 'subagent:spawn')
      ?? available[0];
    if (!runtime) throw new ControlPlaneError('REVIEW_RUNTIME_UNAVAILABLE', 'No authorized one-shot runtime can execute an independent review', 409);
    // R2.3: never let a Reviewer inspect the same workspace while a Worker write
    // Run is active — it could read half-written state.
    const activeWrite = this.store.db.prepare('SELECT run_id FROM workspace_locks WHERE workspace_ref=?').get(project.workspaceDir);
    if (activeWrite) throw new ControlPlaneError('WORKSPACE_BUSY', `workspace has active write Run ${activeWrite.run_id}; independent review requires a stable snapshot`, 409);
    this.adapters.prepareWorkspace(project.workspaceDir, { create: false });
    this.adapters.assertCanStart({ providerKey: runtime.providerKey, projectId: project.id, parentAgent: input.parentAgent });
    const operationId = this.controlPlane.assertNewOperation(input.operationId);
    const reviewRunId = id('REVIEW-RUN');
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO review_runs(id, task_id, result_id, reviewer_agent_id, provider_key,
        runtime_session_ref, status, decision, error_code, error_message, raw_output_excerpt, started_at, ended_at, created_at)
        VALUES(?, ?, ?, ?, ?, NULL, 'STARTING', NULL, NULL, NULL, NULL, NULL, NULL, ?)`).run(
        reviewRunId, task.id, result.id, reviewer.id, runtime.providerKey, at,
      );
      this.store.db.prepare("UPDATE agents SET status='RUNNING' WHERE id=?").run(reviewer.id);
      this.controlPlane.activity({ operationId, projectId: project.id, eventType: 'REVIEW_RUN_CREATED', actor, objectRef: reviewRunId, summary: `Independent Reviewer ${reviewer.id} queued on ${runtime.providerKey} for ${task.id}`, at });
    });
    const job = Promise.resolve().then(() => this.executeReviewRun({ reviewRunId, project, task, result, reviewer, runtime, parentAgent: input.parentAgent }))
      .catch((error) => this.logger.error(`Review Run ${reviewRunId} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`))
      .finally(() => this.reviewJobs.delete(reviewRunId));
    this.reviewJobs.set(reviewRunId, job);
    return (input.responseView === 'overview' ? this.store.getProjectOverview(project.id) : this.store.snapshot(project.id));
  }

  async executeReviewRun({ reviewRunId, project, task, result, reviewer, runtime, parentAgent }) {
    let timeout;
    let timedOut = false;
    let runtimeStarted = false;
    // R2.3: capture a baseline so unexpected Reviewer workspace writes can be
    // detected after the Run. This is a post-hoc check and does NOT claim to
    // enforce strong isolation — only to flag and refuse accidental mutation.
    let baseline;
    try {
      baseline = await this.workspaceSnapshooter(project.workspaceDir);
      const started = await this.adapters.startRun({
        runId: reviewRunId, taskId: task.id, agentId: reviewer.id, providerKey: runtime.providerKey,
        projectId: project.id, parentAgent, cwd: project.workspaceDir,
        label: `${task.id}-independent-review`.slice(0, 100), prompt: this.reviewPrompt(project, task, result, reviewer),
      });
      runtimeStarted = true;
      const startedAt = now();
      this.store.db.prepare("UPDATE review_runs SET status='RUNNING', runtime_session_ref=?, started_at=? WHERE id=?").run(started.runtimeRunId, startedAt, reviewRunId);
      timeout = setTimeout(() => { timedOut = true; this.adapters.cancelRun(reviewRunId, 'Independent review timeout'); }, 180000);
      const runtimeResult = await this.adapters.collectRunResult(reviewRunId);
      if (runtimeResult.stopReason !== 'completed') {
        const status = timedOut ? 'TIMED_OUT' : runtimeResult.stopReason === 'aborted' ? 'CANCELLED' : 'UNKNOWN';
        await this.finishReviewRunFailure({ reviewRunId, project, reviewer, status, code: timedOut ? 'REVIEW_TIMEOUT' : 'REVIEW_RUNTIME_TERMINAL', message: `Runtime stop reason ${runtimeResult.stopReason}${runtimeResult.diagnostic ? `: ${runtimeResult.diagnostic}` : ''}` });
        return;
      }
      const workspaceWrites = await this.detectReviewerWrites(project, baseline);
      if (workspaceWrites) {
        await this.finishReviewRunFailure({ reviewRunId, project, reviewer, status: 'FAILED', code: 'REVIEW_WRITE_DETECTED', message: `Reviewer modified the workspace: ${workspaceWrites.join(', ')}` });
        return;
      }
      const parsed = this.parseReviewOutput(runtimeResult.output, result);
      // R3.2: the Project may have been stopped/completed while this Review Run
      // was executing. A late decision must not revive the Task; mark the Run
      // ABANDONED and leave Task state untouched.
      const currentProject = this.controlPlane.requireProject(project.id);
      if (currentProject.status !== 'ACTIVE') {
        const endedAt = now();
        this.store.transaction(() => {
          this.store.db.prepare("UPDATE agents SET status='IDLE' WHERE id=? AND current_task_id IS NULL").run(reviewer.id);
          this.store.db.prepare("UPDATE review_runs SET status='ABANDONED', raw_output_excerpt=?, ended_at=? WHERE id=?").run(parsed.raw, endedAt, reviewRunId);
          this.controlPlane.activity({ operationId: `${reviewRunId}:abandoned`, projectId: project.id, eventType: 'REVIEW_RUN_ABANDONED', actor: { type: 'agent', id: reviewer.id }, objectRef: reviewRunId, summary: `Independent Review result discarded because the Project is ${currentProject.status}`, at: endedAt });
        });
        return;
      }
      this.store.db.prepare("UPDATE agents SET status='IDLE' WHERE id=? AND current_task_id IS NULL").run(reviewer.id);
      this.submitReview({
        actor: { type: 'agent', id: reviewer.id }, operationId: `${reviewRunId}:submit`, taskId: task.id,
        decision: parsed.decision, issues: parsed.issues, evidenceRefs: parsed.evidenceRefs,
      });
      const endedAt = now();
      this.store.transaction(() => {
        this.store.db.prepare("UPDATE review_runs SET status='SUCCEEDED', decision=?, raw_output_excerpt=?, ended_at=? WHERE id=?").run(parsed.decision, parsed.raw, endedAt, reviewRunId);
        this.controlPlane.activity({ operationId: `${reviewRunId}:terminal`, projectId: project.id, eventType: 'REVIEW_RUN_TERMINAL', actor: { type: 'agent', id: reviewer.id }, objectRef: reviewRunId, summary: `Independent Reviewer submitted ${parsed.decision} for ${task.id}`, at: endedAt });
      });
    } catch (error) {
      await this.finishReviewRunFailure({
        reviewRunId, project, reviewer, status: runtimeStarted ? 'UNKNOWN' : 'CANNOT_START',
        code: error instanceof ControlPlaneError ? error.code : runtimeStarted ? 'REVIEW_RUNTIME_ERROR' : 'REVIEW_RUNTIME_START_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.adapters.disposeRun(reviewRunId);
    }
  }

  // R2.3: post-hoc detection of unexpected Reviewer writes. Returns null only
  // when unchanged; an unreadable workspace is a hard review failure.
  async detectReviewerWrites(project, baseline) {
    if (!baseline) throw new ControlPlaneError('REVIEW_BASELINE_MISSING', 'Reviewer workspace baseline is missing', 409);
    const after = await this.workspaceSnapshooter(project.workspaceDir);
    const diff = this.workspaceDiffer(baseline, after);
    const writes = [...diff.added, ...diff.modified, ...diff.deleted];
    return writes.length > 0 ? writes : null;
  }

  async finishReviewRunFailure({ reviewRunId, project, reviewer, status, code, message }) {
    const current = this.store.db.prepare('SELECT status FROM review_runs WHERE id=?').get(reviewRunId);
    if (!current || !['STARTING', 'RUNNING'].includes(current.status)) return;
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE review_runs SET status=?, error_code=?, error_message=?, ended_at=? WHERE id=?').run(status, code, message, at, reviewRunId);
      this.store.db.prepare("UPDATE agents SET status='IDLE' WHERE id=? AND current_task_id IS NULL").run(reviewer.id);
      this.controlPlane.activity({ operationId: `${reviewRunId}:failure`, projectId: project.id, eventType: 'REVIEW_RUN_FAILED', actor: { type: 'agent', id: reviewer.id }, objectRef: reviewRunId, summary: `${status}: ${code}: ${message}`, at });
    });
  }

  returnForRework({ project, task, reviewId, actor, issues, evidenceRefs, at }) {
    if (['STOPPED', 'COMPLETED'].includes(project.status)) {
      throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'Tasks cannot be returned for rework in a stopped or completed Project', 409);
    }
    let assignedAgentId = task.assignedAgentId;
    if (assignedAgentId) {
      const agent = this.controlPlane.requireProjectAgent(project, assignedAgentId);
      if (agent.currentTaskId && agent.currentTaskId !== task.id) assignedAgentId = null;
      else this.store.db.prepare("UPDATE agents SET current_task_id=?, status='IDLE' WHERE id=?").run(task.id, agent.id);
    }
    this.store.db.prepare(`UPDATE tasks SET status='READY', assigned_agent_id=?, waiting_reason=?, waiting_on_ref=?, checkpoint_ref=?,
      version=version+1, updated_at=? WHERE id=?`).run(assignedAgentId, `Review rejected: ${issues.join('; ')}`, reviewId, task.resultId, at, task.id);
    this.controlPlane.addTaskStateEvent({ taskId: task.id, fromStatus: task.status, toStatus: 'READY', actor, reason: `Rejected by ${reviewId}: ${issues.join('; ')}`, evidenceRefs, at });
  }

  createFindingInternal({ project, task, agent, description, evidenceRefs, severity, operationId, deduplicate = false }) {
    const normalizedDescription = requireString(description, 'description', { max: 5000 });
    if (deduplicate) {
      const existing = this.store.db.prepare(`SELECT id FROM findings
        WHERE project_id=? AND discovered_in_task_id=? AND description=? AND status IN ('OPEN','LINKED_TO_TASK')
        ORDER BY created_at LIMIT 1`).get(project.id, task?.id ?? null, normalizedDescription);
      if (existing) return existing.id;
    }
    const findingId = id('FINDING');
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO findings(id, project_id, discovered_in_task_id, reported_by_agent_id, description,
        evidence_refs_json, severity, status, linked_fix_task_id, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, 'OPEN', NULL, ?, ?)`).run(
        findingId, project.id, task?.id ?? null, agent?.id ?? null, normalizedDescription,
        json(evidenceRefs ?? []), severity, at, at,
      );
      this.controlPlane.activity({ operationId, projectId: project.id, eventType: 'FINDING_OPENED', actor: agent ? { type: 'agent', id: agent.id } : { type: 'pl', id: project.leadAgentId }, objectRef: findingId, summary: `${severity} Finding opened`, at });
      if (['HIGH', 'CRITICAL'].includes(severity)) this.maybeTriggerPlanCheck(project.id, `FINDING_${severity}`, at);
    });
    return findingId;
  }

  reportFinding(input) {
    const project = this.controlPlane.requireProject(input.projectId);
    const actor = requireActor(input.actor);
    const agent = actor.type === 'agent' ? this.controlPlane.requireProjectAgent(project, actor.id) : null;
    if (agent && !agent.permissions.includes('finding:report')) throw new ControlPlaneError('FORBIDDEN', 'Agent lacks finding:report', 403);
    if (!agent && !((actor.type === 'pl' && actor.id === project.leadAgentId) || (actor.type === 'human' && actor.id === project.ownerId))) throw new ControlPlaneError('FORBIDDEN', 'Actor may not report Finding', 403);
    const task = input.taskId ? this.controlPlane.requireTask(project, input.taskId) : null;
    const operationId = this.controlPlane.assertNewOperation(input.operationId);
    this.createFindingInternal({ project, task, agent, description: input.description, evidenceRefs: requireStringArray(input.evidenceRefs ?? [], 'evidenceRefs', { max: 32 }), severity: enumValue(input.severity, 'severity', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']), operationId });
    return (input.responseView === 'overview' ? this.store.getProjectOverview(project.id) : this.store.snapshot(project.id));
  }

  updateFinding(input) {
    const row = this.store.db.prepare('SELECT * FROM findings WHERE id=?').get(requireString(input.findingId, 'findingId', { max: 128 }));
    if (!row) throw new ControlPlaneError('FINDING_NOT_FOUND', 'Finding does not exist', 404);
    const project = this.controlPlane.requireProject(row.project_id);
    const actor = requireActor(input.actor);
    if (!((actor.type === 'pl' && actor.id === project.leadAgentId) || (actor.type === 'human' && actor.id === project.ownerId))) throw new ControlPlaneError('FORBIDDEN', 'Only Human/PL may triage Findings', 403);
    const status = enumValue(input.status, 'status', ['LINKED_TO_TASK', 'CLOSED']);
    const linkedTaskId = status === 'LINKED_TO_TASK' ? this.controlPlane.requireTask(project, input.linkedFixTaskId).id : row.linked_fix_task_id;
    const operationId = this.controlPlane.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE findings SET status=?, linked_fix_task_id=?, updated_at=? WHERE id=?').run(status, linkedTaskId, at, row.id);
      this.controlPlane.activity({ operationId, projectId: project.id, eventType: 'FINDING_TRIAGED', actor, objectRef: row.id, summary: `Finding moved to ${status}`, at });
    });
    return (input.responseView === 'overview' ? this.store.getProjectOverview(project.id) : this.store.snapshot(project.id));
  }

  maybeTriggerPlanCheck(projectId, trigger, at = now()) {
    const project = this.controlPlane.requireProject(projectId);
    const verifiedCount = this.store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE project_id=? AND status='VERIFIED'").get(projectId).n;
    const countTrigger = trigger === 'VERIFIED_COUNT' && verifiedCount > 0 && verifiedCount % project.replanEveryN === 0;
    if (!countTrigger && !trigger.startsWith('FINDING_') && trigger !== 'CRITICAL_FAILURE' && trigger !== 'MILESTONE') return null;
    const pending = this.store.db.prepare("SELECT id FROM plan_checks WHERE project_id=? AND status='PENDING'").get(projectId);
    if (pending) return pending.id;
    const planCheckId = id('PLAN-CHECK');
    this.store.db.prepare(`INSERT INTO plan_checks(id, project_id, trigger, verified_count, status, decision, notes, actor_id, created_at, completed_at)
      VALUES(?, ?, ?, ?, 'PENDING', NULL, NULL, NULL, ?, NULL)`).run(planCheckId, projectId, trigger, verifiedCount, at);
    return planCheckId;
  }

  completePlanCheck(input) {
    const row = this.store.db.prepare('SELECT * FROM plan_checks WHERE id=?').get(requireString(input.planCheckId, 'planCheckId', { max: 128 }));
    if (!row || row.status !== 'PENDING') throw new ControlPlaneError('PLAN_CHECK_NOT_PENDING', 'Plan Check is missing or complete', 409);
    const project = this.controlPlane.requireProject(row.project_id);
    const actor = requireActor(input.actor);
    if (!(actor.type === 'pl' && actor.id === project.leadAgentId)) throw new ControlPlaneError('FORBIDDEN', 'Only the Project Lead may complete Plan Check', 403);
    const decision = enumValue(input.decision, 'decision', ['KEEP_PLAN', 'ADJUST_PLAN']);
    const notes = requireString(input.notes, 'notes', { max: 5000 });
    const operationId = this.controlPlane.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE plan_checks SET status='COMPLETED', decision=?, notes=?, actor_id=?, completed_at=? WHERE id=?").run(decision, notes, actorKey(actor), at, row.id);
      this.controlPlane.activity({ operationId, projectId: project.id, eventType: 'PLAN_CHECK_COMPLETED', actor, objectRef: row.id, summary: `${decision}: ${notes}`, at });
    });
    return (input.responseView === 'overview' ? this.store.getProjectOverview(project.id) : this.store.snapshot(project.id));
  }

  recordDecision(input) {
    const project = this.controlPlane.requireProject(input.projectId);
    const actor = requireActor(input.actor);
    if (!((actor.type === 'pl' && actor.id === project.leadAgentId) || (actor.type === 'human' && actor.id === project.ownerId))) throw new ControlPlaneError('FORBIDDEN', 'Only Human/PL may approve project Decisions', 403);
    // R1.3: a Decision that changes Mission, Scope, or non-negotiable Charter
    // constraints is a Human-only major change. A PL recordDecision with any
    // declared Charter impact is rejected instead of auto-taking effect.
    const charterImpact = enumValue(input.charterImpact ?? 'NONE', 'charterImpact', CHARTER_IMPACT);
    if (charterImpact !== 'NONE' && actor.type !== 'human') {
      throw new ControlPlaneError('CHARTER_CHANGE_REQUIRES_HUMAN', 'Decisions affecting Mission/Scope/non-negotiable constraints require the Human Owner', 403);
    }
    const operationId = this.controlPlane.assertNewOperation(input.operationId);
    const decisionId = id('DECISION');
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO decisions(id, project_id, title, body, status, approved_by, created_at, approved_at)
        VALUES(?, ?, ?, ?, 'APPROVED', ?, ?, ?)`).run(decisionId, project.id, requireString(input.title, 'title', { max: 300 }), requireString(input.body, 'body', { max: 10000 }), actorKey(actor), at, at);
      this.controlPlane.activity({ operationId, projectId: project.id, eventType: 'DECISION_APPROVED', actor, objectRef: decisionId, summary: input.title, at });
    });
    return (input.responseView === 'overview' ? this.store.getProjectOverview(project.id) : this.store.snapshot(project.id));
  }
}
