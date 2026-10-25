import {
  ControlPlaneError,
  CONTROL_LEVEL,
  DEFAULT_ROLE_PERMISSIONS,
  FALLBACK_INTERVIEW,
  REVIEW_POLICY,
  assertExpectedVersion,
  id,
  json,
  now,
  requireActor,
  requireInteger,
  requireString,
  requireStringArray,
} from '../shared/contracts.js';
import { isAbsolute, resolve } from 'node:path';

const REVIEW_RANK = Object.freeze({ AUTO: 0, PL: 1, REVIEWER_PL: 2 });
const MINIMUM_REVIEW = Object.freeze({ ROUTINE: 'AUTO', IMPORTANT: 'PL', CRITICAL: 'REVIEWER_PL' });
const TASK_TRANSITIONS = Object.freeze({
  PENDING: new Set(['CANCELLED']),
  READY: new Set(['RUNNING', 'FAILED', 'CANCELLED']),
  RUNNING: new Set(['WAITING', 'SUBMITTED', 'FAILED', 'CANCELLED']),
  WAITING: new Set(['READY', 'FAILED', 'CANCELLED']),
  SUBMITTED: new Set(['VERIFIED', 'READY', 'CANCELLED']),
});

function lines(value, field) {
  if (Array.isArray(value)) return requireStringArray(value, field, { min: 1, max: 20 });
  const text = requireString(value, field, { max: 5000 });
  const items = text.split(/\r?\n|[;；]/).map((item) => item.trim()).filter(Boolean);
  return requireStringArray(items, field, { min: 1, max: 20 });
}

function actorKey(actor) {
  return `${actor.type}:${actor.id}`;
}

function enumValue(value, field, allowed) {
  const normalized = requireString(value, field, { max: 32 }).toUpperCase();
  if (!allowed.includes(normalized)) throw new ControlPlaneError('INVALID_INPUT', `${field} must be one of ${allowed.join(', ')}`);
  return normalized;
}

function optionalLines(value, field) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return requireStringArray(value, field, { min: 0, max: 20 });
  return lines(value, field);
}

export class AgentTeamControlPlane {
  constructor(store, runtimeScanner) {
    this.store = store;
    this.runtimeScanner = runtimeScanner;
  }

  assertNewOperation(operationId) {
    const normalized = requireString(operationId, 'operationId', { max: 128 });
    if (this.store.operationExists(normalized)) {
      throw new ControlPlaneError('OPERATION_ALREADY_APPLIED', 'operationId was already applied', 409, { operationId: normalized });
    }
    return normalized;
  }

  requireProject(projectId) {
    const project = this.store.getProject(requireString(projectId, 'projectId', { max: 128 }));
    if (!project) throw new ControlPlaneError('PROJECT_NOT_FOUND', 'project does not exist', 404);
    return project;
  }

  assertHumanOwner(project, actor) {
    const value = requireActor(actor);
    if (value.type !== 'human' || value.id !== project.ownerId) {
      throw new ControlPlaneError('FORBIDDEN', 'only the Human Owner may perform this action', 403);
    }
    return value;
  }

  assertTeamPlanner(project, actor) {
    const value = requireActor(actor);
    if ((value.type === 'human' && value.id === project.ownerId)
      || (value.type === 'pl' && value.id === project.leadAgentId)) return value;
    throw new ControlPlaneError('FORBIDDEN', 'only the Human Owner or assigned PL may propose a team', 403);
  }

  requireUsableAuthorizedRuntime(providerKey) {
    const runtime = this.store.getRuntime(requireString(providerKey, 'providerKey', { max: 200 }));
    if (!runtime) throw new ControlPlaneError('RUNTIME_NOT_FOUND', 'runtime was not reported by the Host', 404);
    if (runtime.availability !== 'AVAILABLE') {
      throw new ControlPlaneError('RUNTIME_UNAVAILABLE', `runtime is ${runtime.availability}`, 409);
    }
    if (!runtime.authorized) throw new ControlPlaneError('RUNTIME_NOT_AUTHORIZED', 'Human has not authorized this runtime', 403);
    return runtime;
  }

  firstUsableAuthorizedRuntime(kind) {
    return this.store.listRuntimes().find((runtime) => runtime.kind === kind
      && runtime.availability === 'AVAILABLE'
      && runtime.authorized);
  }

  repairStaleWorkerRuntimes(members) {
    const replacement = this.firstUsableAuthorizedRuntime('external-worker');
    let changed = false;
    const repaired = members.map((member) => {
      if (!['WORKER', 'REVIEWER'].includes(member.role)) return member;
      const runtime = this.store.getRuntime(member.providerKey);
      if (runtime?.availability === 'AVAILABLE' && runtime.authorized) return member;
      if (!replacement) return member;
      changed = true;
      return { ...member, providerKey: replacement.providerKey };
    });
    return { members: repaired, changed, replacement };
  }

  activity({ operationId, projectId, eventType, actor, objectRef, summary, at = now() }) {
    this.store.appendActivity({
      id: id('ACTIVITY'), operationId, projectId, eventType,
      actorId: actorKey(actor), objectRef, summary, createdAt: at,
    });
  }

  async rescanRuntimes({ actor, operationId, cwd }) {
    const who = requireActor(actor);
    if (who.type !== 'human') throw new ControlPlaneError('FORBIDDEN', 'only Human may rescan runtimes', 403);
    const op = this.assertNewOperation(operationId);
    const result = await this.runtimeScanner.scan(cwd);
    this.store.transaction(() => {
      for (const runtime of result.runtimes) this.store.upsertRuntime(runtime);
      this.store.markUnseenRuntimesUnavailable(new Set(result.runtimes.map((item) => item.providerKey)), result.scannedAt);
      this.store.setSystemState('skill_discovery', result.skillDiscovery, result.scannedAt);
      this.store.setSystemState('runtime_scan', { scannedAt: result.scannedAt, errors: result.errors }, result.scannedAt);
      this.activity({ operationId: op, eventType: 'RUNTIMES_SCANNED', actor: who, objectRef: 'runtime-catalog', summary: `Host reported ${result.runtimes.length} runtime source(s)`, at: result.scannedAt });
    });
    return this.store.snapshot();
  }

  authorizeRuntime({ actor, operationId, providerKey, authorized }) {
    const who = requireActor(actor);
    if (who.type !== 'human') throw new ControlPlaneError('FORBIDDEN', 'only Human may authorize runtimes', 403);
    const op = this.assertNewOperation(operationId);
    const runtime = this.store.getRuntime(requireString(providerKey, 'providerKey', { max: 200 }));
    if (!runtime) throw new ControlPlaneError('RUNTIME_NOT_FOUND', 'runtime was not reported by the Host', 404);
    if (authorized && runtime.availability !== 'AVAILABLE') {
      throw new ControlPlaneError('RUNTIME_UNAVAILABLE', `cannot authorize a ${runtime.availability} runtime`, 409);
    }
    this.store.transaction(() => {
      this.store.setRuntimeAuthorized(runtime.providerKey, Boolean(authorized));
      this.activity({ operationId: op, eventType: authorized ? 'RUNTIME_AUTHORIZED' : 'RUNTIME_REVOKED', actor: who, objectRef: runtime.providerKey, summary: `${runtime.displayName} authorization set to ${Boolean(authorized)}` });
    });
    return this.store.snapshot();
  }

