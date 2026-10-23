import { randomUUID } from 'node:crypto';
import { ControlPlaneError } from '../shared/contracts.js';

const STRING_OUTPUT = Object.freeze({
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
});

function operationId(action) {
  return `pl-tool:${action}:${randomUUID()}`;
}

// R1.2: every `agent_team_*` call must prove it comes from the exact live Agent
// Session that the Human bound to this Project as its PL. Ordinary sessions,
// other projects' PL sessions, stale bindings, and missing agents are rejected
// before any parent binding or other side effect is created.
function authorizePlSession({ controlPlane, store, adapters }, projectId, exec) {
  const agent = exec?.agent;
  if (!agent || typeof agent.id !== 'string' || !agent.id) {
    throw new ControlPlaneError('PL_AGENT_REQUIRED', 'agent_team_* tools require a live executing Agent context', 401);
  }
  if (!adapters.isLiveParent(agent)) {
    throw new ControlPlaneError('PL_AGENT_NOT_LIVE', 'executing Agent is not registered in the live Host Agent registry', 401);
  }
  const project = controlPlane.requireProject(projectId);
  if (!project.plSessionId) {
    throw new ControlPlaneError('PL_SESSION_NOT_BOUND', 'Project has no bound PL Session; the Human Owner must bind it in the control console first', 403);
  }
  if (agent.id !== project.plSessionId) {
    throw new ControlPlaneError('PL_SESSION_MISMATCH', 'this Agent Session is not the PL Session bound to this Project', 403);
  }
  const plRecord = store.listAgents(project.id).find((item) => item.id === project.leadAgentId);
  if (!plRecord || plRecord.role !== 'PROJECT_LEAD') {
    throw new ControlPlaneError('PL_AGENT_REPLACED', 'the Project Lead record is missing from this Project', 403);
  }
  if (plRecord.status === 'REPLACED') {
    throw new ControlPlaneError('PL_AGENT_REPLACED', 'this Project Lead was replaced; the bound Session is no longer authorized', 403);
  }
  return project;
}

