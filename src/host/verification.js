import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
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

function inAllowedScope(relativePath, scope) {
  const path = relativePath.replaceAll('\\', '/');
  const forbidden = scope.forbidden.some((pattern) => globRegex(pattern).test(path));
  const allowed = scope.allowed.some((pattern) => globRegex(pattern).test(path));
  return allowed && !forbidden;
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
  const evidence = [];
  for (const ref of artifacts) {
    const target = resolve(root, ref);
    let status = 'FAILED';
    let details;
    try {
      if (isAbsolute(ref) || !inside(root, target)) throw new Error('artifact escapes workspace');
      if (!inAllowedScope(ref, task.scope)) throw new Error('artifact is outside Task allowed scope or matches forbidden scope');
      const info = await stat(target);
      if (!info.isFile()) throw new Error('artifact is not a regular file');
      status = 'VERIFIED';
      details = { absolutePath: target, size: info.size, sha256: await sha256(target) };
    } catch (error) {
      details = { absolutePath: target, error: error instanceof Error ? error.message : String(error) };
    }
    evidence.push({ kind: 'FILE', ref, status, details });
  }
  return evidence;
}

function executePowerShell(command, cwd, timeoutMs) {
  const startedAt = new Date().toISOString();
  return new Promise((resolveResult) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
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
