import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runVerificationCommands, verifyArtifacts } from '../../src/host/verification.js';

test('artifact verification normalizes absolute scope patterns and accepts absolute refs inside workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-team-artifacts-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'package.json'), '{}\n');
    writeFileSync(join(root, 'src', 'todo.js'), 'export {};\n');
    writeFileSync(join(root, 'src', 'secret.txt'), 'blocked\n');
    const task = {
      scope: {
        allowed: [join(root, 'package.json'), `${join(root, 'src')}\\**`],
        forbidden: [join(root, 'src', 'secret.txt')],
      },
    };
    const evidence = await verifyArtifacts(root, task, [
      'package.json',
      join(root, 'src', 'todo.js'),
      'src/secret.txt',
      join(root, '..', 'outside.txt'),
    ]);
    assert.deepEqual(evidence.map((item) => item.status), ['VERIFIED', 'VERIFIED', 'FAILED', 'FAILED']);
    assert.equal(evidence[0].details.relativePath, 'package.json');
    assert.equal(evidence[1].details.relativePath, 'src/todo.js');
    assert.match(evidence[2].details.error, /outside Task allowed scope|forbidden scope/);
    assert.match(evidence[3].details.error, /escapes workspace/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PowerShell verification captures UTF-8 symbols without Windows ANSI corruption', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-team-utf8-'));
  try {
    const [result] = await runVerificationCommands(root, [{ command: "Write-Output '✔ ℹ 中文'", timeoutMs: 10000 }]);
    assert.equal(result.status, 'PASSED');
    assert.match(result.stdoutExcerpt, /✔ ℹ 中文/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
