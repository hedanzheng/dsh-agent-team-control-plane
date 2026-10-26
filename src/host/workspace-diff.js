import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { pathMatchesScope } from './verification.js';

// R2.1: the Task Run must be checked against the ACTUAL set of workspace
// changes, not only against the Worker's self-reported `artifacts` list.
// This module captures a filesystem baseline before a write Run, re-scans
// afterwards, diffs the two snapshots, and classifies every change against the
// Task scope (allowed / forbidden) so out-of-scope or forbidden writes can be
// surfaced as FAILED evidence instead of being silently accepted.

// O4-A: every entry in the workspace is audited. Structural directories and
// SQLite files are not exempt: a Worker could otherwise modify them without
// producing an out-of-scope/forbidden change record.
const HASH_BUFFER = Buffer.allocUnsafe(1024 * 1024);

export class WorkspaceScanError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'WorkspaceScanError';
    this.code = 'WORKSPACE_SCAN_FAILED';
  }
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function sha256File(fullPath, expected, root) {
  const canonical = realpathSync.native(fullPath);
  if (!inside(root, canonical)) throw new WorkspaceScanError(`workspace entry resolves outside root: ${fullPath}`);
  const fd = openSync(fullPath, 'r');
  const hash = createHash('sha256');
  try {
    const initial = fstatSync(fd);
    if (initial.dev !== expected.dev || initial.ino !== expected.ino || initial.size !== expected.size
      || initial.mtimeMs !== expected.mtimeMs) {
      throw new WorkspaceScanError(`workspace entry changed before hashing: ${fullPath}`);
    }
    let total = 0;
    for (;;) {
      const length = readSync(fd, HASH_BUFFER, 0, HASH_BUFFER.length, null);
      if (length === 0) break;
      hash.update(HASH_BUFFER.subarray(0, length));
      total += length;
    }
    const final = fstatSync(fd);
    if (total !== initial.size || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs
      || final.ctimeMs !== initial.ctimeMs) {
      throw new WorkspaceScanError(`workspace entry changed during hashing: ${fullPath}`);
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function recordFor(fullPath, info, root) {
  return { size: info.size, mtimeMs: Math.floor(info.mtimeMs), sha256: sha256File(fullPath, info, root) };
}

function walk(baseDir, dir, files) {
  let entries;
  try { entries = readdirSync(dir); }
  catch (error) { throw new WorkspaceScanError(`cannot list workspace directory: ${dir}`, error); }
  for (const name of entries) {
    const fullPath = join(dir, name);
    let info;
    try { info = lstatSync(fullPath); }
    catch (error) { throw new WorkspaceScanError(`cannot inspect workspace entry: ${fullPath}`, error); }
    if (info.isSymbolicLink()) {
      // Symbolic links / junctions cannot be hashed as regular files and are a
      // known escape vector. Record them explicitly so a diff can flag them.
      const relativePath = relative(baseDir, fullPath).replaceAll('\\', '/');
      try { files.set(relativePath, { symlink: true, target: readlinkSync(fullPath) }); }
      catch (error) { throw new WorkspaceScanError(`cannot inspect workspace link: ${fullPath}`, error); }
      continue;
    }
    if (info.isDirectory()) {
      walk(baseDir, fullPath, files);
      continue;
    }
    if (!info.isFile()) throw new WorkspaceScanError(`unsupported workspace entry type: ${fullPath}`);
    const relativePath = relative(baseDir, fullPath).replaceAll('\\', '/');
    try { files.set(relativePath, recordFor(fullPath, info, baseDir)); }
    catch (error) { throw error instanceof WorkspaceScanError ? error : new WorkspaceScanError(`cannot hash workspace file: ${fullPath}`, error); }
  }
}

// Returns a Map<workspaceRelativePath, { size, mtimeMs, sha256 } | { symlink, target }>.
export function snapshotWorkspace(workspace) {
  let root;
  try {
    root = realpathSync.native(resolve(workspace));
    if (!statSync(root).isDirectory()) throw new Error('workspace root is not a directory');
  } catch (error) {
    throw new WorkspaceScanError(`cannot resolve workspace root: ${workspace}`, error);
  }
  const files = new Map();
  walk(root, root, files);
  return files;
}

// One short-lived Worker per scan: filesystem traversal and hashing never
// block the Host event loop. Abort and deadline both terminate the Worker;
// errors reject instead of returning a partial snapshot.
export function snapshotWorkspaceAsync(workspace, { signal, timeoutMs = 180000 } = {}) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('workspace scan aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
  return new Promise((resolveSnapshot, rejectSnapshot) => {
    const worker = new Worker(new URL('./workspace-diff-worker.js', import.meta.url), { workerData: { workspace } });
    let settled = false;
    const finish = (error, entries) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) rejectSnapshot(error);
      else resolveSnapshot(new Map(entries));
    };
    const abort = () => {
      worker.terminate().catch(() => {});
      finish(Object.assign(new Error('workspace scan aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
    };
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {});
      finish(new WorkspaceScanError(`workspace scan exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    worker.once('message', (message) => {
      if (message.ok) finish(null, message.entries);
      else finish(new WorkspaceScanError(message.message || 'workspace scan failed'));
    });
    worker.once('error', (error) => finish(new WorkspaceScanError('workspace scan Worker failed', error)));
    worker.once('exit', (code) => { if (!settled) finish(new WorkspaceScanError(`workspace scan Worker exited before result (code ${code})`)); });
  });
}

// Diffs two snapshots produced by snapshotWorkspace. Returns path lists.
export function diffWorkspace(before, after) {
  const added = [];
  const modified = [];
  const deleted = [];
  const unchanged = [];
  for (const [path, afterInfo] of after) {
    const beforeInfo = before.get(path);
    if (beforeInfo === undefined) {
      added.push(path);
      continue;
    }
    const changed = beforeInfo.symlink || afterInfo.symlink
      ? beforeInfo.symlink !== afterInfo.symlink || beforeInfo.target !== afterInfo.target
      : beforeInfo.sha256 !== afterInfo.sha256 || beforeInfo.sha256 === null;
    if (changed) modified.push(path);
    else unchanged.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) deleted.push(path);
  }
  return { added, modified, deleted, unchanged };
}

// Classifies every changed path against the Task scope.
// - forbidden: matches a forbidden pattern (always a violation).
// - inScope:   matches an allowed pattern (legitimate Task output).
// - outOfScope:matches neither — the Worker touched something it was not
//   cleared to touch. Reported, not silently accepted.
export function classifyWorkspaceChanges(root, diff, scope) {
  const forbidden = [];
  const outOfScope = [];
  const inScope = [];
  for (const path of [...diff.added, ...diff.modified, ...diff.deleted]) {
    if (pathMatchesScope(root, path, scope?.forbidden ?? [])) forbidden.push(path);
    else if (pathMatchesScope(root, path, scope?.allowed ?? [])) inScope.push(path);
    else outOfScope.push(path);
  }
  return { inScope, outOfScope, forbidden };
}
