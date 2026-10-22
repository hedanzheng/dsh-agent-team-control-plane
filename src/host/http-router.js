import { ControlPlaneError } from '../shared/contracts.js';

// R1.1: every read and write on the Panel route must pass Host connection
// admission before the snapshot or request body is touched. Human authority
// comes exclusively from the authenticated owner Peer; HTTP body `actor` fields
// can only select a role the admitted owner is already entitled to act in for
// the target project, and their IDs are always clamped to project records.
// Loopback is never treated as an identity substitute.

const MAX_BODY_BYTES = 1024 * 1024;
const OWNER_FALLBACK_ID = 'local-owner';

function sendJson(response, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ControlPlaneError('PAYLOAD_TOO_LARGE', 'request exceeds 1 MiB', 413);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ControlPlaneError('INVALID_JSON', 'request body must be valid UTF-8 JSON');
  }
}

function errorPayload(error) {
  if (error instanceof ControlPlaneError) {
    return { status: error.status, body: { ok: false, error: { code: error.code, message: error.message, details: error.details } } };
  }
  return { status: 500, body: { ok: false, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } } };
}

function ownerIdentity(peer) {
  const candidate = peer?.principal?.id ?? peer?.id;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, 128) : OWNER_FALLBACK_ID;
}

function isOwnerPrincipal(peer) {
  const principal = peer?.principal;
  if (!principal) return false;
  // R0 (TYPE): the authenticated browser principal is { kind: 'owner' }.
  return principal.kind === undefined ? true : principal.kind === 'owner';
}

async function admitRequest(connection, request) {
  if (!connection || typeof connection.admit !== 'function') {
    throw new ControlPlaneError('AUTH_UNAVAILABLE', 'Host connection admission is unavailable', 503);
  }
  // Host contract (dsh-client-connection): admit() resolves to an admission
  // envelope — `{ peer }` on success, `{ rejection: 401 | 403 }` when the
  // request is untrusted or unauthenticated — and never throws for those
  // cases. Unwrap the envelope; a legacy bare-Peer return is still accepted.
  let admission;
  try {
    admission = await connection.admit(request);
  } catch {
    throw new ControlPlaneError('UNAUTHENTICATED', 'request was not admitted by the Host connection service', 401);
  }
  if (!admission || typeof admission !== 'object') {
    throw new ControlPlaneError('UNAUTHENTICATED', 'request was not admitted by the Host connection service', 401);
  }
  if (admission.rejection === 403) {
    throw new ControlPlaneError('FORBIDDEN', 'request origin is not trusted by the Host connection service', 403);
  }
  if (admission.rejection !== undefined) {
    throw new ControlPlaneError('UNAUTHENTICATED', 'request was not admitted by the Host connection service', 401);
  }
  const peer = admission.peer ?? admission;
  if (!peer || !isOwnerPrincipal(peer)) {
    throw new ControlPlaneError('FORBIDDEN', 'only the authenticated local owner may use the control plane route', 403);
  }
  return peer;
}

function projectScopedActor(controlPlane, body) {
  // Load the target project first so every identity is clamped to its records.
  const project = controlPlane.requireProject(body.projectId);
  const declared = body.actor;
  if (!declared || (declared.type !== 'pl' && declared.type !== 'agent')) {
    return { actor: { type: 'human', id: project.ownerId }, project };
  }
  if (declared.type === 'pl') {
    if (declared.id !== undefined && declared.id !== project.leadAgentId) {
      throw new ControlPlaneError('FORBIDDEN', 'declared PL identity does not match this project', 403);
    }
    return { actor: { type: 'pl', id: project.leadAgentId }, project };
  }
  const declaredId = typeof declared.id === 'string' ? declared.id : '';
  const member = controlPlane.store.listAgents(project.id).find((agent) => agent.id === declaredId);
  if (!member) throw new ControlPlaneError('FORBIDDEN', 'declared Agent identity is not a member of this project', 403);
  return { actor: { type: 'agent', id: member.id }, project };
}

function runScopedActor(controlPlane, body) {
  const run = controlPlane.store.getTaskRun(typeof body.runId === 'string' ? body.runId : '');
  if (!run) throw new ControlPlaneError('RUN_NOT_FOUND', 'Task Run does not exist', 404);
  const task = controlPlane.store.getTask(run.taskId);
  if (!task) throw new ControlPlaneError('TASK_NOT_FOUND', 'Task for this Run does not exist', 404);
  return projectScopedActor(controlPlane, { ...body, projectId: task.projectId });
}

