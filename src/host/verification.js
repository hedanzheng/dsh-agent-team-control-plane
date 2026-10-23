import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';

function truncate(value, max = 8000) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function globRegex(pattern) {
  const normalized = pattern.replaceAll('\\', '/');
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function normalizeScopePattern(root, pattern) {
  if (typeof pattern !== 'string' || !pattern.trim()) return null;
  const source = pattern.trim();
  if (!isAbsolute(source)) return source.replaceAll('\\', '/').replace(/^\.\//, '');
  const target = resolve(source);
  if (!inside(root, target)) return null;
  return relative(root, target).replaceAll('\\', '/');
}

function patternMatches(path, pattern) {
  if (globRegex(pattern).test(path)) return true;
  if (/[*?]/.test(pattern)) return false;
  const normalized = pattern.replace(/\/$/, '');
  return path === normalized || path.startsWith(`${normalized}/`);
}

function inAllowedScope(root, relativePath, scope) {
  const path = relativePath.replaceAll('\\', '/');
  const forbidden = pathMatchesScope(root, relativePath, scope?.forbidden ?? []);
  const allowed = pathMatchesScope(root, relativePath, scope?.allowed ?? []);
  return allowed && !forbidden;
}

// Exported for R2 workspace-diff scope classification: tells whether a
// workspace-relative path matches any allowed/forbidden pattern list.
export function pathMatchesScope(root, relativePath, patterns) {
  const path = relativePath.replaceAll('\\', '/');
  return (patterns ?? [])
    .map((pattern) => normalizeScopePattern(root, pattern)).filter(Boolean)
    .some((pattern) => patternMatches(path, pattern));
}

async function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

export async function verifyArtifacts(workspace, task, artifacts) {
  const root = resolve(workspace);
  const canonicalRoot = await realpath(root);
  const evidence = [];
  for (const ref of artifacts) {
    const target = isAbsolute(ref) ? resolve(ref) : resolve(root, ref);
    const relativePath = relative(root, target).replaceAll('\\', '/');
    let status = 'FAILED';
    let details;
    try {
      if (!inside(root, target)) throw new Error('artifact escapes workspace');
      if (!inAllowedScope(root, relativePath, task.scope)) throw new Error('artifact is outside Task allowed scope or matches forbidden scope');
      const linkInfo = await lstat(target);
      if (linkInfo.isSymbolicLink()) throw new Error('artifact is a symbolic link or junction');
      const canonicalTarget = await realpath(target);
      if (!inside(canonicalRoot, canonicalTarget)) throw new Error('artifact resolves outside workspace through a symbolic link or junction');
      const info = await stat(canonicalTarget);
      if (!info.isFile()) throw new Error('artifact is not a regular file');
      status = 'VERIFIED';
      details = { absolutePath: target, canonicalPath: canonicalTarget, relativePath, size: info.size, sha256: await sha256(canonicalTarget) };
    } catch (error) {
      details = { absolutePath: target, relativePath, error: error instanceof Error ? error.message : String(error) };
    }
    evidence.push({ kind: 'FILE', ref, status, details });
  }
  return evidence;
}

function executePowerShell(command, cwd, timeoutMs) {
  const startedAt = new Date().toISOString();
  const utf8Command = [
    '$utf8 = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = $utf8',
    '[Console]::OutputEncoding = $utf8',
    '$OutputEncoding = $utf8',
    command,
  ].join('; ');
  return new Promise((resolveResult) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', utf8Command], {
      cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8',
    }, (error, stdout, stderr) => {
      const endedAt = new Date().toISOString();
      const timedOut = Boolean(error?.killed) || error?.code === 'ETIMEDOUT';
      const exitCode = error ? (Number.isInteger(error.code) ? error.code : null) : 0;
      resolveResult({
        command, cwd, exitCode,
        status: timedOut ? 'TIMED_OUT' : exitCode === 0 ? 'PASSED' : 'FAILED',
        stdoutExcerpt: truncate(stdout), stderrExcerpt: truncate(stderr || error?.message || ''),
        startedAt, endedAt,
      });
    });
  });
}

export async function runVerificationCommands(workspace, commands) {
  const results = [];
  for (const item of commands) {
    results.push(await executePowerShell(item.command, workspace, item.timeoutMs));
  }
  return results;
}