function defineBridgeTool(options) {
  const required = [];
  const properties = {};
  for (const [name, specification] of Object.entries(options.parameters)) {
    const { required: isRequired, ...schema } = specification;
    properties[name] = schema;
    if (isRequired === true) required.push(name);
  }
  return {
    ...options,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

function selectedState(snapshot) {
  const selected = snapshot.selected;
  if (!selected) return { project: null };
  return {
    project: selected.project,
    interview: selected.interview,
    charter: selected.charters.at(-1) ?? null,
    pendingApprovals: selected.approvals.filter((item) => item.status === 'PENDING'),
    agents: selected.agents,
    tasks: selected.tasks,
    taskRuns: selected.taskRuns,
    results: selected.results,
    evidence: selected.evidence,
    reviews: selected.reviews,
    reviewRuns: selected.reviewRuns,
    findings: selected.findings,
    planChecks: selected.planChecks,
    recentActivity: selected.activities.slice(-20),
  };
}

function renderState(snapshot) {
  return JSON.stringify(selectedState(snapshot));
}

function projectFor(controlPlane, projectId) {
  return controlPlane.requireProject(projectId);
}

function projectTool({ name, description, parameters, execute, bindParent, services }) {
  return defineBridgeTool({
    name,
    description,
    parameters,
    output: STRING_OUTPUT,
    async execute(args, exec) {
      // Authorization must succeed before any parent binding or business call;
      // a rejected call leaves no side effect.
      authorizePlSession(services, args.project_id, exec);
      if (args.project_id && exec?.agent) bindParent?.(args.project_id, exec.agent);
      const snapshot = await execute(args, exec);
      return renderState(snapshot);
    },
  });
}

export function createPLBridgeTools({ controlPlane, coordinator, governance, store, adapters }) {
  const bindParent = (projectId, parent) => adapters?.bindProjectParent(projectId, parent);
  const services = { controlPlane, coordinator, governance, store, adapters };
  return [
    projectTool({
      name: 'agent_team_project_state',
      description: 'Read the authoritative Agent Team Control Plane state for one Project. Call this before claiming any Charter, approval, Task, Run, review, or completion state.',
      parameters: {
        project_id: { type: 'string', required: true, description: 'Project ID from the PL conversation bootstrap prompt.' },
      },
      bindParent,
      services,
      execute(args) {
        return controlPlane.snapshot(args.project_id);
      },
    }),
    projectTool({
      name: 'agent_team_record_interview',
      description: 'Record the interview answers you collected from the Human in this PL conversation and create the Charter draft. This records a PL proposal only: it never approves the Charter and never fabricates a Human confirmation. After calling it, direct the Human to approve the pending Charter in the Agent Team control console.',
      parameters: {
        project_id: { type: 'string', required: true },
        scope_allowed: { type: 'array', required: true, items: { type: 'string' } },
        scope_forbidden: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', required: true, items: { type: 'string' } },
        success_criteria: { type: 'array', required: true, items: { type: 'string' } },
      },
      bindParent,
      services,
      execute(args) {
        const project = projectFor(controlPlane, args.project_id);
        return controlPlane.answerInterview({
          actor: { type: 'pl', id: project.leadAgentId },
          operationId: operationId('record-interview'),
          projectId: project.id,
          expectedVersion: project.version,
          answers: {
            scope_allowed: args.scope_allowed,
            scope_forbidden: args.scope_forbidden ?? [],
            constraints: args.constraints,
            success_criteria: args.success_criteria,
          },
        });
      },
    }),
    projectTool({
      name: 'agent_team_create_task',
      description: 'Create one formal Task in an ACTIVE Project as its assigned PL. Use returned Task IDs to build dependency chains. Do not directly implement the Task in the PL conversation.',
      parameters: {
        project_id: { type: 'string', required: true },
        title: { type: 'string', required: true },
        goal: { type: 'string', required: true },
        scope_allowed: { type: 'array', required: true, items: { type: 'string' }, description: 'Workspace-relative glob paths only (e.g. "src/**"). Host matches actual file changes against these globs; prose descriptions cause out-of-scope FAILED evidence.' },
        scope_forbidden: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative glob paths that must never be touched (e.g. "secrets/**").' },
        acceptance: { type: 'array', required: true, items: { type: 'string' } },
        dependency_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of prerequisite Tasks that must be VERIFIED first.' },
        control_level: { type: 'string', enum: ['ROUTINE', 'IMPORTANT', 'CRITICAL'] },
        review_policy: { type: 'string', enum: ['AUTO', 'PL', 'REVIEWER_PL'] },
      },
      bindParent,
      services,
      execute(args) {
        // Guard against silently-dropped argument aliases: passing the wrong
        // key (e.g. `dependencies` instead of `dependency_ids`) previously
        // vanished without a trace, building Tasks with missing edges.
        if (args.dependencies !== undefined) {
          throw new ControlPlaneError('INVALID_INPUT', 'use dependency_ids (not dependencies); unknown argument names are not accepted', 400);
        }
        const project = projectFor(controlPlane, args.project_id);
        return controlPlane.createTask({
          actor: { type: 'pl', id: project.leadAgentId },
          operationId: operationId('create-task'),
          projectId: project.id,
          expectedProjectVersion: project.version,
          title: args.title,
          goal: args.goal,
          scope: { allowed: args.scope_allowed, forbidden: args.scope_forbidden ?? [] },
          acceptance: args.acceptance,
          dependencies: args.dependency_ids ?? [],
          controlLevel: args.control_level ?? 'IMPORTANT',
          reviewPolicy: args.review_policy,
        });
      },
    }),
    projectTool({
      name: 'agent_team_assign_task',
      description: 'Assign a READY formal Task to an idle Worker Agent. Omit worker_agent_id to use the first eligible Worker in the Project.',
      parameters: {
        project_id: { type: 'string', required: true },
        task_id: { type: 'string', required: true },
        worker_agent_id: { type: 'string' },
      },
      bindParent,
      services,
      execute(args) {
        const project = projectFor(controlPlane, args.project_id);
        const task = controlPlane.requireTask(project, args.task_id);
        const worker = args.worker_agent_id
          ? controlPlane.requireProjectAgent(project, args.worker_agent_id)
          : store.listAgents(project.id).find((item) => item.role === 'WORKER' && ['IDLE', 'WAITING'].includes(item.status) && !item.currentTaskId);
        if (!worker) throw new Error('No idle Worker Agent is available');
        return controlPlane.assignTask({
          actor: { type: 'pl', id: project.leadAgentId },
          operationId: operationId('assign-task'),
          projectId: project.id,
          taskId: task.id,
          expectedVersion: task.version,
          agentId: worker.id,
        });
      },
    }),
    projectTool({
      name: 'agent_team_start_task_run',
      description: 'Start the assigned READY Task as a one-shot Worker Run. Verification commands must already be Human-approved in this Project; pass only their command IDs (see agent_team_project_state verificationCommands). The Worker, Host verification, Result, and evidence remain authoritative; wait and re-read project state instead of editing files in the PL conversation.',
      parameters: {
        project_id: { type: 'string', required: true },
        task_id: { type: 'string', required: true },
        verification_command_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of Human-approved project verification commands to execute on the Host.' },
        write_intent: { type: 'boolean' },
      },
      bindParent,
      services,
      async execute(args, exec) {
        const project = projectFor(controlPlane, args.project_id);
        const task = controlPlane.requireTask(project, args.task_id);
        if (args.verification_commands !== undefined) {
          throw new ControlPlaneError('VERIFICATION_COMMANDS_REJECTED', 'free-text verification commands are not accepted; select approved verification_command_ids', 400);
        }
        return coordinator.startTaskRun({
          actor: { type: 'pl', id: project.leadAgentId },
          operationId: operationId('start-task-run'),
          projectId: project.id,
          taskId: task.id,
          expectedVersion: task.version,
          verificationCommands: controlPlane.resolveVerificationCommands(project.id, args.verification_command_ids),
          writeIntent: args.write_intent ?? true,
          signal: exec?.signal,
          parentAgent: exec?.agent,
        });
      },
    }),
    projectTool({
      name: 'agent_team_request_review',
      description: 'Start a real independent Reviewer Run for a SUBMITTED REVIEWER_PL Task. Wait for it to finish, then re-read Project state before the PL decision.',
      parameters: {
        project_id: { type: 'string', required: true },
        task_id: { type: 'string', required: true },
      },
      bindParent,
      services,
      execute(args, exec) {
        const project = projectFor(controlPlane, args.project_id);
        return governance.requestIndependentReview({
          actor: { type: 'pl', id: project.leadAgentId },
          operationId: operationId('request-review'),
          taskId: args.task_id,
          parentAgent: exec?.agent,
        });
      },
    }),
    projectTool({
      name: 'agent_team_review_task',
      description: 'Submit the PL review for a SUBMITTED Task using its authoritative Result evidence. For REVIEWER_PL policy, the independent Reviewer must approve first.',
      parameters: {
        project_id: { type: 'string', required: true },
        task_id: { type: 'string', required: true },
        decision: { type: 'string', required: true, enum: ['APPROVE', 'REJECT'] },
        issues: { type: 'array', items: { type: 'string' } },
      },
      bindParent,
      services,
      execute(args) {
        const project = projectFor(controlPlane, args.project_id);
        const task = controlPlane.requireTask(project, args.task_id);
        const result = task.resultId ? store.getResult(task.resultId) : null;
        if (!result) throw new Error('Task has no submitted Result');
        return governance.submitReview({
          actor: { type: 'pl', id: project.leadAgentId },
          operationId: operationId('review-task'),
          taskId: task.id,
          decision: args.decision,
          issues: args.issues ?? [],
          evidenceRefs: result.evidenceRefs,
        });
      },
    }),
  ];
}

export function installPLBridge(ctx, services) {
  const disposers = [];
  const register = (disposer) => {
    if (typeof disposer === 'function') disposers.push(disposer);
  };
  for (const tool of createPLBridgeTools(services)) register(ctx.tools.register(tool));
  register(ctx.systemPrompt.section({
    name: 'agent-team-control-plane:pl-policy',
    order: ctx.systemPrompt.getSectionOrder('TEAM_POLICY'),
    text: `When a conversation bootstrap identifies you as an Agent Team Control Plane Project Lead, the Control Plane is the source of truth. These tools only work from the PL Session the Human bound to this Project. Call agent_team_project_state before describing status. Record the interview answers you collected with agent_team_record_interview as a PL proposal, then wait for Human approval in the control console. Create, assign, and start formal work only with agent_team_* tools; verification commands must be Human-approved IDs, not free text. For REVIEWER_PL Tasks, call agent_team_request_review and wait for the independent Reviewer decision before calling agent_team_review_task. Do not edit project files or run implementation commands from the PL conversation. Do not claim a Charter, Task, Run, review, or completion exists unless the latest tool result contains it.`,
  }));
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