export function createControlPlaneHttpHandler({ controlPlane, coordinator, governance, connection, logger }) {
  return async function handler(request, response) {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const connectionAvailable = connection && typeof connection.admit === 'function';

      if (request.method === 'GET') {
        // Fail closed behind admission. Read-only fallback is permitted only
        // when the Host truly provides no connection service.
        if (connectionAvailable) await admitRequest(connection, request);
        sendJson(response, 200, { ok: true, data: controlPlane.snapshot(url.searchParams.get('projectId') ?? undefined) });
        return;
      }
      if (request.method !== 'POST') {
        response.setHeader('allow', 'GET, POST');
        sendJson(response, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'use GET or POST' } });
        return;
      }
      if (!connectionAvailable) {
        // R1.1 fallback mode: without authenticated admission all writes are
        // disabled; the Panel is read-only and PL high-privilege tool calls
        // fail closed at their own session-binding check.
        sendJson(response, 503, { ok: false, error: { code: 'AUTH_UNAVAILABLE', message: 'sensitive writes are disabled because the Host connection service is unavailable' } });
        return;
      }
      const peer = await admitRequest(connection, request);
      const contentType = String(request.headers?.['content-type'] ?? '');
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new ControlPlaneError('UNSUPPORTED_MEDIA_TYPE', 'POST requires Content-Type application/json', 415);
      }
      const body = await readJson(request);
      const owner = { type: 'human', id: ownerIdentity(peer) };

      let data;
      switch (body.action) {
        // Global actions: only the authenticated owner, no body identity.
        case 'rescan-runtimes': {
          const input = { ...body, actor: owner, cwd: body.cwd };
          data = await controlPlane.rescanRuntimes(input);
          break;
        }
        case 'authorize-runtime': {
          const input = { ...body, actor: owner };
          data = controlPlane.authorizeRuntime(input);
          break;
        }
        case 'create-project': {
          // Single-owner model: the authenticated owner is the project owner.
          const input = { ...body, actor: owner, ownerId: owner.id };
          data = controlPlane.createProject(input);
          break;
        }
        case 'bind-project-pl-session': {
          const { actor } = projectScopedActor(controlPlane, body);
          data = controlPlane.bindProjectPlSession({ ...body, actor });
          break;
        }
        case 'approve-verification-command': {
          const { actor } = projectScopedActor(controlPlane, body);
          data = controlPlane.approveVerificationCommand({ ...body, actor });
          break;
        }
        case 'revoke-verification-command': {
          const { actor } = projectScopedActor(controlPlane, body);
          data = controlPlane.revokeVerificationCommand({ ...body, actor });
          break;
        }
        case 'start-task-run': {
          const { actor, project } = projectScopedActor(controlPlane, body);
          if (body.verificationCommands !== undefined) {
            throw new ControlPlaneError('VERIFICATION_COMMANDS_REJECTED', 'free-text verification commands are not accepted; approve a project command and pass verification_command_ids', 400);
          }
          const verificationCommands = controlPlane.resolveVerificationCommands(project.id, body.verification_command_ids);
          data = coordinator.startTaskRun({ ...body, actor, verificationCommands, verification_command_ids: undefined });
          break;
        }
        case 'answer-interview': data = controlPlane.answerInterview({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'approve-charter': data = controlPlane.approveCharter({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'propose-team': data = controlPlane.proposeTeam({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'approve-team': data = controlPlane.approveTeam({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'replace-agent': data = controlPlane.replaceAgent({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'complete-project': data = controlPlane.completeProject({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'stop-project': data = controlPlane.stopProject({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'resume-project': data = controlPlane.resumeProject({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'create-task': data = controlPlane.createTask({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'update-task': data = controlPlane.updateTask({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'assign-task': data = controlPlane.assignTask({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'unassign-task': data = controlPlane.unassignTask({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'transition-task': data = controlPlane.transitionTask({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'propose-task': data = controlPlane.proposeTask({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'reject-task-proposal': data = controlPlane.rejectTaskProposal({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'cancel-task-run': {
          const { actor } = runScopedActor(controlPlane, body);
          data = coordinator.cancelTaskRun({ ...body, actor });
          break;
        }
        case 'respond-request': data = governance.respondRequest({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'submit-review': data = governance.submitReview({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'request-review': data = governance.requestIndependentReview({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'report-finding': data = governance.reportFinding({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'update-finding': data = governance.updateFinding({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'complete-plan-check': data = governance.completePlanCheck({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        case 'record-decision': data = governance.recordDecision({ ...body, ...projectScopedActor(controlPlane, body) }); break;
        default: throw new ControlPlaneError('UNKNOWN_ACTION', 'unknown action');
      }
      sendJson(response, 200, { ok: true, data });
    } catch (error) {
      const failure = errorPayload(error);
      if (failure.status === 500) logger?.error?.(`agent-team-control-plane request failed: ${failure.body.error.message}`);
      sendJson(response, failure.status, failure.body);
    }
  };
}
