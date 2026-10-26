import { join } from 'node:path';
import { AgentTeamControlPlane } from './control-plane.js';
import { HostRuntimeScanner } from './runtime-scan.js';
import { ControlPlaneStore } from './store.js';
import { RuntimeAdapterRegistry } from './runtime-adapter.js';
import { TaskRunCoordinator } from './run-coordinator.js';
import { CollaborationGovernance } from './governance.js';
import { installPLBridge } from './pl-bridge.js';
import { createControlPlaneHttpHandler } from './http-router.js';
import { RequestDispatchScheduler } from './request-scheduler.js';

export const name = 'agent-team-control-plane';
// R1.1: `connection` provides Host admission (authenticated owner Peer,
// Origin/Host/fetch-site validation). All Panel reads and writes now pass
// through it before any body or snapshot is touched.
export const inject = ['webServer', 'connection', 'llm', 'subagents', 'skills', 'tools', 'systemPrompt'];

const ROUTE = '/agent-team-control-plane/v1';

function databasePath() {
  const home = process.env.DSH_HOME?.trim();
  if (!home) throw new Error('agent-team-control-plane: DSH_HOME is required');
  return join(home, 'agent-team-control-plane', 'control-plane.sqlite');
}

export async function apply(ctx) {
  const store = new ControlPlaneStore(databasePath());
  const scanner = new HostRuntimeScanner(ctx);
  const controlPlane = new AgentTeamControlPlane(store, scanner);
  const adapters = new RuntimeAdapterRegistry(ctx, store);
  const governance = new CollaborationGovernance({ store, controlPlane, adapters, logger: ctx.logger });
  const coordinator = new TaskRunCoordinator({ store, controlPlane, adapters, governance, logger: ctx.logger });
  const requestScheduler = new RequestDispatchScheduler({ governance, logger: ctx.logger });
  governance.requestScheduler = requestScheduler;
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
  const recoveredRequestRuns = governance.recoverInterruptedRequestRuns();
  const recoveredReviewRuns = governance.recoverInterruptedReviewRuns();
  store.setSystemState('runtime_adapters', adapters.listAvailableRuntimes(), new Date().toISOString());
  store.setSystemState('task_run_recovery', { recoveredRuns }, new Date().toISOString());
  store.setSystemState('request_run_recovery', { recoveredRequestRuns }, new Date().toISOString());
  store.setSystemState('review_run_recovery', { recoveredReviewRuns }, new Date().toISOString());
  coordinator.startWatchdog();
  requestScheduler.start();

  ctx.effect(() => async () => {
    requestScheduler.stop();
    disposePLBridge();
    await governance.close();
    await coordinator.close();
    store.close();
  }, 'agent-team-control-plane.store');

  const handler = createControlPlaneHttpHandler({
    controlPlane,
    coordinator,
    governance,
    adapters,
    connection: ctx.connection,
    logger: ctx.logger,
  });

  return ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    async handler(request, response) {
      await handler(request, response);
    },
  });
}
