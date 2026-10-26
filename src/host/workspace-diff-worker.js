import { parentPort, workerData } from 'node:worker_threads';
import { snapshotWorkspace } from './workspace-diff.js';

try {
  parentPort.postMessage({ ok: true, entries: [...snapshotWorkspace(workerData.workspace)] });
} catch (error) {
  parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
} finally {
  parentPort.close();
}
