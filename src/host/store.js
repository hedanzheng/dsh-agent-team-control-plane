import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_ROLE_PERMISSIONS, json, parseJson } from '../shared/contracts.js';

const SCHEMA_VERSION = 9;

function mapProject(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    leadAgentId: row.lead_agent_id,
    leadRuntimeKey: row.lead_runtime_key,
    workerRuntimeKey: row.worker_runtime_key ?? null,
    workspaceDir: row.workspace_dir,
    initialGoal: row.initial_goal,
    charterVersion: row.charter_version,
    maxAgents: row.max_agents,
    replanEveryN: row.replan_every_n,
    status: row.status,
    version: row.version,
    plSessionId: row.pl_session_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVerificationCommand(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    displayName: row.display_name,
    command: row.command,
    timeoutMs: row.timeout_ms,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

function mapCharter(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    status: row.status,
    mission: row.mission,
    scope: {
      allowed: parseJson(row.scope_allowed_json, []),
      forbidden: parseJson(row.scope_forbidden_json, []),
    },
    constraints: parseJson(row.constraints_json, []),
    successCriteria: parseJson(row.success_criteria_json, []),
    userConfirmed: parseJson(row.user_confirmed_json, {}),
    plAssumptions: parseJson(row.pl_assumptions_json, []),
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

function mapRuntime(row) {
  return {
    providerKey: row.provider_key,
    kind: row.kind,
    displayName: row.display_name,
    availability: row.availability,
    authorized: Boolean(row.authorized),
    capabilities: parseJson(row.capabilities_json, {}),
    source: row.source,
    lastScannedAt: row.last_scanned_at,
    scanError: row.scan_error,
  };
}

function mapAgent(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    displayName: row.display_name,
    providerKey: row.provider_key,
    role: row.role,
    permissions: parseJson(row.permissions_json, []),
    skills: parseJson(row.skills_json, []),
    status: row.status,
    currentTaskId: row.current_task_id,
    replacesAgentId: row.replaces_agent_id,
    createdAt: row.created_at,
  };
}

function mapApproval(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status,
    payload: parseJson(row.payload_json, {}),
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function mapInterview(row) {
  if (!row) return undefined;
  return {
    projectId: row.project_id,
    mode: row.mode,
    questions: parseJson(row.questions_json, []),
    answers: parseJson(row.answers_json, {}),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapTask(row, dependencies = []) {
  if (!row) return undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    goal: row.goal,
    scope: {
      allowed: parseJson(row.scope_allowed_json, []),
      forbidden: parseJson(row.scope_forbidden_json, []),
    },
    acceptance: parseJson(row.acceptance_json, []),
    dependencies,
    controlLevel: row.control_level,
    reviewPolicy: row.review_policy,
    assignedAgentId: row.assigned_agent_id,
    status: row.status,
    version: row.version,
    charterVersion: row.charter_version,
    resultId: row.result_id,
    waiting: row.waiting_reason ? {
      reason: row.waiting_reason,
      onRef: row.waiting_on_ref,
      checkpointRef: row.checkpoint_ref,
      deadline: row.waiting_deadline,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskProposal(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    proposedByAgentId: row.proposed_by_agent_id,
    payload: parseJson(row.payload_json, {}),
    status: row.status,
    decidedBy: row.decided_by,
    resultingTaskId: row.resulting_task_id,
    reason: row.reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function mapTaskRun(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    providerKey: row.provider_key,
    attempt: row.attempt,
    runtimeSessionRef: row.runtime_session_ref,
    workspaceRef: row.workspace_ref,
    writeIntent: Boolean(row.write_intent),
    status: row.status,
    terminalKind: row.terminal_kind,
    terminalPayloadRef: row.terminal_payload_ref,
    capabilities: parseJson(row.capability_snapshot_json, {}),
    verificationCommands: parseJson(row.verification_commands_json, []),
    workspaceBaseline: parseJson(row.workspace_baseline_json, null),
    workspaceDiff: parseJson(row.workspace_diff_json, null),
    watchdogState: row.watchdog_state,
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    heartbeatAt: row.heartbeat_at,
    cancelRequestedAt: row.cancel_requested_at,
    createdAt: row.created_at,
  };
}

function mapTaskRunSummary(row) {
  return {
    id: row.id, taskId: row.task_id, agentId: row.agent_id, providerKey: row.provider_key,
    attempt: row.attempt, status: row.status, terminalKind: row.terminal_kind,
    watchdogState: row.watchdog_state,
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    startedAt: row.started_at, endedAt: row.ended_at, createdAt: row.created_at,
  };
}

function mapResult(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id,
    outcome: row.outcome,
    changeSummary: row.change_summary,
    artifacts: parseJson(row.artifacts_json, []),
    verifiedActions: parseJson(row.verified_actions_json, []),
    testPlan: row.test_plan,
    risks: parseJson(row.risks_json, []),
    unresolved: parseJson(row.unresolved_json, []),
    findings: parseJson(row.findings_json, []),
    evidenceRefs: parseJson(row.evidence_refs_json, []),
    checkpoint: parseJson(row.checkpoint_json, null),
    requestProposal: parseJson(row.request_proposal_json, null),
    rawOutputExcerpt: row.raw_output_excerpt,
    createdAt: row.created_at,
  };
}

function mapEvidence(row) {
  return {
    id: row.id,
    resultId: row.result_id,
    kind: row.kind,
    ref: row.ref,
    status: row.status,
    details: parseJson(row.details_json, {}),
    createdAt: row.created_at,
  };
}

function mapRequest(row) {
  if (!row) return undefined;
  return {
    id: row.id, projectId: row.project_id, sourceTaskId: row.source_task_id,
    sourceResultId: row.source_result_id, fromAgentId: row.from_agent_id, toAgentId: row.to_agent_id,
    body: row.body, blocking: Boolean(row.blocking), status: row.status, responseId: row.response_id,
    deadlineAt: row.deadline_at, createdAt: row.created_at, startedAt: row.started_at, resolvedAt: row.resolved_at,
  };
}

function mapResponse(row) {
  if (!row) return undefined;
  return {
    id: row.id, requestId: row.request_id, fromAgentId: row.from_agent_id, outcome: row.outcome,
    body: row.body, evidenceRefs: parseJson(row.evidence_refs_json, []), createdAt: row.created_at,
  };
}

function mapReview(row) {
  if (!row) return undefined;
  return {
    id: row.id, taskId: row.task_id, resultId: row.result_id, reviewerAgentId: row.reviewer_agent_id,
    reviewerRole: row.reviewer_role, decision: row.decision, issues: parseJson(row.issues_json, []),
    evidenceRefs: parseJson(row.evidence_refs_json, []), createdAt: row.created_at,
  };
}

function mapFinding(row) {
  if (!row) return undefined;
  return {
    id: row.id, projectId: row.project_id, discoveredInTaskId: row.discovered_in_task_id,
    reportedByAgentId: row.reported_by_agent_id, description: row.description,
    evidenceRefs: parseJson(row.evidence_refs_json, []), severity: row.severity, status: row.status,
    linkedFixTaskId: row.linked_fix_task_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapPlanCheck(row) {
  if (!row) return undefined;
  return {
    id: row.id, projectId: row.project_id, trigger: row.trigger, verifiedCount: row.verified_count,
    status: row.status, decision: row.decision, notes: row.notes, actorId: row.actor_id,
    createdAt: row.created_at, completedAt: row.completed_at,
  };
}

function mapDecision(row) {
  if (!row) return undefined;
  return {
    id: row.id, projectId: row.project_id, title: row.title, body: row.body, status: row.status,
    approvedBy: row.approved_by, createdAt: row.created_at, approvedAt: row.approved_at,
  };
}

function mapActivity(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    operationId: row.operation_id,
    projectId: row.project_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    objectRef: row.object_ref,
    taskId: row.task_id ?? null,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function mapRequestRun(row) {
  if (!row) return undefined;
  return {
    id: row.id, requestId: row.request_id, agentId: row.agent_id, providerKey: row.provider_key,
    runtimeSessionRef: row.runtime_session_ref, status: row.status, terminalKind: row.terminal_kind,
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    startedAt: row.started_at, endedAt: row.ended_at, createdAt: row.created_at,
  };
}

function mapReviewRun(row) {
  if (!row) return undefined;
  return {
    id: row.id, taskId: row.task_id, resultId: row.result_id, reviewerAgentId: row.reviewer_agent_id,
    providerKey: row.provider_key, runtimeSessionRef: row.runtime_session_ref, status: row.status,
    decision: row.decision, error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    rawOutputExcerpt: row.raw_output_excerpt, startedAt: row.started_at, endedAt: row.ended_at, createdAt: row.created_at,
  };
}

export class ControlPlaneStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_sources (
        provider_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        display_name TEXT NOT NULL,
        availability TEXT NOT NULL,
        authorized INTEGER NOT NULL DEFAULT 0 CHECK (authorized IN (0, 1)),
        capabilities_json TEXT NOT NULL,
        source TEXT NOT NULL,
        last_scanned_at TEXT NOT NULL,
        scan_error TEXT
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        lead_agent_id TEXT,
        lead_runtime_key TEXT NOT NULL REFERENCES runtime_sources(provider_key),
        worker_runtime_key TEXT REFERENCES runtime_sources(provider_key),
        workspace_dir TEXT NOT NULL,
        initial_goal TEXT NOT NULL,
        charter_version INTEGER NOT NULL DEFAULT 0,
        max_agents INTEGER NOT NULL CHECK (max_agents BETWEEN 1 AND 32),
        replan_every_n INTEGER NOT NULL DEFAULT 5 CHECK (replan_every_n >= 1),
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_interviews (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        answers_json TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS charters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        mission TEXT NOT NULL,
        scope_allowed_json TEXT NOT NULL,
        scope_forbidden_json TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        success_criteria_json TEXT NOT NULL,
        user_confirmed_json TEXT NOT NULL,
        pl_assumptions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        UNIQUE(project_id, version)
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        provider_key TEXT NOT NULL REFERENCES runtime_sources(provider_key),
        role TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        skills_json TEXT NOT NULL,
        status TEXT NOT NULL,
        current_task_id TEXT,
        replaces_agent_id TEXT REFERENCES agents(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        decided_by TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_approval_per_kind
        ON approvals(project_id, kind) WHERE status = 'PENDING';
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE,
        project_id TEXT,
        event_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        object_ref TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        scope_allowed_json TEXT NOT NULL,
        scope_forbidden_json TEXT NOT NULL,
        acceptance_json TEXT NOT NULL,
        control_level TEXT NOT NULL CHECK (control_level IN ('ROUTINE', 'IMPORTANT', 'CRITICAL')),
        review_policy TEXT NOT NULL CHECK (review_policy IN ('AUTO', 'PL', 'REVIEWER_PL')),
        assigned_agent_id TEXT REFERENCES agents(id),
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'READY', 'RUNNING', 'WAITING', 'SUBMITTED', 'VERIFIED', 'FAILED', 'CANCELLED')),
        version INTEGER NOT NULL DEFAULT 1,
        charter_version INTEGER NOT NULL,
        result_id TEXT,
        waiting_reason TEXT,
        waiting_on_ref TEXT,
        checkpoint_ref TEXT,
        waiting_deadline TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tasks_project_status ON tasks(project_id, status);
      CREATE INDEX IF NOT EXISTS tasks_assigned_agent ON tasks(assigned_agent_id, status);
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        dependency_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
        PRIMARY KEY(task_id, dependency_task_id),
        CHECK(task_id <> dependency_task_id)
      );
      CREATE TABLE IF NOT EXISTS task_proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        proposed_by_agent_id TEXT NOT NULL REFERENCES agents(id),
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
        decided_by TEXT,
        resulting_task_id TEXT REFERENCES tasks(id),
        reason TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS task_proposals_project_status ON task_proposals(project_id, status);
      CREATE TABLE IF NOT EXISTS task_state_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        reason TEXT,
        evidence_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_state_events_task ON task_state_events(task_id, created_at);
      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        provider_key TEXT NOT NULL REFERENCES runtime_sources(provider_key),
        attempt INTEGER NOT NULL CHECK(attempt >= 1),
        runtime_session_ref TEXT,
        workspace_ref TEXT NOT NULL,
        write_intent INTEGER NOT NULL CHECK(write_intent IN (0, 1)),
        status TEXT NOT NULL CHECK(status IN ('CREATED', 'STARTING', 'RUNNING', 'SUCCEEDED', 'NEEDS_INPUT', 'PARTIAL', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'CANNOT_START', 'UNKNOWN')),
        terminal_kind TEXT,
        terminal_payload_ref TEXT,
        capability_snapshot_json TEXT NOT NULL,
        verification_commands_json TEXT NOT NULL,
        watchdog_state TEXT NOT NULL DEFAULT 'HEALTHY',
        error_code TEXT,
        error_message TEXT,
        started_at TEXT,
        ended_at TEXT,
        heartbeat_at TEXT,
        cancel_requested_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, attempt)
      );
      CREATE INDEX IF NOT EXISTS task_runs_task ON task_runs(task_id, attempt);
      CREATE INDEX IF NOT EXISTS task_runs_status ON task_runs(status);
      CREATE TABLE IF NOT EXISTS task_run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_run_events_run ON task_run_events(run_id, created_at);
      CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL UNIQUE REFERENCES task_runs(id) ON DELETE CASCADE,
        outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS', 'PARTIAL', 'NEEDS_INPUT', 'CANNOT_START', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN')),
        change_summary TEXT NOT NULL,
        artifacts_json TEXT NOT NULL,
        verified_actions_json TEXT NOT NULL,
        test_plan TEXT NOT NULL,
        risks_json TEXT NOT NULL,
        unresolved_json TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        checkpoint_json TEXT,
        request_proposal_json TEXT,
        raw_output_excerpt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS results_task ON results(task_id, created_at);
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('FILE', 'COMMAND', 'RUNTIME', 'TEXT')),
        ref TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('VERIFIED', 'FAILED', 'UNVERIFIED', 'NOT_RUN')),
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS evidence_result ON evidence(result_id, created_at);
      CREATE TABLE IF NOT EXISTS verification_runs (
        id TEXT PRIMARY KEY,
        result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
        command_text TEXT NOT NULL,
        cwd TEXT NOT NULL,
        exit_code INTEGER,
        status TEXT NOT NULL CHECK(status IN ('PASSED', 'FAILED', 'TIMED_OUT', 'NOT_RUN')),
        stdout_excerpt TEXT NOT NULL,
        stderr_excerpt TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_locks (
        workspace_ref TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE REFERENCES task_runs(id) ON DELETE CASCADE,
        acquired_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        source_result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
        from_agent_id TEXT NOT NULL REFERENCES agents(id),
        to_agent_id TEXT NOT NULL REFERENCES agents(id),
        body TEXT NOT NULL,
        blocking INTEGER NOT NULL CHECK(blocking IN (0, 1)),
        status TEXT NOT NULL CHECK(status IN ('PENDING','IN_PROGRESS','RESOLVED','REJECTED','TIMED_OUT')),
        response_id TEXT,
        deadline_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        resolved_at TEXT,
        CHECK(from_agent_id <> to_agent_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_request_per_task
        ON requests(source_task_id) WHERE status IN ('PENDING','IN_PROGRESS');
      CREATE INDEX IF NOT EXISTS requests_mailbox ON requests(to_agent_id, status, created_at);
      CREATE TABLE IF NOT EXISTS responses (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
        from_agent_id TEXT NOT NULL REFERENCES agents(id),
        outcome TEXT NOT NULL CHECK(outcome IN ('ANSWER','UNABLE_TO_ANSWER','REQUEST_TIMEOUT')),
        body TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS request_runs (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        provider_key TEXT NOT NULL REFERENCES runtime_sources(provider_key),
        runtime_session_ref TEXT,
        status TEXT NOT NULL CHECK(status IN ('STARTING','RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','UNKNOWN','CANNOT_START')),
        terminal_kind TEXT,
        error_code TEXT,
        error_message TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
        reviewer_agent_id TEXT REFERENCES agents(id),
        reviewer_role TEXT NOT NULL CHECK(reviewer_role IN ('AUTO','PL','REVIEWER')),
        decision TEXT NOT NULL CHECK(decision IN ('APPROVE','REJECT')),
        issues_json TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reviews_task ON reviews(task_id, created_at);
      CREATE TABLE IF NOT EXISTS review_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
        reviewer_agent_id TEXT NOT NULL REFERENCES agents(id),
        provider_key TEXT NOT NULL REFERENCES runtime_sources(provider_key),
        runtime_session_ref TEXT,
        status TEXT NOT NULL CHECK(status IN ('STARTING','RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','UNKNOWN','CANNOT_START')),
        decision TEXT CHECK(decision IN ('APPROVE','REJECT')),
        error_code TEXT,
        error_message TEXT,
        raw_output_excerpt TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_review_run_per_result
        ON review_runs(task_id, result_id) WHERE status IN ('STARTING','RUNNING');
      CREATE INDEX IF NOT EXISTS review_runs_task ON review_runs(task_id, created_at);
      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        discovered_in_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        reported_by_agent_id TEXT REFERENCES agents(id),
        description TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
        status TEXT NOT NULL CHECK(status IN ('OPEN','LINKED_TO_TASK','CLOSED')),
        linked_fix_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS findings_project_status ON findings(project_id, status);
      CREATE TABLE IF NOT EXISTS plan_checks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        trigger TEXT NOT NULL,
        verified_count INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING','COMPLETED')),
        decision TEXT CHECK(decision IN ('KEEP_PLAN','ADJUST_PLAN')),
        notes TEXT,
        actor_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_plan_check ON plan_checks(project_id) WHERE status='PENDING';
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PROPOSED','APPROVED','SUPERSEDED')),
        approved_by TEXT,
        created_at TEXT NOT NULL,
        approved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS verification_commands (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        command TEXT NOT NULL,
        timeout_ms INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('APPROVED','REVOKED')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        approved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS verification_commands_by_project
        ON verification_commands(project_id, status);
    `);
    const projectColumns = new Set(this.db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name));
    if (!projectColumns.has('pl_session_id')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN pl_session_id TEXT');
    }
    if (!projectColumns.has('worker_runtime_key')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN worker_runtime_key TEXT REFERENCES runtime_sources(provider_key)');
      // Existing Projects predate an explicit Worker-runtime preference. Where
      // a team already exists, preserve the effective Worker assignment as the
      // Project default. Earlier-stage Projects remain NULL and use the normal
      // authorized-runtime default when their Charter is approved.
      this.db.exec(`
        UPDATE projects
        SET worker_runtime_key = (
          SELECT provider_key FROM agents
          WHERE agents.project_id = projects.id
            AND agents.role = 'WORKER'
            AND agents.status <> 'REPLACED'
          ORDER BY agents.created_at, agents.id
          LIMIT 1
        )
        WHERE worker_runtime_key IS NULL
      `);
    }
    // R2.1: capture the workspace baseline before a write Run and the observed
    // diff afterwards, so Task scope compliance can be checked against actual
    // filesystem changes rather than only Worker-reported artifacts.
    const runColumns = new Set(this.db.prepare('PRAGMA table_info(task_runs)').all().map((column) => column.name));
    if (!runColumns.has('workspace_baseline_json')) {
      this.db.exec('ALTER TABLE task_runs ADD COLUMN workspace_baseline_json TEXT');
    }
    if (!runColumns.has('workspace_diff_json')) {
      this.db.exec('ALTER TABLE task_runs ADD COLUMN workspace_diff_json TEXT');
    }
    // R5: Activity is read with a bounded, project-scoped keyset query. Keep a
    // structured Task relation where one can be established from Host facts;
    // never infer it in the browser from free-form summaries.
    const activityColumns = new Set(this.db.prepare('PRAGMA table_info(activities)').all().map((column) => column.name));
    const activityTaskColumnAdded = !activityColumns.has('task_id');
    if (activityTaskColumnAdded) {
      this.db.exec('ALTER TABLE activities ADD COLUMN task_id TEXT');
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS activities_project_created_id
        ON activities(project_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS activities_project_actor_created_id
        ON activities(project_id, actor_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS activities_project_type_created_id
        ON activities(project_id, event_type, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS activities_project_task_created_id
        ON activities(project_id, task_id, created_at DESC, id DESC);
    `);
    if (activityTaskColumnAdded) {
      this.db.exec(`
        UPDATE activities SET task_id = object_ref
        WHERE task_id IS NULL AND object_ref IN (SELECT id FROM tasks);
        UPDATE activities SET task_id = (SELECT task_id FROM task_runs WHERE task_runs.id = activities.object_ref)
        WHERE task_id IS NULL AND object_ref IN (SELECT id FROM task_runs);
        UPDATE activities SET task_id = (SELECT task_id FROM results WHERE results.id = activities.object_ref)
        WHERE task_id IS NULL AND object_ref IN (SELECT id FROM results);
        UPDATE activities SET task_id = (SELECT source_task_id FROM requests WHERE requests.id = activities.object_ref)
        WHERE task_id IS NULL AND object_ref IN (SELECT id FROM requests);
        UPDATE activities SET task_id = (SELECT task_id FROM reviews WHERE reviews.id = activities.object_ref)
        WHERE task_id IS NULL AND object_ref IN (SELECT id FROM reviews);
        UPDATE activities SET task_id = (SELECT task_id FROM review_runs WHERE review_runs.id = activities.object_ref)
        WHERE task_id IS NULL AND object_ref IN (SELECT id FROM review_runs);
        UPDATE activities SET task_id = (SELECT discovered_in_task_id FROM findings WHERE findings.id = activities.object_ref)
        WHERE task_id IS NULL AND object_ref IN (SELECT id FROM findings);
      `);
    }
    // R1.3: migrations must never re-expand permissions that were previously
    // narrowed. Prune any permission outside the frozen role template; never
    // merge defaults back into existing records.
    const permissionRows = this.db.prepare("SELECT id, role, permissions_json FROM agents WHERE role IN ('PROJECT_LEAD', 'WORKER', 'REVIEWER')").all();
    const updatePermissions = this.db.prepare('UPDATE agents SET permissions_json=? WHERE id=?');
    for (const row of permissionRows) {
      const permissions = parseJson(row.permissions_json, []);
      const template = new Set(DEFAULT_ROLE_PERMISSIONS[row.role] ?? []);
      const pruned = permissions.filter((permission) => template.has(permission));
      if (pruned.length !== permissions.length) updatePermissions.run(json(pruned), row.id);
    }
    this.db.prepare(`INSERT INTO schema_meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(SCHEMA_VERSION));
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  getProject(projectId) {
    return mapProject(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId));
  }

  setProjectPlSession(projectId, plSessionId, at) {
    this.db.prepare('UPDATE projects SET pl_session_id=?, updated_at=? WHERE id=?').run(plSessionId, at, projectId);
  }

  listVerificationCommands(projectId) {
    return this.db.prepare('SELECT * FROM verification_commands WHERE project_id=? ORDER BY created_at, id').all(projectId).map(mapVerificationCommand);
  }

  getVerificationCommand(projectId, commandId) {
    return mapVerificationCommand(this.db.prepare('SELECT * FROM verification_commands WHERE project_id=? AND id=?').get(projectId, commandId));
  }

  insertVerificationCommand(record) {
    this.db.prepare(`INSERT INTO verification_commands(
      id, project_id, display_name, command, timeout_ms, status, created_by, created_at, approved_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.id, record.projectId, record.displayName, record.command, record.timeoutMs,
      record.status, record.createdBy, record.createdAt, record.approvedAt ?? null,
    );
  }

  setVerificationCommandStatus(commandId, status, at) {
    this.db.prepare('UPDATE verification_commands SET status=?, approved_at=? WHERE id=?').run(status, at, commandId);
  }

  listProjects() {
    return this.db.prepare('SELECT * FROM projects ORDER BY created_at, id').all().map(mapProject);
  }

  deleteProject(projectId) {
    // Project-owned records use ON DELETE CASCADE. Activity deliberately has no
    // Project foreign key because it also stores system-wide events, so remove
    // the Project activity stream explicitly before deleting the root row.
    // task_dependencies uses RESTRICT for dependency_task_id to protect normal
    // Task edits; remove both sides of this Project's DAG before root cascade.
    this.db.prepare('DELETE FROM activities WHERE project_id=?').run(projectId);
    this.db.prepare(`DELETE FROM task_dependencies
      WHERE task_id IN (SELECT id FROM tasks WHERE project_id=?)
         OR dependency_task_id IN (SELECT id FROM tasks WHERE project_id=?)`).run(projectId, projectId);
    return this.db.prepare('DELETE FROM projects WHERE id=?').run(projectId);
  }

  getInterview(projectId) {
    return mapInterview(this.db.prepare('SELECT * FROM project_interviews WHERE project_id = ?').get(projectId));
  }

  listCharters(projectId) {
    return this.db.prepare('SELECT * FROM charters WHERE project_id = ? ORDER BY version').all(projectId).map(mapCharter);
  }

  getCurrentCharter(projectId) {
    return mapCharter(this.db.prepare(`
      SELECT c.* FROM charters c JOIN projects p ON p.id = c.project_id
      WHERE c.project_id = ? AND c.version = p.charter_version
    `).get(projectId));
  }

  getDraftCharter(projectId) {
    return mapCharter(this.db.prepare("SELECT * FROM charters WHERE project_id = ? AND status = 'DRAFT' ORDER BY version DESC LIMIT 1").get(projectId));
  }

  listAgents(projectId) {
    return this.db.prepare('SELECT * FROM agents WHERE project_id = ? ORDER BY created_at, id').all(projectId).map(mapAgent);
  }

  listApprovals(projectId) {
    return this.db.prepare('SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at').all(projectId).map(mapApproval);
  }

  pendingApproval(projectId, kind) {
    return mapApproval(this.db.prepare("SELECT * FROM approvals WHERE project_id = ? AND kind = ? AND status = 'PENDING'").get(projectId, kind));
  }

  listRuntimes() {
    return this.db.prepare('SELECT * FROM runtime_sources ORDER BY kind, provider_key').all().map(mapRuntime);
  }

  getRuntime(providerKey) {
    const row = this.db.prepare('SELECT * FROM runtime_sources WHERE provider_key = ?').get(providerKey);
    return row ? mapRuntime(row) : undefined;
  }

  upsertRuntime(runtime) {
    this.db.prepare(`
      INSERT INTO runtime_sources(provider_key, kind, display_name, availability, authorized, capabilities_json, source, last_scanned_at, scan_error)
      VALUES(?, ?, ?, ?, COALESCE((SELECT authorized FROM runtime_sources WHERE provider_key = ?), 0), ?, ?, ?, ?)
      ON CONFLICT(provider_key) DO UPDATE SET
        kind=excluded.kind,
        display_name=excluded.display_name,
        availability=excluded.availability,
        capabilities_json=excluded.capabilities_json,
        source=excluded.source,
        last_scanned_at=excluded.last_scanned_at,
        scan_error=excluded.scan_error
    `).run(
      runtime.providerKey, runtime.kind, runtime.displayName, runtime.availability,
      runtime.providerKey, json(runtime.capabilities), runtime.source, runtime.lastScannedAt,
      runtime.scanError ?? null,
    );
  }

  markUnseenRuntimesUnavailable(seen, scannedAt) {
    const rows = this.db.prepare('SELECT provider_key FROM runtime_sources').all();
    const update = this.db.prepare("UPDATE runtime_sources SET availability = 'UNVERIFIED', last_scanned_at = ?, scan_error = 'not reported by current Host scan' WHERE provider_key = ?");
    for (const row of rows) if (!seen.has(row.provider_key)) update.run(scannedAt, row.provider_key);
  }

  setRuntimeAuthorized(providerKey, authorized) {
    return this.db.prepare('UPDATE runtime_sources SET authorized = ? WHERE provider_key = ?').run(authorized ? 1 : 0, providerKey);
  }

  setSystemState(key, value, updatedAt) {
    this.db.prepare(`INSERT INTO system_state(key, value_json, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`).run(key, json(value), updatedAt);
  }

  getSystemState(key, fallback = undefined) {
    const row = this.db.prepare('SELECT value_json FROM system_state WHERE key = ?').get(key);
    return row ? parseJson(row.value_json, fallback) : fallback;
  }

  operationExists(operationId) {
    return Boolean(this.db.prepare('SELECT 1 AS found FROM activities WHERE operation_id = ?').get(operationId));
  }

  appendActivity(activity) {
    const taskId = activity.taskId ?? this.resolveActivityTaskId(activity.objectRef);
    this.db.prepare(`INSERT INTO activities(id, operation_id, project_id, event_type, actor_id, object_ref, task_id, summary, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      activity.id, activity.operationId, activity.projectId ?? null, activity.eventType,
      activity.actorId, activity.objectRef, taskId, activity.summary, activity.createdAt,
    );
  }

  resolveActivityTaskId(objectRef) {
    if (!objectRef) return null;
    const lookups = [
      ['SELECT id AS task_id FROM tasks WHERE id=?', objectRef],
      ['SELECT task_id FROM task_runs WHERE id=?', objectRef],
      ['SELECT task_id FROM results WHERE id=?', objectRef],
      ['SELECT source_task_id AS task_id FROM requests WHERE id=?', objectRef],
      ['SELECT task_id FROM reviews WHERE id=?', objectRef],
      ['SELECT task_id FROM review_runs WHERE id=?', objectRef],
      ['SELECT discovered_in_task_id AS task_id FROM findings WHERE id=?', objectRef],
    ];
    for (const [sql, value] of lookups) {
      const row = this.db.prepare(sql).get(value);
      if (row?.task_id) return row.task_id;
    }
    return null;
  }

  listActivities(projectId) {
    return this.db.prepare('SELECT * FROM activities WHERE project_id = ? ORDER BY created_at, id').all(projectId).map(mapActivity);
  }

  listRecentActivities(projectId, limit = 10) {
    const bounded = Math.max(1, Math.min(50, Number(limit) || 10));
    return this.db.prepare('SELECT * FROM activities WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(projectId, bounded).map(mapActivity).reverse();
  }

  listActivityPage({ projectId, limit = 50, cursor = null, actorId = '', eventType = '', taskId = '' }) {
    const bounded = Math.max(1, Math.min(100, Number(limit) || 50));
    const where = ['project_id = ?'];
    const args = [projectId];
    if (cursor?.createdAt && cursor?.id) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    if (actorId) { where.push('actor_id = ?'); args.push(actorId); }
    if (eventType) { where.push('event_type = ?'); args.push(eventType); }
    if (taskId) { where.push('task_id = ?'); args.push(taskId); }
    const rows = this.db.prepare(`SELECT * FROM activities WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...args, bounded + 1);
    const hasMore = rows.length > bounded;
    const items = rows.slice(0, bounded).map(mapActivity);
    const last = items.at(-1);
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  activityFacets(projectId) {
    return {
      actors: this.db.prepare('SELECT actor_id AS value, COUNT(*) AS count FROM activities WHERE project_id=? GROUP BY actor_id ORDER BY actor_id')
        .all(projectId),
      eventTypes: this.db.prepare('SELECT event_type AS value, COUNT(*) AS count FROM activities WHERE project_id=? GROUP BY event_type ORDER BY event_type')
        .all(projectId),
    };
  }

  taskDependencies(taskId) {
    return this.db.prepare('SELECT dependency_task_id FROM task_dependencies WHERE task_id=? ORDER BY dependency_task_id')
      .all(taskId).map((row) => row.dependency_task_id);
  }

  getTask(taskId) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
    return row ? mapTask(row, this.taskDependencies(taskId)) : undefined;
  }

  listTasks(projectId) {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY created_at, id').all(projectId);
    const dependencies = new Map();
    for (const row of this.db.prepare(`SELECT d.task_id, d.dependency_task_id FROM task_dependencies d
      JOIN tasks t ON t.id=d.task_id WHERE t.project_id=? ORDER BY d.task_id, d.dependency_task_id`).all(projectId)) {
      if (!dependencies.has(row.task_id)) dependencies.set(row.task_id, []);
      dependencies.get(row.task_id).push(row.dependency_task_id);
    }
    return rows.map((row) => mapTask(row, dependencies.get(row.id) || []));
  }

  getTaskProposal(proposalId) {
    return mapTaskProposal(this.db.prepare('SELECT * FROM task_proposals WHERE id=?').get(proposalId));
  }

  listTaskProposals(projectId) {
    return this.db.prepare('SELECT * FROM task_proposals WHERE project_id=? ORDER BY created_at, id').all(projectId).map(mapTaskProposal);
  }

  listTaskStateEvents(projectId) {
    return this.db.prepare(`SELECT e.* FROM task_state_events e JOIN tasks t ON t.id=e.task_id
      WHERE t.project_id=? ORDER BY e.created_at, e.id`).all(projectId).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actorId: row.actor_id,
      reason: row.reason,
      evidenceRefs: parseJson(row.evidence_refs_json, []),
      createdAt: row.created_at,
    }));
  }

  getTaskRun(runId) {
    return mapTaskRun(this.db.prepare('SELECT * FROM task_runs WHERE id=?').get(runId));
  }

  listTaskRuns(projectId) {
    return this.db.prepare(`SELECT r.* FROM task_runs r JOIN tasks t ON t.id=r.task_id
      WHERE t.project_id=? ORDER BY r.created_at, r.id`).all(projectId).map(mapTaskRun);
  }

  activeTaskRun(taskId) {
    return mapTaskRun(this.db.prepare("SELECT * FROM task_runs WHERE task_id=? AND status IN ('CREATED','STARTING','RUNNING') ORDER BY attempt DESC LIMIT 1").get(taskId));
  }

  listTaskRunEvents(projectId) {
    return this.db.prepare(`SELECT e.* FROM task_run_events e JOIN task_runs r ON r.id=e.run_id
      JOIN tasks t ON t.id=r.task_id WHERE t.project_id=? ORDER BY e.created_at, e.id`).all(projectId).map((row) => ({
      id: row.id, runId: row.run_id, fromStatus: row.from_status, toStatus: row.to_status,
      details: parseJson(row.details_json, {}), createdAt: row.created_at,
    }));
  }

  getResult(resultId) {
    return mapResult(this.db.prepare('SELECT * FROM results WHERE id=?').get(resultId));
  }

  getResultByRun(runId) {
    return mapResult(this.db.prepare('SELECT * FROM results WHERE run_id=?').get(runId));
  }

  listResults(projectId) {
    return this.db.prepare(`SELECT r.* FROM results r JOIN tasks t ON t.id=r.task_id
      WHERE t.project_id=? ORDER BY r.created_at, r.id`).all(projectId).map(mapResult);
  }

  listEvidence(projectId) {
    return this.db.prepare(`SELECT e.* FROM evidence e JOIN results r ON r.id=e.result_id
      JOIN tasks t ON t.id=r.task_id WHERE t.project_id=? ORDER BY e.created_at, e.id`).all(projectId).map(mapEvidence);
  }

  listVerificationRuns(projectId) {
    return this.db.prepare(`SELECT v.* FROM verification_runs v JOIN results r ON r.id=v.result_id
      JOIN tasks t ON t.id=r.task_id WHERE t.project_id=? ORDER BY v.started_at, v.id`).all(projectId).map((row) => ({
      id: row.id, resultId: row.result_id, command: row.command_text, cwd: row.cwd,
      exitCode: row.exit_code, status: row.status, stdoutExcerpt: row.stdout_excerpt,
      stderrExcerpt: row.stderr_excerpt, startedAt: row.started_at, endedAt: row.ended_at,
    }));
  }

  getRequest(requestId) {
    return mapRequest(this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId));
  }

  listRequests(projectId) {
    return this.db.prepare('SELECT * FROM requests WHERE project_id=? ORDER BY created_at, id').all(projectId).map(mapRequest);
  }

  listResponses(projectId) {
    return this.db.prepare(`SELECT s.* FROM responses s JOIN requests r ON r.id=s.request_id
      WHERE r.project_id=? ORDER BY s.created_at, s.id`).all(projectId).map(mapResponse);
  }

  listRequestRuns(projectId) {
    return this.db.prepare(`SELECT x.* FROM request_runs x JOIN requests r ON r.id=x.request_id
      WHERE r.project_id=? ORDER BY x.created_at, x.id`).all(projectId).map(mapRequestRun);
  }

  getResponse(responseId) {
    return mapResponse(this.db.prepare('SELECT * FROM responses WHERE id=?').get(responseId));
  }

  listReviews(projectId) {
    return this.db.prepare(`SELECT v.* FROM reviews v JOIN tasks t ON t.id=v.task_id
      WHERE t.project_id=? ORDER BY v.created_at, v.id`).all(projectId).map(mapReview);
  }

  listReviewRuns(projectId) {
    return this.db.prepare(`SELECT x.* FROM review_runs x JOIN tasks t ON t.id=x.task_id
      WHERE t.project_id=? ORDER BY x.created_at, x.id`).all(projectId).map(mapReviewRun);
  }

  listFindings(projectId) {
    return this.db.prepare('SELECT * FROM findings WHERE project_id=? ORDER BY created_at, id').all(projectId).map(mapFinding);
  }

  listPlanChecks(projectId) {
    return this.db.prepare('SELECT * FROM plan_checks WHERE project_id=? ORDER BY created_at, id').all(projectId).map(mapPlanCheck);
  }

  listDecisions(projectId, status = undefined) {
    const rows = status
      ? this.db.prepare('SELECT * FROM decisions WHERE project_id=? AND status=? ORDER BY created_at, id').all(projectId, status)
      : this.db.prepare('SELECT * FROM decisions WHERE project_id=? ORDER BY created_at, id').all(projectId);
    return rows.map(mapDecision);
  }

  systemSummary() {
    return {
      skillDiscovery: this.getSystemState('skill_discovery', { complete: false, grillMeAvailable: false, skills: [] }),
      runtimeScan: this.getSystemState('runtime_scan', null),
      runtimeAdapters: this.getSystemState('runtime_adapters', []),
      taskRunRecovery: this.getSystemState('task_run_recovery', { recoveredRuns: 0 }),
      requestRunRecovery: this.getSystemState('request_run_recovery', { recoveredRequestRuns: 0 }),
      reviewRunRecovery: this.getSystemState('review_run_recovery', { recoveredReviewRuns: 0 }),
    };
  }

  // O3: regular Panel/PL reads are bounded by the current Project's Task count,
  // not by its accumulated Run, Result, Evidence or Verification history.
  getProjectOverview(projectId = undefined) {
    const projects = this.listProjects();
    const project = projectId ? this.getProject(projectId) : projects.at(-1);
    const base = { schemaVersion: SCHEMA_VERSION, view: 'overview', projects,
      runtimes: this.listRuntimes(), system: this.systemSummary() };
    if (!project) return { ...base, selected: null };
    const id = project.id;
    const tasks = this.listTasks(id);
    const taskRuns = this.db.prepare(`SELECT r.id,r.task_id,r.agent_id,r.provider_key,r.attempt,r.status,
      r.terminal_kind,r.watchdog_state,r.error_code,r.error_message,r.started_at,r.ended_at,r.created_at
      FROM tasks t JOIN task_runs r ON r.id=(
      SELECT x.id FROM task_runs x WHERE x.task_id=t.id ORDER BY x.attempt DESC LIMIT 1)
      WHERE t.project_id=? ORDER BY t.created_at, t.id`).all(id).map(mapTaskRunSummary);
    const results = this.db.prepare(`SELECT r.* FROM tasks t JOIN results r ON r.id=t.result_id AND r.task_id=t.id
      WHERE t.project_id=? ORDER BY t.created_at, t.id`).all(id).map(mapResult);
    const evidence = this.db.prepare(`SELECT e.* FROM tasks t JOIN results r ON r.id=t.result_id AND r.task_id=t.id
      JOIN evidence e ON e.result_id=r.id WHERE t.project_id=? AND t.status='SUBMITTED'
      ORDER BY e.created_at, e.id`).all(id).map(mapEvidence);
    const reviews = this.db.prepare(`SELECT v.* FROM tasks t JOIN reviews v ON v.task_id=t.id AND v.result_id=t.result_id
      WHERE t.project_id=? AND t.status='SUBMITTED' ORDER BY v.created_at, v.id`).all(id).map(mapReview);
    const reviewRuns = this.db.prepare(`SELECT x.* FROM tasks t JOIN review_runs x ON x.task_id=t.id AND x.result_id=t.result_id
      WHERE t.project_id=? AND t.status='SUBMITTED' ORDER BY x.created_at, x.id`).all(id).map(mapReviewRun);
    const requests = this.db.prepare(`SELECT * FROM requests WHERE project_id=? AND status IN ('PENDING','IN_PROGRESS')
      ORDER BY created_at, id`).all(id).map(mapRequest);
    const requestRuns = this.db.prepare(`SELECT x.* FROM requests q JOIN request_runs x ON x.request_id=q.id
      WHERE q.project_id=? AND q.status IN ('PENDING','IN_PROGRESS') AND x.status IN ('STARTING','RUNNING')
      ORDER BY x.created_at, x.id`).all(id).map(mapRequestRun);
    const findings = this.db.prepare("SELECT * FROM findings WHERE project_id=? AND status<>'CLOSED' ORDER BY created_at,id")
      .all(id).map(mapFinding);
    const planChecks = this.db.prepare("SELECT * FROM plan_checks WHERE project_id=? AND status='PENDING' ORDER BY created_at,id")
      .all(id).map(mapPlanCheck);
    const taskProposals = this.db.prepare("SELECT * FROM task_proposals WHERE project_id=? AND status='PENDING' ORDER BY created_at,id")
      .all(id).map(mapTaskProposal);
    const approvals = this.db.prepare("SELECT * FROM approvals WHERE project_id=? AND status='PENDING' ORDER BY created_at,id")
      .all(id).map(mapApproval);
    const verificationCommands = this.db.prepare("SELECT * FROM verification_commands WHERE project_id=? AND status='APPROVED' ORDER BY created_at,id")
      .all(id).map(mapVerificationCommand);
    return { ...base, selected: {
      project, interview: this.getInterview(id), charters: this.listCharters(id), agents: this.listAgents(id), approvals,
      activities: this.listRecentActivities(id, 10), tasks, taskProposals, taskStateEvents: [], taskRuns,
      taskRunEvents: [], results, evidence, verificationRuns: [], requests, responses: [], requestRuns,
      reviews, reviewRuns, findings, planChecks, decisions: this.listDecisions(id), verificationCommands,
      stats: { totalTasks: tasks.length, activeRuns: taskRuns.filter((run) => ['CREATED', 'STARTING', 'RUNNING'].includes(run.status)).length },
    } };
  }

  getTaskDetail(projectId, taskId) {
    const task = this.getTask(taskId);
    if (!task || task.projectId !== projectId) return undefined;
    const taskRuns = this.db.prepare('SELECT * FROM task_runs WHERE task_id=? ORDER BY attempt,id').all(taskId).map(mapTaskRun);
    const results = this.db.prepare('SELECT * FROM results WHERE task_id=? ORDER BY created_at,id').all(taskId).map(mapResult);
    const evidence = this.db.prepare(`SELECT e.* FROM evidence e JOIN results r ON r.id=e.result_id
      WHERE r.task_id=? ORDER BY e.created_at,e.id`).all(taskId).map(mapEvidence);
    const verificationRuns = this.db.prepare(`SELECT v.* FROM verification_runs v JOIN results r ON r.id=v.result_id
      WHERE r.task_id=? ORDER BY v.started_at,v.id`).all(taskId).map((row) => ({
      id: row.id, resultId: row.result_id, command: row.command_text, cwd: row.cwd,
      exitCode: row.exit_code, status: row.status, stdoutExcerpt: row.stdout_excerpt,
      stderrExcerpt: row.stderr_excerpt, startedAt: row.started_at, endedAt: row.ended_at,
    }));
    const requests = this.db.prepare('SELECT * FROM requests WHERE source_task_id=? ORDER BY created_at,id').all(taskId).map(mapRequest);
    const responses = this.db.prepare(`SELECT s.* FROM responses s JOIN requests q ON q.id=s.request_id
      WHERE q.source_task_id=? ORDER BY s.created_at,s.id`).all(taskId).map(mapResponse);
    const reviews = this.db.prepare('SELECT * FROM reviews WHERE task_id=? ORDER BY created_at,id').all(taskId).map(mapReview);
    const reviewRuns = this.db.prepare('SELECT * FROM review_runs WHERE task_id=? ORDER BY created_at,id').all(taskId).map(mapReviewRun);
    return { projectId, task, taskRuns, results, evidence, verificationRuns, requests, responses, reviews, reviewRuns };
  }

  getProjectHistoryPage(projectId, kind, cursor = null, limit = 50) {
    const bounded = Math.max(1, Math.min(100, Number(limit) || 50));
    const definition = {
      'task-runs': { alias: 'r', from: 'task_runs r JOIN tasks t ON t.id=r.task_id', projectColumn: 't.project_id', map: mapTaskRun },
      reviews: { alias: 'v', from: 'reviews v JOIN tasks t ON t.id=v.task_id', projectColumn: 't.project_id', map: mapReview },
      evidence: { alias: 'e', from: 'evidence e JOIN results r ON r.id=e.result_id JOIN tasks t ON t.id=r.task_id', projectColumn: 't.project_id', map: mapEvidence },
      approvals: { alias: 'a', from: 'approvals a', projectColumn: 'a.project_id', map: mapApproval },
      requests: { alias: 'q', from: 'requests q LEFT JOIN responses s ON s.request_id=q.id', projectColumn: 'q.project_id',
        select: 'q.*,s.outcome AS response_outcome,s.body AS response_body',
        map: (row) => ({ ...mapRequest(row), response: row.response_outcome ? { outcome: row.response_outcome, body: row.response_body } : null }) },
      findings: { alias: 'f', from: 'findings f', projectColumn: 'f.project_id', map: mapFinding },
      'plan-checks': { alias: 'p', from: 'plan_checks p', projectColumn: 'p.project_id', map: mapPlanCheck },
    }[kind];
    if (!definition) return undefined;
    const { alias, from, projectColumn, map } = definition;
    const argumentsList = [projectId];
    let after = '';
    if (cursor?.createdAt && cursor?.id) {
      after = ` AND (${alias}.created_at < ? OR (${alias}.created_at = ? AND ${alias}.id < ?))`;
      argumentsList.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const rows = this.db.prepare(`SELECT ${definition.select || `${alias}.*`} FROM ${from} WHERE ${projectColumn}=?${after}
      ORDER BY ${alias}.created_at DESC, ${alias}.id DESC LIMIT ?`).all(...argumentsList, bounded + 1);
    const hasMore = rows.length > bounded;
    const items = rows.slice(0, bounded).map(map);
    const last = items.at(-1);
    return { items, hasMore, nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null };
  }

  latestResultsForTasks(taskIds) {
    const ids = [...new Set(taskIds)];
    if (!ids.length) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT r.* FROM results r WHERE r.task_id IN (${placeholders})
      AND r.id=(SELECT x.id FROM results x WHERE x.task_id=r.task_id ORDER BY x.created_at DESC,x.id DESC LIMIT 1)`)
      .all(...ids);
    return new Map(rows.map((row) => [row.task_id, mapResult(row)]));
  }

  latestResolvedRequestForTask(taskId) {
    return mapRequest(this.db.prepare(`SELECT * FROM requests WHERE source_task_id=? AND response_id IS NOT NULL
      ORDER BY created_at DESC,id DESC LIMIT 1`).get(taskId));
  }

  recentReviewsForTask(taskId, limit = 5) {
    return this.db.prepare('SELECT * FROM reviews WHERE task_id=? ORDER BY created_at DESC,id DESC LIMIT ?')
      .all(taskId, limit).map(mapReview).reverse();
  }

  recentApprovedDecisions(projectId, limit = 12) {
    return this.db.prepare("SELECT * FROM decisions WHERE project_id=? AND status='APPROVED' ORDER BY created_at DESC,id DESC LIMIT ?")
      .all(projectId, limit).map(mapDecision).reverse();
  }

  snapshot(projectId = undefined) {
    const projects = this.listProjects();
    const selected = projectId ? this.getProject(projectId) : projects.at(-1);
    return {
      schemaVersion: SCHEMA_VERSION,
      projects,
      runtimes: this.listRuntimes(),
      system: {
        skillDiscovery: this.getSystemState('skill_discovery', { complete: false, grillMeAvailable: false, skills: [] }),
        runtimeScan: this.getSystemState('runtime_scan', null),
        runtimeAdapters: this.getSystemState('runtime_adapters', []),
        taskRunRecovery: this.getSystemState('task_run_recovery', { recoveredRuns: 0 }),
        requestRunRecovery: this.getSystemState('request_run_recovery', { recoveredRequestRuns: 0 }),
        reviewRunRecovery: this.getSystemState('review_run_recovery', { recoveredReviewRuns: 0 }),
      },
      selected: selected ? {
        project: selected,
        interview: this.getInterview(selected.id),
        charters: this.listCharters(selected.id),
        agents: this.listAgents(selected.id),
        approvals: this.listApprovals(selected.id),
        // Overview/PL state only needs a bounded recent tail. The Activity tab
        // uses listActivityPage() and never downloads the full audit table.
        activities: this.listRecentActivities(selected.id, 10),
        tasks: this.listTasks(selected.id),
        taskProposals: this.listTaskProposals(selected.id),
        taskStateEvents: this.listTaskStateEvents(selected.id),
        taskRuns: this.listTaskRuns(selected.id),
        taskRunEvents: this.listTaskRunEvents(selected.id),
        results: this.listResults(selected.id),
        evidence: this.listEvidence(selected.id),
        verificationRuns: this.listVerificationRuns(selected.id),
        requests: this.listRequests(selected.id),
        responses: this.listResponses(selected.id),
        requestRuns: this.listRequestRuns(selected.id),
        reviews: this.listReviews(selected.id),
        reviewRuns: this.listReviewRuns(selected.id),
        findings: this.listFindings(selected.id),
        planChecks: this.listPlanChecks(selected.id),
        decisions: this.listDecisions(selected.id),
        verificationCommands: this.listVerificationCommands(selected.id),
      } : null,
    };
  }
}
