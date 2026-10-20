import { join } from 'node:path';
import { AgentTeamControlPlane } from './control-plane.js';
import { HostRuntimeScanner } from './runtime-scan.js';
import { ControlPlaneStore } from './store.js';
import { RuntimeAdapterRegistry } from './runtime-adapter.js';
import { TaskRunCoordinator } from './run-coordinator.js';
import { CollaborationGovernance } from './governance.js';
import { ControlPlaneError } from '../shared/contracts.js';
import { installPLBridge } from './pl-bridge.js';

export const name = 'agent-team-control-plane';
export const inject = ['webServer', 'llm', 'subagents', 'skills', 'tools', 'systemPrompt'];

const ROUTE = '/agent-team-control-plane/v1';
const MAX_BODY_BYTES = 1024 * 1024;

function databasePath() {
  const home = process.env.DSH_HOME?.trim();
  if (!home) throw new Error('agent-team-control-plane: DSH_HOME is required');
  return join(home, 'agent-team-control-plane', 'control-plane.sqlite');
}

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

export async function apply(ctx) {
  const store = new ControlPlaneStore(databasePath());
  const scanner = new HostRuntimeScanner(ctx);
  const controlPlane = new AgentTeamControlPlane(store, scanner);
  const adapters = new RuntimeAdapterRegistry(ctx, store);
  const governance = new CollaborationGovernance({ store, controlPlane, adapters, logger: ctx.logger });
  const coordinator = new TaskRunCoordinator({ store, controlPlane, adapters, governance, logger: ctx.logger });
  const disposePLBridge = installPLBridge(ctx, { controlPlane, coordinator, governance, store, adapters });

  try {
    const initial = await scanner.scan(process.cwd());
    store.transaction(() => {
      for (const runtime of initial.runtimes) store.upsertRuntime(runtime);
      store.markUnseenRuntimesUnavailable(new Set(initial.runtimes.map((item) => item.providerKey)), initial.scannedAt);
      store.setSystemState('skill_discovery', initial.skillDiscovery, initial.scannedAt);
      store.setSystemState('runtime_scan', { scannedAt: initial.scannedAt, errors: initial.errors }, initial.scannedAt);
    });
  } catch (error) {
    ctx.logger.warn(`agent-team-control-plane: initial runtime scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const recoveredRuns = coordinator.recoverInterruptedRuns();
  store.setSystemState('runtime_adapters', adapters.listAvailableRuntimes(), new Date().toISOString());
  store.setSystemState('task_run_recovery', { recoveredRuns }, new Date().toISOString());
  coordinator.startWatchdog();
  const requestTimer = setInterval(() => {
    try { governance.timeoutExpiredRequests(); governance.dispatchPendingRequests(); }
    catch (error) { ctx.logger.warn(`agent-team-control-plane request timeout check failed: ${error instanceof Error ? error.message : String(error)}`); }
  }, 1000);
  requestTimer.unref?.();

  ctx.effect(() => async () => {
    clearInterval(requestTimer);
    disposePLBridge();
    await governance.close();
    await coordinator.close();
    store.close();
  }, 'agent-team-control-plane.store');

  return ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    async handler(request, response) {
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (request.method === 'GET') {
          sendJson(response, 200, { ok: true, data: controlPlane.snapshot(url.searchParams.get('projectId') ?? undefined) });
          return;
        }
        if (request.method !== 'POST') {
          response.setHeader('allow', 'GET, POST');
          sendJson(response, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'use GET or POST' } });
          return;
        }
        const body = await readJson(request);
        let data;
        switch (body.action) {
          case 'rescan-runtimes': data = await controlPlane.rescanRuntimes(body); break;
          case 'authorize-runtime': data = controlPlane.authorizeRuntime(body); break;
          case 'create-project': data = controlPlane.createProject(body); break;
          case 'answer-interview': data = controlPlane.answerInterview(body); break;
          case 'approve-charter': data = controlPlane.approveCharter(body); break;
          case 'propose-team': data = controlPlane.proposeTeam(body); break;
          case 'approve-team': data = controlPlane.approveTeam(body); break;
          case 'replace-agent': data = controlPlane.replaceAgent(body); break;
          case 'stop-project': data = controlPlane.stopProject(body); break;
          case 'create-task': data = controlPlane.createTask(body); break;
          case 'update-task': data = controlPlane.updateTask(body); break;
          case 'assign-task': data = controlPlane.assignTask(body); break;
          case 'unassign-task': data = controlPlane.unassignTask(body); break;
          case 'transition-task': data = controlPlane.transitionTask(body); break;
          case 'propose-task': data = controlPlane.proposeTask(body); break;
          case 'reject-task-proposal': data = controlPlane.rejectTaskProposal(body); break;
          case 'start-task-run': data = coordinator.startTaskRun(body); break;
          case 'cancel-task-run': data = coordinator.cancelTaskRun(body); break;
          case 'respond-request': data = governance.respondRequest(body); break;
          case 'submit-review': data = governance.submitReview(body); break;
          case 'report-finding': data = governance.reportFinding(body); break;
          case 'update-finding': data = governance.updateFinding(body); break;
          case 'complete-plan-check': data = governance.completePlanCheck(body); break;
          case 'record-decision': data = governance.recordDecision(body); break;
          default: throw new ControlPlaneError('UNKNOWN_ACTION', 'unknown action');
        }
        sendJson(response, 200, { ok: true, data });
      } catch (error) {
        const failure = errorPayload(error);
        if (failure.status === 500) ctx.logger.error(`agent-team-control-plane request failed: ${failure.body.error.message}`);
        sendJson(response, failure.status, failure.body);
      }
    },
  });
}
