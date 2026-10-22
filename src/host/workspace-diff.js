import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathMatchesScope } from './verification.js';

// R2.1: the Task Run must be checked against the ACTUAL set of workspace
// changes, not only against the Worker's self-reported `artifacts` list.
// This module captures a filesystem baseline before a write Run, re-scans
// afterwards, diffs the two snapshots, and classifies every change against the
// Task scope (allowed / forbidden) so out-of-scope or forbidden writes can be
// surfaced as FAILED evidence instead of being silently accepted.

// Directories that are structural and never part of a Task's deliverable set.
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', '.workbuddy', '__pycache__']);

function sha256File(fullPath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(fullPath));
  return hash.digest('hex');
}

function recordFor(fullPath, info) {
  return { size: info.size, mtimeMs: Math.floor(info.mtimeMs), sha256: sha256File(fullPath) };
}

function walk(baseDir, dir, files) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (EXCLUDED_DIRECTORIES.has(name)) continue;
    // Exclude the control-plane SQLite database (and its WAL/SHM sidecars):
    // it mutates on every state change and is never a Task deliverable.
    if (name.endsWith('.sqlite') || name.endsWith('.sqlite-wal') || name.endsWith('.sqlite-shm') || name.endsWith('.sqlite-journal')) continue;
    const fullPath = join(dir, name);
    let info;
    try {
      info = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) {
      // Symbolic links / junctions cannot be hashed as regular files and are a
      // known escape vector. Record them explicitly so a diff can flag them.
      const relativePath = relative(baseDir, fullPath).replaceAll('\\', '/');
      files.set(relativePath, { symlink: true, target: readlinkSafe(fullPath) });
      continue;
    }
    if (info.isDirectory()) {
      walk(baseDir, fullPath, files);
      continue;
    }
    if (!info.isFile()) continue;
    const relativePath = relative(baseDir, fullPath).replaceAll('\\', '/');
    try {
      files.set(relativePath, recordFor(fullPath, info));
    } catch {
      // Unreadable file (permissions, transient): keep a size/mtime-only entry
      // so it is still visible to the diff.
      files.set(relativePath, { size: info.size, mtimeMs: Math.floor(info.mtimeMs), sha256: null });
    }
  }
}

function readlinkSafe(fullPath) {
  try {
    return require('node:fs').readlinkSync(fullPath);
  } catch {
    return null;
  }
}

// Returns a Map<workspaceRelativePath, { size, mtimeMs, sha256 } | { symlink, target }>.
export function snapshotWorkspace(workspace) {
  const root = resolve(workspace);
  const files = new Map();
  walk(root, root, files);
  return files;
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