  createProject(input) {
    const who = requireActor(input.actor);
    if (who.type !== 'human') throw new ControlPlaneError('FORBIDDEN', 'only Human may create a project', 403);
    const ownerId = requireString(input.ownerId, 'ownerId', { max: 128 });
    if (ownerId !== who.id) throw new ControlPlaneError('FORBIDDEN', 'actor must be the declared Human Owner', 403);
    const op = this.assertNewOperation(input.operationId);
    const leadRuntime = this.requireUsableAuthorizedRuntime(input.leadRuntimeKey);
    if (leadRuntime.kind !== 'harness-agent') {
      throw new ControlPlaneError('INVALID_PL_RUNTIME', 'Project Lead must use a Harness Agent runtime in MVP v0.1', 409);
    }
    const requestedWorkerRuntimeKey = typeof input.workerRuntimeKey === 'string'
      ? input.workerRuntimeKey.trim()
      : '';
    const workerRuntime = requestedWorkerRuntimeKey
      ? this.requireUsableAuthorizedRuntime(requestedWorkerRuntimeKey)
      : this.firstUsableAuthorizedRuntime('external-worker');
    if (!workerRuntime) {
      throw new ControlPlaneError(
        'RUNTIME_UNAVAILABLE',
        'authorize an AVAILABLE external-worker runtime before creating the Project',
        409,
      );
    }
    if (workerRuntime.kind !== 'external-worker') {
      throw new ControlPlaneError('INVALID_WORKER_RUNTIME', 'Worker must use an external-worker runtime', 409);
    }
    const projectId = id('PROJECT');
    const leadAgentId = id('AGENT-PL');
    const at = now();
    const workspaceInput = requireString(input.workspaceDir, 'workspaceDir', { max: 2000 });
    if (!isAbsolute(workspaceInput)) {
      throw new ControlPlaneError('INVALID_WORKSPACE', 'workspaceDir must be an absolute path');
    }
    const workspaceDir = resolve(workspaceInput);
    // A usable team always contains one PL, at least one Worker, and one Reviewer.
    // `maxAgents` is selected by the Human during Project creation and becomes the
    // size of the initial team proposal (additional slots are Workers).
    const maxAgents = requireInteger(input.maxAgents ?? 3, 'maxAgents', { min: 3, max: 32 });
    const replanEveryN = requireInteger(input.replanEveryN ?? 5, 'replanEveryN', { min: 1, max: 100 });
    const skillDiscovery = this.store.getSystemState('skill_discovery', { grillMeAvailable: false });
    const interviewMode = skillDiscovery.grillMeAvailable ? 'grill-me' : 'fallback';
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO projects(
        id, name, owner_id, lead_agent_id, lead_runtime_key, worker_runtime_key, workspace_dir, initial_goal,
        charter_version, max_agents, replan_every_n, status, version, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'CHARTER_INTERVIEW', 1, ?, ?)`).run(
        projectId,
        requireString(input.name, 'name', { max: 200 }),
        ownerId,
        leadAgentId,
        leadRuntime.providerKey,
        workerRuntime.providerKey,
        workspaceDir,
        requireString(input.initialGoal, 'initialGoal', { max: 5000 }),
        maxAgents,
        replanEveryN,
        at,
        at,
      );
      this.store.db.prepare(`INSERT INTO agents(
        id, project_id, display_name, provider_key, role, permissions_json, skills_json,
        status, current_task_id, replaces_agent_id, created_at
      ) VALUES(?, ?, ?, ?, 'PROJECT_LEAD', ?, ?, 'PENDING_APPROVAL', NULL, NULL, ?)`).run(
        leadAgentId, projectId, 'Project Lead', leadRuntime.providerKey,
        json(DEFAULT_ROLE_PERMISSIONS.PROJECT_LEAD),
        json(skillDiscovery.grillMeAvailable ? ['grill-me'] : []),
        at,
      );
      this.store.db.prepare(`INSERT INTO project_interviews(project_id, mode, questions_json, answers_json, status, updated_at)
        VALUES(?, ?, ?, '{}', 'OPEN', ?)`).run(projectId, interviewMode, json(FALLBACK_INTERVIEW), at);
      this.activity({
        operationId: op,
        projectId,
        eventType: 'PROJECT_CREATED',
        actor: who,
        objectRef: projectId,
        summary: `Project created with PL runtime ${leadRuntime.providerKey} and Worker runtime ${workerRuntime.providerKey}; ${interviewMode} interview opened`,
        at,
      });
    });
    return this.store.snapshot(projectId);
  }

  answerInterview(input) {
    const project = this.requireProject(input.projectId);
    const who = requireActor(input.actor);
    // R1.2: the PL records interview facts as a proposal. Only the Human Owner
    // recording answers directly counts as Human-supplied facts; a PL recording
    // marks them as PL-proposed and still requires Human Charter approval.
    const isHumanOwner = who.type === 'human' && who.id === project.ownerId;
    const isProjectLead = who.type === 'pl' && who.id === project.leadAgentId;
    if (!isHumanOwner && !isProjectLead) {
      throw new ControlPlaneError('FORBIDDEN', 'only the Human Owner or the assigned PL may record interview answers', 403);
    }
    assertExpectedVersion(project, input.expectedVersion);
    if (project.status !== 'CHARTER_INTERVIEW') throw new ControlPlaneError('INVALID_STATE', 'project is not interviewing', 409);
    const op = this.assertNewOperation(input.operationId);
    const interview = this.store.getInterview(project.id);
    const answers = input.answers ?? {};
    const scopeAllowed = lines(answers.scope_allowed, 'answers.scope_allowed');
    const constraints = lines(answers.constraints, 'answers.constraints');
    const successCriteria = lines(answers.success_criteria, 'answers.success_criteria');
    const scopeForbidden = Array.isArray(answers.scope_forbidden)
      ? requireStringArray(answers.scope_forbidden, 'answers.scope_forbidden', { max: 20 })
      : [];
    const at = now();
    const charterId = id('CHARTER');
    const charterVersion = project.charterVersion + 1;
    const approvalId = id('APPROVAL');
    const userConfirmed = isHumanOwner
      ? { initialGoal: project.initialGoal, scopeAllowed, scopeForbidden, constraints, successCriteria }
      : { initialGoal: project.initialGoal, source: 'pl-proposal-pending-human-approval' };
    const plAssumptions = isHumanOwner
      ? ['未明确的实现细节由 PL 在已批准范围内提出方案，不得扩大 Mission 或权限']
      : ['scope_allowed、scope_forbidden、constraints、success_criteria 由 PL 从对话中整理，尚待 Human 批准'];
    this.store.transaction(() => {
      this.store.db.prepare(`UPDATE project_interviews SET answers_json=?, status='COMPLETED', updated_at=? WHERE project_id=?`).run(json(answers), at, project.id);
      this.store.db.prepare(`INSERT INTO charters(
        id, project_id, version, status, mission, scope_allowed_json, scope_forbidden_json,
        constraints_json, success_criteria_json, user_confirmed_json, pl_assumptions_json, created_at, approved_at
      ) VALUES(?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
        charterId, project.id, charterVersion, project.initialGoal, json(scopeAllowed), json(scopeForbidden),
        json(constraints), json(successCriteria),
        json(userConfirmed),
        json(plAssumptions),
        at,
      );
      this.store.db.prepare(`INSERT INTO approvals(id, project_id, kind, status, payload_json, requested_by, created_at)
        VALUES(?, ?, 'CHARTER', 'PENDING', ?, ?, ?)`).run(
        approvalId, project.id, json({ charterId, charterVersion, interviewMode: interview.mode, source: isHumanOwner ? 'human' : 'pl-proposal' }), project.leadAgentId, at,
      );
      this.store.db.prepare(`UPDATE projects SET status='CHARTER_PENDING_APPROVAL', version=version+1, updated_at=? WHERE id=?`).run(at, project.id);
      this.activity({
        operationId: op, projectId: project.id, eventType: 'CHARTER_DRAFTED', actor: who, objectRef: charterId,
        summary: isHumanOwner
          ? `Charter v${charterVersion} drafted with user-confirmed facts separated from PL assumptions`
          : `Charter v${charterVersion} drafted by the PL from conversation facts; Human approval is still required`,
        at,
      });
    });
    return this.store.snapshot(project.id);
  }

  approveCharter(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertHumanOwner(project, input.actor);
    assertExpectedVersion(project, input.expectedVersion);
    if (project.status !== 'CHARTER_PENDING_APPROVAL') throw new ControlPlaneError('INVALID_STATE', 'project has no Charter awaiting approval', 409);
    const approval = this.store.pendingApproval(project.id, 'CHARTER');
    const charter = this.store.getDraftCharter(project.id);
    if (!approval || !charter) throw new ControlPlaneError('APPROVAL_NOT_FOUND', 'pending Charter approval is missing', 409);
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    const teamApprovalId = id('APPROVAL');
    const external = project.workerRuntimeKey
      ? this.requireUsableAuthorizedRuntime(project.workerRuntimeKey)
      : this.firstUsableAuthorizedRuntime('external-worker');
    if (!external) {
      throw new ControlPlaneError(
        'RUNTIME_UNAVAILABLE',
        'authorize an AVAILABLE external-worker runtime before approving the Charter',
        409,
      );
    }
    if (external.kind !== 'external-worker') {
      throw new ControlPlaneError('INVALID_WORKER_RUNTIME', 'Project Worker runtime must be an external-worker runtime', 409);
    }
    const reviewerRuntime = this.store.listRuntimes().find((runtime) => runtime.providerKey === 'subagent:spawn'
      && runtime.kind === 'external-worker' && runtime.availability === 'AVAILABLE' && runtime.authorized) ?? external;
    const workerCount = project.maxAgents - 2;
    const workers = Array.from({ length: workerCount }, (_unused, index) => ({
      id: id('AGENT-WORKER'),
      displayName: workerCount === 1 ? 'Implementation Worker' : `Implementation Worker ${index + 1}`,
      providerKey: external.providerKey,
      role: 'WORKER',
      permissions: DEFAULT_ROLE_PERMISSIONS.WORKER,
      skills: [],
    }));
    const members = [
      {
        id: project.leadAgentId,
        displayName: 'Project Lead',
        providerKey: project.leadRuntimeKey,
        role: 'PROJECT_LEAD',
        permissions: DEFAULT_ROLE_PERMISSIONS.PROJECT_LEAD,
        skills: this.store.getSystemState('skill_discovery', {}).grillMeAvailable ? ['grill-me'] : [],
      },
      ...workers,
      {
        id: id('AGENT-REVIEWER'), displayName: 'Independent Reviewer',
        providerKey: reviewerRuntime.providerKey, role: 'REVIEWER',
        permissions: DEFAULT_ROLE_PERMISSIONS.REVIEWER, skills: [],
      },
    ];
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE charters SET status='APPROVED', approved_at=? WHERE id=?").run(at, charter.id);
      this.store.db.prepare("UPDATE approvals SET status='APPROVED', decided_by=?, decided_at=? WHERE id=?").run(actorKey(who), at, approval.id);
      this.store.db.prepare(`UPDATE projects SET charter_version=?, worker_runtime_key=?, status='TEAM_PENDING_APPROVAL', version=version+1, updated_at=? WHERE id=?`)
        .run(charter.version, external.providerKey, at, project.id);
      this.store.db.prepare(`INSERT INTO approvals(id, project_id, kind, status, payload_json, requested_by, created_at)
        VALUES(?, ?, 'TEAM', 'PENDING', ?, ?, ?)`).run(teamApprovalId, project.id, json({ members }), project.leadAgentId, at);
      this.activity({ operationId: op, projectId: project.id, eventType: 'CHARTER_APPROVED', actor: who, objectRef: charter.id, summary: `Human approved Charter v${charter.version}; PL proposed a ${members.length}-agent team`, at });
    });
    return this.store.snapshot(project.id);
  }

  normalizeTeam(project, members) {
    if (!Array.isArray(members) || members.length < 3) throw new ControlPlaneError('INVALID_TEAM', 'team must contain one Project Lead, at least one Worker, and one Reviewer');
    if (members.length > project.maxAgents) {
      throw new ControlPlaneError('AGENT_LIMIT_EXCEEDED', `team size ${members.length} exceeds maxAgents ${project.maxAgents}`, 409);
    }
    const seenIds = new Set();
    const normalized = members.map((member, index) => {
      const role = requireString(member.role, `members[${index}].role`, { max: 32 });
      if (!DEFAULT_ROLE_PERMISSIONS[role]) throw new ControlPlaneError('INVALID_ROLE', `unsupported role ${role}`);
      const memberId = requireString(member.id, `members[${index}].id`, { max: 128 });
      if (seenIds.has(memberId)) throw new ControlPlaneError('INVALID_TEAM', `duplicate agent id ${memberId}`);
      seenIds.add(memberId);
      const runtime = this.requireUsableAuthorizedRuntime(member.providerKey);
      if (role === 'PROJECT_LEAD') {
        if (memberId !== project.leadAgentId) throw new ControlPlaneError('INVALID_TEAM', 'team must retain the assigned Project Lead');
        if (runtime.kind !== 'harness-agent' || runtime.providerKey !== project.leadRuntimeKey) {
          throw new ControlPlaneError('INVALID_TEAM_RUNTIME', 'Project Lead must retain the Project Harness runtime', 409);
        }
      } else if (runtime.kind !== 'external-worker') {
        throw new ControlPlaneError('INVALID_TEAM_RUNTIME', `${role} must use an external-worker runtime`, 409);
      }
      // R1.3: permissions are validated as a subset of the frozen role template.
      // Callers (PL or Panel) cannot introduce arbitrary permission strings, and
      // skills never contribute permissions.
      const template = DEFAULT_ROLE_PERMISSIONS[role];
      const permissions = requireStringArray(member.permissions ?? template, `members[${index}].permissions`, { min: 1, max: 32 });
      const outsideTemplate = permissions.filter((permission) => !template.includes(permission));
      if (outsideTemplate.length > 0) {
        throw new ControlPlaneError('INVALID_PERMISSIONS', `members[${index}] permissions outside the ${role} template are not allowed: ${outsideTemplate.join(', ')}`, 403);
      }
      return {
        id: memberId,
        displayName: requireString(member.displayName, `members[${index}].displayName`, { max: 200 }),
        providerKey: runtime.providerKey,
        role,
        permissions,
        skills: requireStringArray(member.skills ?? [], `members[${index}].skills`, { max: 16 }),
        replacesAgentId: member.replacesAgentId ? requireString(member.replacesAgentId, `members[${index}].replacesAgentId`, { max: 128 }) : null,
      };
    });
    if (normalized.filter((item) => item.role === 'PROJECT_LEAD').length !== 1) throw new ControlPlaneError('INVALID_TEAM', 'team requires exactly one Project Lead');
    if (normalized.filter((item) => item.role === 'WORKER').length < 1) throw new ControlPlaneError('INVALID_TEAM', 'team requires at least one Worker');
    if (normalized.filter((item) => item.role === 'REVIEWER').length !== 1) throw new ControlPlaneError('INVALID_TEAM', 'team requires exactly one Reviewer');
    return normalized;
  }

  proposeTeam(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertTeamPlanner(project, input.actor);
    assertExpectedVersion(project, input.expectedVersion);
    if (project.status !== 'TEAM_PENDING_APPROVAL') throw new ControlPlaneError('INVALID_STATE', 'project is not accepting a team proposal', 409);
    const members = this.normalizeTeam(project, input.members);
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE approvals SET status='SUPERSEDED', decided_by=?, decided_at=? WHERE project_id=? AND kind='TEAM' AND status='PENDING'").run(actorKey(who), at, project.id);
      const approvalId = id('APPROVAL');
      this.store.db.prepare(`INSERT INTO approvals(id, project_id, kind, status, payload_json, requested_by, created_at)
        VALUES(?, ?, 'TEAM', 'PENDING', ?, ?, ?)`).run(approvalId, project.id, json({ members }), actorKey(who), at);
      this.store.db.prepare('UPDATE projects SET version=version+1, updated_at=? WHERE id=?').run(at, project.id);
      this.activity({ operationId: op, projectId: project.id, eventType: 'TEAM_PROPOSED', actor: who, objectRef: approvalId, summary: `Team proposal contains ${members.length} member(s)`, at });
    });
    return this.store.snapshot(project.id);
  }

  approveTeam(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertHumanOwner(project, input.actor);
    assertExpectedVersion(project, input.expectedVersion);
    if (project.status !== 'TEAM_PENDING_APPROVAL') throw new ControlPlaneError('INVALID_STATE', 'project has no team awaiting approval', 409);
    const approval = this.store.pendingApproval(project.id, 'TEAM');
    if (!approval) throw new ControlPlaneError('APPROVAL_NOT_FOUND', 'pending team approval is missing', 409);
    const repaired = this.repairStaleWorkerRuntimes(approval.payload.members);
    const members = this.normalizeTeam(project, repaired.members);
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      for (const member of members) {
        if (member.replacesAgentId) {
          const replaced = this.store.db.prepare('SELECT project_id FROM agents WHERE id=?').get(member.replacesAgentId);
          if (!replaced || replaced.project_id !== project.id) throw new ControlPlaneError('INVALID_REPLACEMENT', 'replaced Agent must belong to this project', 409);
        }
        const existing = this.store.db.prepare('SELECT id FROM agents WHERE id=?').get(member.id);
        if (existing) {
          this.store.db.prepare(`UPDATE agents SET display_name=?, provider_key=?, role=?, permissions_json=?, skills_json=?, status='IDLE', replaces_agent_id=? WHERE id=?`).run(
            member.displayName, member.providerKey, member.role, json(member.permissions), json(member.skills), member.replacesAgentId, member.id,
          );
        } else {
          this.store.db.prepare(`INSERT INTO agents(
            id, project_id, display_name, provider_key, role, permissions_json, skills_json,
            status, current_task_id, replaces_agent_id, created_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, 'IDLE', NULL, ?, ?)`).run(
            member.id, project.id, member.displayName, member.providerKey, member.role,
            json(member.permissions), json(member.skills), member.replacesAgentId, at,
          );
        }
      }
      this.store.db.prepare("UPDATE approvals SET status='APPROVED', payload_json=?, decided_by=?, decided_at=? WHERE id=?")
        .run(json({ ...approval.payload, members }), actorKey(who), at, approval.id);
      const effectiveWorkerRuntimeKey = members.find((member) => member.role === 'WORKER')?.providerKey
        ?? project.workerRuntimeKey;
      this.store.db.prepare("UPDATE projects SET status='ACTIVE', worker_runtime_key=?, version=version+1, updated_at=? WHERE id=?")
        .run(effectiveWorkerRuntimeKey, at, project.id);
      const repairSummary = repaired.changed ? `; stale Worker/Reviewer runtime rebound to ${repaired.replacement.providerKey}` : '';
      this.activity({ operationId: op, projectId: project.id, eventType: 'TEAM_APPROVED', actor: who, objectRef: approval.id, summary: `Human approved ${members.length} Agent Record(s); all are idle and no runtime was started${repairSummary}`, at });
    });
    return this.store.snapshot(project.id);
  }

  replaceAgent(input) {
    const project = this.requireProject(input.projectId);
    if (project.status !== 'ACTIVE') throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'Agent replacement requires an ACTIVE project', 409);
    const who = this.assertTeamPlanner(project, input.actor);
    assertExpectedVersion(project, input.expectedVersion);
    const replaced = this.requireProjectAgent(project, input.agentId);
    if (replaced.role === 'PROJECT_LEAD') throw new ControlPlaneError('PL_REPLACEMENT_REQUIRES_CHARTER', 'Project Lead replacement requires a Human-approved Charter/team change', 409);
    if (replaced.status !== 'IDLE' || replaced.currentTaskId) throw new ControlPlaneError('AGENT_OCCUPIED', 'only an idle Agent without a Task may be replaced', 409);
    const providerKey = input.providerKey ?? replaced.providerKey;
    const runtime = this.requireUsableAuthorizedRuntime(providerKey);
    if (runtime.kind !== 'external-worker') {
      throw new ControlPlaneError('INVALID_TEAM_RUNTIME', `${replaced.role} replacement must use an external-worker runtime`, 409);
    }
    const op = this.assertNewOperation(input.operationId);
    const replacementId = id(`AGENT-${replaced.role === 'REVIEWER' ? 'REVIEWER' : 'WORKER'}`);
    const displayName = input.displayName
      ? requireString(input.displayName, 'displayName', { max: 200 })
      : replaced.role === 'REVIEWER'
        ? 'Independent Reviewer'
        : 'Implementation Worker';
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE agents SET status='REPLACED', current_task_id=NULL WHERE id=?").run(replaced.id);
      this.store.db.prepare(`INSERT INTO agents(
        id, project_id, display_name, provider_key, role, permissions_json, skills_json,
        status, current_task_id, replaces_agent_id, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, 'IDLE', NULL, ?, ?)`).run(
        replacementId, project.id, displayName, runtime.providerKey, replaced.role,
        json(replaced.permissions), json(replaced.skills), replaced.id, at,
      );
      this.store.db.prepare('UPDATE projects SET version=version+1, updated_at=? WHERE id=?').run(at, project.id);
      this.activity({
        operationId: op, projectId: project.id, eventType: 'AGENT_REPLACED', actor: who,
        objectRef: replacementId,
        summary: `${replaced.id} retired as REPLACED; new ${replaced.role} identity ${replacementId} created on ${runtime.providerKey}`,
        at,
      });
    });
    return this.store.snapshot(project.id);
  }

  stopProject(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertHumanOwner(project, input.actor);
    assertExpectedVersion(project, input.expectedVersion);
    if (project.status === 'STOPPED') return this.store.snapshot(project.id);
    if (project.status !== 'ACTIVE') throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'only an ACTIVE project may be stopped', 409);
    const activeRun = this.store.listTaskRuns(project.id).find((run) => ['CREATED', 'STARTING', 'RUNNING'].includes(run.status));
    if (activeRun) throw new ControlPlaneError('ACTIVE_RUN_EXISTS', `cancel active Run ${activeRun.id} before stopping the project`, 409);
    const activeReview = this.store.listReviewRuns(project.id).find((run) => ['STARTING', 'RUNNING'].includes(run.status));
    if (activeReview) throw new ControlPlaneError('ACTIVE_REVIEW_RUN_EXISTS', `wait for Review Run ${activeReview.id} before stopping the project`, 409);
    const activeRequestRun = this.store.listRequestRuns(project.id).find((run) => ['STARTING', 'RUNNING'].includes(run.status));
    if (activeRequestRun) throw new ControlPlaneError('ACTIVE_REQUEST_RUN_EXISTS', `wait for Request Run ${activeRequestRun.id} before stopping the project`, 409);
    const op = this.assertNewOperation(input.operationId);
    const reason = requireString(input.reason ?? 'Stopped by Human Owner', 'reason', { max: 2000 });
    const at = now();
    this.store.transaction(() => {
      const cancellable = this.store.listTasks(project.id).filter((task) => ['PENDING', 'READY', 'WAITING'].includes(task.status));
      const openRequests = this.store.listRequests(project.id).filter((request) => ['PENDING', 'IN_PROGRESS'].includes(request.status));
      for (const request of openRequests) {
        this.store.db.prepare("UPDATE requests SET status='REJECTED', resolved_at=? WHERE id=?").run(at, request.id);
        this.activity({
          operationId: `${op}:${request.id}:closed`, projectId: project.id, eventType: 'REQUEST_REJECTED',
          actor: who, objectRef: request.id, summary: 'Open collaboration Request closed because the Project was stopped', at,
        });
      }
      for (const task of cancellable) {
        this.store.db.prepare("UPDATE tasks SET status='CANCELLED', version=version+1, updated_at=? WHERE id=?").run(at, task.id);
        this.addTaskStateEvent({ taskId: task.id, fromStatus: task.status, toStatus: 'CANCELLED', actor: who, reason, at });
      }
      this.store.db.prepare("UPDATE agents SET status='UNAVAILABLE', current_task_id=NULL WHERE project_id=? AND status <> 'REPLACED'").run(project.id);
      this.store.db.prepare("UPDATE projects SET status='STOPPED', version=version+1, updated_at=? WHERE id=?").run(at, project.id);
      this.activity({ operationId: op, projectId: project.id, eventType: 'PROJECT_STOPPED', actor: who, objectRef: project.id, summary: reason, at });
    });
    return this.store.snapshot(project.id);
  }

  resumeProject(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertHumanOwner(project, input.actor);
    assertExpectedVersion(project, input.expectedVersion);
    if (project.status === 'ACTIVE') return this.store.snapshot(project.id);
    if (project.status !== 'STOPPED') {
      throw new ControlPlaneError('PROJECT_NOT_STOPPED', 'only a STOPPED project may be resumed', 409);
    }
    const activeRun = this.store.listTaskRuns(project.id).find((run) => ['CREATED', 'STARTING', 'RUNNING'].includes(run.status));
    if (activeRun) throw new ControlPlaneError('ACTIVE_RUN_EXISTS', `Task Run ${activeRun.id} is still active`, 409);
    const activeReview = this.store.listReviewRuns(project.id).find((run) => ['STARTING', 'RUNNING'].includes(run.status));
    if (activeReview) throw new ControlPlaneError('ACTIVE_REVIEW_RUN_EXISTS', `Review Run ${activeReview.id} is still active`, 409);
    const activeRequestRun = this.store.listRequestRuns(project.id).find((run) => ['STARTING', 'RUNNING'].includes(run.status));
    if (activeRequestRun) throw new ControlPlaneError('ACTIVE_REQUEST_RUN_EXISTS', `Request Run ${activeRequestRun.id} is still active`, 409);
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=NULL WHERE project_id=? AND status <> 'REPLACED'").run(project.id);
      this.store.db.prepare("UPDATE projects SET status='ACTIVE', version=version+1, updated_at=? WHERE id=?").run(at, project.id);
      this.activity({
        operationId: op,
        projectId: project.id,
        eventType: 'PROJECT_RESUMED',
        actor: who,
        objectRef: project.id,
        summary: 'Stopped Project resumed by Human Owner; retained history is unchanged and cancelled Tasks remain cancelled',
        at,
      });
    });
    return this.store.snapshot(project.id);
  }

  completeProject(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertHumanOwner(project, input.actor);
    assertExpectedVersion(project, input.expectedVersion);
    if (project.status === 'COMPLETED') return this.store.snapshot(project.id);
    if (project.status !== 'ACTIVE') throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'only an ACTIVE project may be completed', 409);
    const tasks = this.store.listTasks(project.id);
    const scopedTasks = tasks.filter((task) => task.status !== 'CANCELLED');
    if (scopedTasks.length === 0 || scopedTasks.some((task) => task.status !== 'VERIFIED')) {
      throw new ControlPlaneError('PROJECT_TASKS_INCOMPLETE', 'Project completion requires at least one non-cancelled Task and every non-cancelled Task must be VERIFIED', 409);
    }
    const activeRun = this.store.listTaskRuns(project.id).find((run) => ['CREATED', 'STARTING', 'RUNNING'].includes(run.status));
    if (activeRun) throw new ControlPlaneError('ACTIVE_RUN_EXISTS', `Task Run ${activeRun.id} is still active`, 409);
    const activeReview = this.store.listReviewRuns(project.id).find((run) => ['STARTING', 'RUNNING'].includes(run.status));
    if (activeReview) throw new ControlPlaneError('ACTIVE_REVIEW_RUN_EXISTS', `Review Run ${activeReview.id} is still active`, 409);
    const activeRequestRun = this.store.listRequestRuns(project.id).find((run) => ['STARTING', 'RUNNING'].includes(run.status));
    if (activeRequestRun) throw new ControlPlaneError('ACTIVE_REQUEST_RUN_EXISTS', `Request Run ${activeRequestRun.id} is still active`, 409);
    const openRequest = this.store.listRequests(project.id).find((request) => ['PENDING', 'IN_PROGRESS'].includes(request.status));
    if (openRequest) throw new ControlPlaneError('OPEN_REQUEST_EXISTS', `Request ${openRequest.id} must be resolved before Project completion`, 409);
    const pendingProposal = this.store.listTaskProposals(project.id).find((proposal) => proposal.status === 'PENDING');
    if (pendingProposal) throw new ControlPlaneError('PENDING_TASK_PROPOSAL_EXISTS', `Task Proposal ${pendingProposal.id} must be decided before Project completion`, 409);
    const pendingPlanCheck = this.store.listPlanChecks(project.id).find((check) => check.status === 'PENDING');
    if (pendingPlanCheck) throw new ControlPlaneError('PENDING_PLAN_CHECK_EXISTS', `Plan Check ${pendingPlanCheck.id} must be completed before Project completion`, 409);
    const openFinding = this.store.listFindings(project.id).find((finding) => finding.status !== 'CLOSED');
    if (openFinding) throw new ControlPlaneError('OPEN_FINDING_EXISTS', `Finding ${openFinding.id} must be closed before Project completion`, 409);
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE agents SET status='UNAVAILABLE', current_task_id=NULL WHERE project_id=? AND status <> 'REPLACED'").run(project.id);
      this.store.db.prepare("UPDATE projects SET status='COMPLETED', version=version+1, updated_at=? WHERE id=?").run(at, project.id);
      this.activity({ operationId: op, projectId: project.id, eventType: 'PROJECT_COMPLETED', actor: who, objectRef: project.id, summary: `Human accepted Project completion with ${scopedTasks.length} VERIFIED Task(s)`, at });
    });
    return this.store.snapshot(project.id);
  }

  deleteProject(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertHumanOwner(project, input.actor);
    assertExpectedVersion(project, input.expectedVersion);
    if (project.status === 'ACTIVE') {
      throw new ControlPlaneError('PROJECT_MUST_BE_STOPPED', 'stop the ACTIVE project before deleting it', 409);
    }
    const confirmation = requireString(input.confirmation, 'confirmation', { max: 128 });
    if (confirmation !== project.id) {
      throw new ControlPlaneError('DELETE_CONFIRMATION_MISMATCH', 'confirmation must exactly match the Project ID', 409);
    }
    const activeRun = this.store.listTaskRuns(project.id).find((run) => ['CREATED', 'STARTING', 'RUNNING'].includes(run.status));
    if (activeRun) throw new ControlPlaneError('ACTIVE_RUN_EXISTS', `Task Run ${activeRun.id} is still active`, 409);
    const activeReview = this.store.listReviewRuns(project.id).find((run) => ['STARTING', 'RUNNING'].includes(run.status));
    if (activeReview) throw new ControlPlaneError('ACTIVE_REVIEW_RUN_EXISTS', `Review Run ${activeReview.id} is still active`, 409);
    const activeRequestRun = this.store.listRequestRuns(project.id).find((run) => ['STARTING', 'RUNNING'].includes(run.status));
    if (activeRequestRun) throw new ControlPlaneError('ACTIVE_REQUEST_RUN_EXISTS', `Request Run ${activeRequestRun.id} is still active`, 409);
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      const outcome = this.store.deleteProject(project.id);
      if (outcome.changes !== 1) throw new ControlPlaneError('PROJECT_NOT_FOUND', 'project does not exist', 404);
      // Keep only a minimal global tombstone for replay protection and audit.
      // Workspace files and the Harness conversation are intentionally outside
      // the Control Plane database and are never removed by this operation.
      this.activity({
        operationId: op,
        eventType: 'PROJECT_DELETED',
        actor: who,
        objectRef: project.id,
        summary: `Project record deleted; workspace ${project.workspaceDir} and PL conversation were not modified`,
        at,
      });
    });
    return {
      ...this.store.snapshot(),
      deletedProject: {
        id: project.id,
        name: project.name,
        workspaceDir: project.workspaceDir,
        plSessionId: project.plSessionId,
      },
    };
  }

  assertTaskPlanner(project, actor) {
    const who = requireActor(actor);
    if ((who.type === 'human' && who.id === project.ownerId)
      || (who.type === 'pl' && who.id === project.leadAgentId)) return who;
    throw new ControlPlaneError('FORBIDDEN', 'only the Human Owner or Project Lead may manage formal Tasks', 403);
  }

  assertProjectLead(project, actor) {
    const who = requireActor(actor);
    if (who.type !== 'pl' || who.id !== project.leadAgentId) {
      throw new ControlPlaneError('FORBIDDEN', 'only the assigned Project Lead may perform this Task action', 403);
    }
    return who;
  }

  requireTask(project, taskId) {
    const task = this.store.getTask(requireString(taskId, 'taskId', { max: 128 }));
    if (!task || task.projectId !== project.id) throw new ControlPlaneError('TASK_NOT_FOUND', 'Task does not belong to this project', 404);
    return task;
  }

  requireProjectAgent(project, agentId) {
    const idValue = requireString(agentId, 'agentId', { max: 128 });
    const agent = this.store.listAgents(project.id).find((item) => item.id === idValue);
    if (!agent) throw new ControlPlaneError('AGENT_NOT_FOUND', 'Agent does not belong to this project', 404);
    return agent;
  }

  normalizeTaskDefinition(project, input, existing = undefined) {
    const controlLevel = enumValue(input.controlLevel ?? existing?.controlLevel ?? 'IMPORTANT', 'controlLevel', CONTROL_LEVEL);
    const reviewPolicy = enumValue(
      input.reviewPolicy ?? existing?.reviewPolicy ?? MINIMUM_REVIEW[controlLevel],
      'reviewPolicy', REVIEW_POLICY,
    );
    if (REVIEW_RANK[reviewPolicy] < REVIEW_RANK[MINIMUM_REVIEW[controlLevel]]) {
      throw new ControlPlaneError('REVIEW_POLICY_TOO_WEAK', `${controlLevel} requires at least ${MINIMUM_REVIEW[controlLevel]} review`, 409);
    }
    const scope = input.scope ?? existing?.scope ?? {};
    const dependencies = requireStringArray(input.dependencies ?? existing?.dependencies ?? [], 'dependencies', { max: 64, itemMax: 128 });
    if (new Set(dependencies).size !== dependencies.length) throw new ControlPlaneError('INVALID_DEPENDENCIES', 'dependencies must be unique');
    return {
      title: requireString(input.title ?? existing?.title, 'title', { max: 300 }),
      goal: requireString(input.goal ?? existing?.goal, 'goal', { max: 5000 }),
      scope: {
        allowed: lines(scope.allowed ?? existing?.scope?.allowed, 'scope.allowed'),
        forbidden: optionalLines(scope.forbidden ?? existing?.scope?.forbidden, 'scope.forbidden'),
      },
      acceptance: lines(input.acceptance ?? existing?.acceptance, 'acceptance'),
      dependencies,
      controlLevel,
      reviewPolicy,
      charterVersion: project.charterVersion,
    };
  }

  validateTaskDag(project, candidateId, dependencies) {
    const tasks = this.store.listTasks(project.id);
    const known = new Map(tasks.map((task) => [task.id, task]));
    for (const dependencyId of dependencies) {
      const dependency = known.get(dependencyId);
      if (!dependency) throw new ControlPlaneError('INVALID_DEPENDENCY', `dependency ${dependencyId} does not belong to this project`, 409);
    }
    const graph = new Map(tasks.map((task) => [task.id, [...task.dependencies]]));
    graph.set(candidateId, [...dependencies]);
    const visiting = new Set();
    const visited = new Set();
    const visit = (node) => {
      if (visiting.has(node)) throw new ControlPlaneError('TASK_DAG_CYCLE', `dependency cycle includes ${node}`, 409);
      if (visited.has(node)) return;
      visiting.add(node);
      for (const dependency of graph.get(node) ?? []) visit(dependency);
      visiting.delete(node);
      visited.add(node);
    };
    for (const node of graph.keys()) visit(node);
  }

  dependenciesVerified(projectId, dependencies) {
    return dependencies.every((dependencyId) => this.store.getTask(dependencyId)?.projectId === projectId
      && this.store.getTask(dependencyId)?.status === 'VERIFIED');
  }

  addTaskStateEvent({ taskId, fromStatus, toStatus, actor, reason = null, evidenceRefs = [], at }) {
    this.store.db.prepare(`INSERT INTO task_state_events(
      id, task_id, from_status, to_status, actor_id, reason, evidence_refs_json, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id('TASK-EVENT'), taskId, fromStatus, toStatus, actorKey(actor), reason, json(evidenceRefs), at,
    );
  }

  refreshReadyTasks(projectId, at) {
    const pending = this.store.listTasks(projectId).filter((task) => task.status === 'PENDING');
    for (const task of pending) {
      if (!this.dependenciesVerified(projectId, task.dependencies)) continue;
      this.store.db.prepare("UPDATE tasks SET status='READY', version=version+1, updated_at=? WHERE id=?").run(at, task.id);
      this.addTaskStateEvent({
        taskId: task.id, fromStatus: 'PENDING', toStatus: 'READY',
        actor: { type: 'pl', id: 'dependency-guard' }, reason: 'all dependencies are VERIFIED', at,
      });
    }
  }

  createTask(input) {
    const project = this.requireProject(input.projectId);
    if (project.status !== 'ACTIVE') throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'formal Tasks require an ACTIVE project', 409);
    const who = this.assertTaskPlanner(project, input.actor);
    assertExpectedVersion(project, input.expectedProjectVersion ?? input.expectedVersion);
    const op = this.assertNewOperation(input.operationId);
    let proposal;
    let source = input;
    if (input.proposalId) {
      proposal = this.store.getTaskProposal(requireString(input.proposalId, 'proposalId', { max: 128 }));
      if (!proposal || proposal.projectId !== project.id || proposal.status !== 'PENDING') {
        throw new ControlPlaneError('TASK_PROPOSAL_NOT_PENDING', 'Task Proposal is missing or no longer pending', 409);
      }
      source = { ...proposal.payload, ...input, scope: input.scope ?? proposal.payload.scope };
    }
    const taskId = id('TASK');
    const definition = this.normalizeTaskDefinition(project, source);
    this.validateTaskDag(project, taskId, definition.dependencies);
    const status = this.dependenciesVerified(project.id, definition.dependencies) ? 'READY' : 'PENDING';
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO tasks(
        id, project_id, title, goal, scope_allowed_json, scope_forbidden_json, acceptance_json,
        control_level, review_policy, assigned_agent_id, status, version, charter_version,
        result_id, waiting_reason, waiting_on_ref, checkpoint_ref, waiting_deadline, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`).run(
        taskId, project.id, definition.title, definition.goal, json(definition.scope.allowed),
        json(definition.scope.forbidden), json(definition.acceptance), definition.controlLevel,
        definition.reviewPolicy, status, definition.charterVersion, at, at,
      );
      const insertDependency = this.store.db.prepare('INSERT INTO task_dependencies(task_id, dependency_task_id) VALUES(?, ?)');
      for (const dependencyId of definition.dependencies) insertDependency.run(taskId, dependencyId);
      if (proposal) {
        this.store.db.prepare("UPDATE task_proposals SET status='ACCEPTED', decided_by=?, resulting_task_id=?, decided_at=? WHERE id=?")
          .run(actorKey(who), taskId, at, proposal.id);
      }
      this.store.db.prepare('UPDATE projects SET version=version+1, updated_at=? WHERE id=?').run(at, project.id);
      this.addTaskStateEvent({ taskId, fromStatus: 'CREATED', toStatus: status, actor: who, reason: 'formal Task created', at });
      this.activity({ operationId: op, projectId: project.id, eventType: 'TASK_CREATED', actor: who, objectRef: taskId, summary: `Formal Task created as ${status} at Charter v${definition.charterVersion}`, at });
    });
    return this.store.snapshot(project.id);
  }

  updateTask(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertTaskPlanner(project, input.actor);
    const task = this.requireTask(project, input.taskId);
    assertExpectedVersion(task, input.expectedVersion);
    if (!['PENDING', 'READY'].includes(task.status) || task.assignedAgentId) {
      throw new ControlPlaneError('TASK_NOT_EDITABLE', 'only unassigned PENDING or READY Tasks may be edited', 409);
    }
    const op = this.assertNewOperation(input.operationId);
    const definition = this.normalizeTaskDefinition(project, input, task);
    this.validateTaskDag(project, task.id, definition.dependencies);
    const status = this.dependenciesVerified(project.id, definition.dependencies) ? 'READY' : 'PENDING';
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare(`UPDATE tasks SET title=?, goal=?, scope_allowed_json=?, scope_forbidden_json=?,
        acceptance_json=?, control_level=?, review_policy=?, status=?, version=version+1, updated_at=? WHERE id=?`).run(
        definition.title, definition.goal, json(definition.scope.allowed), json(definition.scope.forbidden),
        json(definition.acceptance), definition.controlLevel, definition.reviewPolicy, status, at, task.id,
      );
      this.store.db.prepare('DELETE FROM task_dependencies WHERE task_id=?').run(task.id);
      const insertDependency = this.store.db.prepare('INSERT INTO task_dependencies(task_id, dependency_task_id) VALUES(?, ?)');
      for (const dependencyId of definition.dependencies) insertDependency.run(task.id, dependencyId);
      if (status !== task.status) this.addTaskStateEvent({ taskId: task.id, fromStatus: task.status, toStatus: status, actor: who, reason: 'dependencies changed', at });
      this.activity({ operationId: op, projectId: project.id, eventType: 'TASK_UPDATED', actor: who, objectRef: task.id, summary: `Task definition updated; state is ${status}`, at });
    });
    return this.store.snapshot(project.id);
  }

  assignTask(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertProjectLead(project, input.actor);
    const task = this.requireTask(project, input.taskId);
    assertExpectedVersion(task, input.expectedVersion);
    if (task.status !== 'READY') throw new ControlPlaneError('TASK_NOT_READY', `Task is ${task.status}; only READY Tasks may be assigned`, 409);
    if (!this.dependenciesVerified(project.id, task.dependencies)) throw new ControlPlaneError('DEPENDENCIES_NOT_VERIFIED', 'all dependencies must be VERIFIED before assignment', 409);
    if (task.assignedAgentId) throw new ControlPlaneError('TASK_ALREADY_ASSIGNED', 'Task already has an active assignee', 409);
    const agent = this.requireProjectAgent(project, input.agentId);
    if (agent.role !== 'WORKER' || !agent.permissions.includes('task:execute-assigned')) {
      throw new ControlPlaneError('AGENT_ROLE_FORBIDDEN', 'assignee must be a Worker with task:execute-assigned', 403);
    }
    if (agent.currentTaskId) throw new ControlPlaneError('AGENT_ALREADY_OCCUPIED', `Agent already holds ${agent.currentTaskId}`, 409);
    if (!['IDLE', 'WAITING'].includes(agent.status)) throw new ControlPlaneError('AGENT_UNAVAILABLE', `Agent is ${agent.status}`, 409);
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE tasks SET assigned_agent_id=?, version=version+1, updated_at=? WHERE id=?').run(agent.id, at, task.id);
      this.store.db.prepare("UPDATE agents SET current_task_id=?, status='IDLE' WHERE id=?").run(task.id, agent.id);
      this.activity({ operationId: op, projectId: project.id, eventType: 'TASK_ASSIGNED', actor: who, objectRef: task.id, summary: `${task.id} assigned to ${agent.id}; runtime not started`, at });
    });
    return this.store.snapshot(project.id);
  }

  unassignTask(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertProjectLead(project, input.actor);
    const task = this.requireTask(project, input.taskId);
    assertExpectedVersion(task, input.expectedVersion);
    if (task.status !== 'READY' || !task.assignedAgentId) throw new ControlPlaneError('TASK_NOT_UNASSIGNABLE', 'only assigned READY Tasks may be unassigned', 409);
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE tasks SET assigned_agent_id=NULL, version=version+1, updated_at=? WHERE id=?').run(at, task.id);
      this.store.db.prepare("UPDATE agents SET current_task_id=NULL, status='IDLE' WHERE id=? AND current_task_id=?").run(task.assignedAgentId, task.id);
      this.activity({ operationId: op, projectId: project.id, eventType: 'TASK_UNASSIGNED', actor: who, objectRef: task.id, summary: `Assignment released before any runtime start`, at });
    });
    return this.store.snapshot(project.id);
  }

  transitionTask(input) {
    const project = this.requireProject(input.projectId);
    const task = this.requireTask(project, input.taskId);
    const who = requireActor(input.actor);
    const planner = (who.type === 'human' && who.id === project.ownerId) || (who.type === 'pl' && who.id === project.leadAgentId);
    const assigned = who.type === 'agent' && who.id === task.assignedAgentId;
    if (!planner && !assigned) throw new ControlPlaneError('FORBIDDEN', 'actor may not transition this Task', 403);
    assertExpectedVersion(task, input.expectedVersion);
    const toStatus = enumValue(input.toStatus, 'toStatus', ['READY', 'RUNNING', 'WAITING', 'SUBMITTED', 'VERIFIED', 'FAILED', 'CANCELLED']);
    if (!TASK_TRANSITIONS[task.status]?.has(toStatus)) {
      throw new ControlPlaneError('INVALID_TASK_TRANSITION', `${task.status} cannot transition to ${toStatus}`, 409);
    }
    if (['VERIFIED', 'READY'].includes(toStatus) && task.status === 'SUBMITTED' && !planner) {
      throw new ControlPlaneError('FORBIDDEN', 'only Human or PL may decide a submitted Task', 403);
    }
    if (toStatus === 'RUNNING') {
      if (!task.assignedAgentId) throw new ControlPlaneError('TASK_UNASSIGNED', 'Task must be assigned before RUNNING', 409);
      if (!this.dependenciesVerified(project.id, task.dependencies)) throw new ControlPlaneError('DEPENDENCIES_NOT_VERIFIED', 'Task dependencies are not all VERIFIED', 409);
    }
    const evidenceRefs = input.evidenceRefs === undefined ? [] : requireStringArray(input.evidenceRefs, 'evidenceRefs', { max: 32, itemMax: 1000 });
    let reason = input.reason ? requireString(input.reason, 'reason', { max: 2000 }) : null;
    if (['WAITING', 'FAILED', 'CANCELLED'].includes(toStatus) || (task.status === 'SUBMITTED' && toStatus === 'READY')) {
      reason = requireString(input.reason, 'reason', { max: 2000 });
    }
    let waiting = null;
    if (toStatus === 'WAITING') {
      waiting = input.waiting ?? {};
      waiting = {
        reason,
        onRef: requireString(waiting.onRef, 'waiting.onRef', { max: 500 }),
        checkpointRef: waiting.checkpointRef ? requireString(waiting.checkpointRef, 'waiting.checkpointRef', { max: 1000 }) : null,
        deadline: waiting.deadline ? requireString(waiting.deadline, 'waiting.deadline', { max: 64 }) : null,
      };
      if (waiting.deadline && Number.isNaN(Date.parse(waiting.deadline))) throw new ControlPlaneError('INVALID_INPUT', 'waiting.deadline must be an ISO date');
    }
    let resultId = task.resultId;
    if (toStatus === 'SUBMITTED') {
      resultId = requireString(input.resultId, 'resultId', { max: 128 });
      if (evidenceRefs.length === 0) throw new ControlPlaneError('EVIDENCE_REQUIRED', 'SUBMITTED requires evidenceRefs', 409);
    }
    if (toStatus === 'VERIFIED') {
      if (!task.resultId || evidenceRefs.length === 0) throw new ControlPlaneError('EVIDENCE_REQUIRED', 'VERIFIED requires a submitted result and evidenceRefs', 409);
      // R2.2: VERIFIED must not bypass the Result/Evidence gates. The submitted
      // Result must exist, be SUCCESS, carry no FAILED evidence, and every
      // referenced evidence must belong to that Result.
      const result = this.store.getResult(task.resultId);
      if (!result) throw new ControlPlaneError('RESULT_NOT_FOUND', 'VERIFIED requires the submitted Result to exist', 409);
      if (result.outcome !== 'SUCCESS') throw new ControlPlaneError('VERIFICATION_INCOMPLETE', 'VERIFIED requires a SUCCESS Result; partial or unverified Results must go through review', 409);
      if (this.store.listEvidence(task.projectId).some((item) => item.resultId === result.id && item.status === 'FAILED')) {
        throw new ControlPlaneError('VERIFICATION_INCOMPLETE', 'VERIFIED requires no FAILED evidence', 409);
      }
      const validEvidence = new Set(result.evidenceRefs);
      if (evidenceRefs.some((ref) => !validEvidence.has(ref))) {
        throw new ControlPlaneError('REVIEW_EVIDENCE_INVALID', 'VERIFIED evidence must belong to the current Result', 409);
      }
      if (task.reviewPolicy === 'REVIEWER_PL') throw new ControlPlaneError('REVIEW_REQUIRED', 'Reviewer + PL records are required', 409);
      if (task.reviewPolicy === 'PL' && !(who.type === 'pl' && who.id === project.leadAgentId)) {
        throw new ControlPlaneError('PL_REVIEW_REQUIRED', 'this Task requires Project Lead review', 409);
      }
    }
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      let assignedAgentId = task.assignedAgentId;
      if (task.status === 'SUBMITTED' && toStatus === 'READY' && assignedAgentId) {
        const agent = this.requireProjectAgent(project, assignedAgentId);
        if (agent.currentTaskId && agent.currentTaskId !== task.id) assignedAgentId = null;
        else this.store.db.prepare("UPDATE agents SET current_task_id=?, status='IDLE' WHERE id=?").run(task.id, agent.id);
      }
      this.store.db.prepare(`UPDATE tasks SET status=?, assigned_agent_id=?, result_id=?,
        waiting_reason=?, waiting_on_ref=?, checkpoint_ref=?, waiting_deadline=?, version=version+1, updated_at=? WHERE id=?`).run(
        toStatus, assignedAgentId, resultId,
        waiting?.reason ?? null, waiting?.onRef ?? null, waiting?.checkpointRef ?? null, waiting?.deadline ?? null,
        at, task.id,
      );
      if (task.assignedAgentId) {
        if (toStatus === 'RUNNING') this.store.db.prepare("UPDATE agents SET status='RUNNING', current_task_id=? WHERE id=?").run(task.id, task.assignedAgentId);
        if (toStatus === 'WAITING') this.store.db.prepare("UPDATE agents SET status='WAITING', current_task_id=? WHERE id=?").run(task.id, task.assignedAgentId);
        if (toStatus === 'READY' && task.status === 'WAITING') this.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=? WHERE id=?").run(task.id, task.assignedAgentId);
        if (['SUBMITTED', 'FAILED', 'CANCELLED', 'VERIFIED'].includes(toStatus)) {
          this.store.db.prepare("UPDATE agents SET status='IDLE', current_task_id=NULL WHERE id=? AND current_task_id=?").run(task.assignedAgentId, task.id);
        }
      }
      this.addTaskStateEvent({ taskId: task.id, fromStatus: task.status, toStatus, actor: who, reason, evidenceRefs, at });
      if (toStatus === 'VERIFIED') this.refreshReadyTasks(project.id, at);
      this.activity({ operationId: op, projectId: project.id, eventType: 'TASK_STATE_CHANGED', actor: who, objectRef: task.id, summary: `${task.status} → ${toStatus}${reason ? `: ${reason}` : ''}`, at });
    });
    return this.store.snapshot(project.id);
  }

  proposeTask(input) {
    const project = this.requireProject(input.projectId);
    if (project.status !== 'ACTIVE') throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'Task Proposals require an ACTIVE project', 409);
    const who = requireActor(input.actor);
    if (who.type !== 'agent') throw new ControlPlaneError('FORBIDDEN', 'Task Proposals must come from a Worker or Reviewer Agent', 403);
    const agent = this.requireProjectAgent(project, who.id);
    if (!['WORKER', 'REVIEWER'].includes(agent.role) || !agent.permissions.includes('task:propose')) {
      throw new ControlPlaneError('FORBIDDEN', 'Agent role does not include task:propose', 403);
    }
    const op = this.assertNewOperation(input.operationId);
    const definition = this.normalizeTaskDefinition(project, input);
    for (const dependencyId of definition.dependencies) this.requireTask(project, dependencyId);
    const proposalId = id('TASK-PROPOSAL');
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO task_proposals(
        id, project_id, proposed_by_agent_id, payload_json, status, decided_by, resulting_task_id, reason, created_at, decided_at
      ) VALUES(?, ?, ?, ?, 'PENDING', NULL, NULL, NULL, ?, NULL)`).run(proposalId, project.id, agent.id, json(definition), at);
      this.activity({ operationId: op, projectId: project.id, eventType: 'TASK_PROPOSED', actor: who, objectRef: proposalId, summary: `${agent.displayName} proposed “${definition.title}”; no formal Task was created`, at });
    });
    return this.store.snapshot(project.id);
  }

  rejectTaskProposal(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertTaskPlanner(project, input.actor);
    const proposal = this.store.getTaskProposal(requireString(input.proposalId, 'proposalId', { max: 128 }));
    if (!proposal || proposal.projectId !== project.id || proposal.status !== 'PENDING') {
      throw new ControlPlaneError('TASK_PROPOSAL_NOT_PENDING', 'Task Proposal is missing or no longer pending', 409);
    }
    const reason = requireString(input.reason, 'reason', { max: 2000 });
    const op = this.assertNewOperation(input.operationId);
    const at = now();
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE task_proposals SET status='REJECTED', decided_by=?, reason=?, decided_at=? WHERE id=?")
        .run(actorKey(who), reason, at, proposal.id);
      this.activity({ operationId: op, projectId: project.id, eventType: 'TASK_PROPOSAL_REJECTED', actor: who, objectRef: proposal.id, summary: reason, at });
    });
    return this.store.snapshot(project.id);
  }

  // R1.2: binding a Project to one specific PL Session is a Human-only action.
  // Every later `agent_team_*` call must prove it runs from exactly this Session.
  bindProjectPlSession(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertHumanOwner(project, input.actor);
    this.assertNewOperation(input.operationId);
    const plSessionId = requireString(input.plSessionId, 'plSessionId', { max: 200 });
    if (['STOPPED', 'COMPLETED'].includes(project.status)) {
      throw new ControlPlaneError('PROJECT_NOT_ACTIVE', 'PL session binding requires a non-terminal project', 409);
    }
    const op = input.operationId;
    const at = now();
    this.store.transaction(() => {
      this.store.setProjectPlSession(project.id, plSessionId, at);
      this.activity({
        operationId: op, projectId: project.id, eventType: 'PL_SESSION_BOUND', actor: who,
        objectRef: plSessionId, summary: `Human bound Project to PL Session ${plSessionId}`, at,
      });
    });
    return this.store.snapshot(project.id);
  }

  // R1.4: Host verification commands are Human-approved per Project. The PL may
  // only select approved command IDs; free text never reaches PowerShell.
  approveVerificationCommand(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertHumanOwner(project, input.actor);
    this.assertNewOperation(input.operationId);
    const command = requireString(input.command, 'command', { max: 4000 });
    const timeoutMs = requireInteger(input.timeoutMs ?? 120000, 'timeoutMs', { min: 1000, max: 300000 });
    const op = input.operationId;
    const commandId = id('VCMD');
    const at = now();
    this.store.transaction(() => {
      this.store.insertVerificationCommand({
        id: commandId, projectId: project.id,
        displayName: requireString(input.displayName ?? command.slice(0, 60), 'displayName', { max: 200 }),
        command, timeoutMs, status: 'APPROVED',
        createdBy: actorKey(who), createdAt: at, approvedAt: at,
      });
      this.activity({
        operationId: op, projectId: project.id, eventType: 'VERIFICATION_COMMAND_APPROVED', actor: who,
        objectRef: commandId, summary: `Human approved verification command: ${command}`, at,
      });
    });
    return this.store.snapshot(project.id);
  }

  revokeVerificationCommand(input) {
    const project = this.requireProject(input.projectId);
    const who = this.assertHumanOwner(project, input.actor);
    this.assertNewOperation(input.operationId);
    const record = this.store.getVerificationCommand(project.id, requireString(input.commandId, 'commandId', { max: 128 }));
    if (!record) throw new ControlPlaneError('VERIFICATION_COMMAND_NOT_FOUND', 'verification command does not exist in this project', 404);
    if (record.status === 'REVOKED') return this.store.snapshot(project.id);
    const op = input.operationId;
    const at = now();
    this.store.transaction(() => {
      this.store.setVerificationCommandStatus(record.id, 'REVOKED', at);
      this.activity({
        operationId: op, projectId: project.id, eventType: 'VERIFICATION_COMMAND_REVOKED', actor: who,
        objectRef: record.id, summary: `Human revoked verification command: ${record.command}`, at,
      });
    });
    return this.store.snapshot(project.id);
  }

  // Resolves PL/Panel-selected verification command IDs to the Project's
  // approved whitelist. Unknown or revoked IDs fail closed before any Run is created.
  resolveVerificationCommands(projectId, commandIds) {
    const ids = requireStringArray(commandIds ?? [], 'verification_command_ids', { max: 8, itemMax: 128 });
    return ids.map((commandId) => {
      const record = this.store.getVerificationCommand(projectId, commandId);
      if (!record) throw new ControlPlaneError('VERIFICATION_COMMAND_NOT_FOUND', `verification command ${commandId} does not exist in this project`, 404);
      if (record.status !== 'APPROVED') throw new ControlPlaneError('VERIFICATION_COMMAND_NOT_APPROVED', `verification command ${commandId} is ${record.status}`, 403);
      return { command: record.command, timeoutMs: record.timeoutMs };
    });
  }

  activityPage(input) {
    const project = this.requireProject(input.projectId);
    const cursor = input.cursor?.createdAt && input.cursor?.id ? {
      createdAt: requireString(input.cursor.createdAt, 'cursor.createdAt', { max: 64 }),
      id: requireString(input.cursor.id, 'cursor.id', { max: 128 }),
    } : null;
    const result = this.store.listActivityPage({
      projectId: project.id,
      limit: Math.max(1, Math.min(100, Number(input.limit) || 50)),
      cursor,
      actorId: input.actorId ? requireString(input.actorId, 'actorId', { max: 128 }) : '',
      eventType: input.eventType ? requireString(input.eventType, 'eventType', { max: 128 }) : '',
      taskId: input.taskId ? requireString(input.taskId, 'taskId', { max: 128 }) : '',
    });
    return { ...result, facets: this.store.activityFacets(project.id) };
  }

  snapshot(projectId) {
    return this.store.snapshot(projectId);
  }
}
