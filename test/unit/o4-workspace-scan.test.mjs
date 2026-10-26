import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyWorkspaceChanges, diffWorkspace, snapshotWorkspace, snapshotWorkspaceAsync } from '../../src/host/workspace-diff.js';

function fixture() { return mkdtempSync(join(tmpdir(), 'atcp-o4-scan-')); }
function cleanup(root) { rmSync(root, { recursive: true, force: true }); }

test('O4: async scan matches the complete sync baseline, including previously ignored paths', async () => {
  const root = fixture();
  try {
    for (const directory of ['src', '.git', 'node_modules', '__pycache__']) mkdirSync(join(root, directory));
    for (const path of ['src/ok.js', '.git/config', 'node_modules/pkg.js', '__pycache__/bytecode.pyc', 'state.sqlite-wal']) {
      writeFileSync(join(root, path), path);
    }
    const sync = snapshotWorkspace(root);
    const async = await snapshotWorkspaceAsync(root);
    assert.deepEqual([...async], [...sync]);
    assert.equal(async.size, 5);
  } finally { cleanup(root); }
});

test('O4: add, modify, delete, rename and unreported forbidden paths remain visible', async () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'src', 'modify.js'), 'old');
    writeFileSync(join(root, 'src', 'delete.js'), 'deleted');
    writeFileSync(join(root, 'src', 'rename-old.js'), 'renamed');
    const before = await snapshotWorkspaceAsync(root);
    writeFileSync(join(root, 'src', 'modify.js'), 'new');
    rmSync(join(root, 'src', 'delete.js'));
    writeFileSync(join(root, 'src', 'rename-new.js'), readFileSync(join(root, 'src', 'rename-old.js')));
    rmSync(join(root, 'src', 'rename-old.js'));
    writeFileSync(join(root, 'src', 'untracked.js'), 'unreported');
    writeFileSync(join(root, '.git', 'config'), 'forbidden');
    const diff = diffWorkspace(before, await snapshotWorkspaceAsync(root));
    assert.deepEqual(new Set(diff.added), new Set(['.git/config', 'src/rename-new.js', 'src/untracked.js']));
    assert.deepEqual(new Set(diff.modified), new Set(['src/modify.js']));
    assert.deepEqual(new Set(diff.deleted), new Set(['src/delete.js', 'src/rename-old.js']));
    const classification = classifyWorkspaceChanges(root, diff, { allowed: ['src/**'], forbidden: ['.git/**'] });
    assert.deepEqual(classification.forbidden, ['.git/config']);
    assert.equal(classification.inScope.includes('src/untracked.js'), true);
  } finally { cleanup(root); }
});

test('O4: same-size and restored mtime cannot conceal a content change', async () => {
  const root = fixture();
  try {
    const file = join(root, 'file.txt');
    writeFileSync(file, 'old content');
    const before = await snapshotWorkspaceAsync(root);
    const oldMtime = new Date(before.get('file.txt').mtimeMs);
    writeFileSync(file, 'new content');
    utimesSync(file, oldMtime, oldMtime);
    const after = await snapshotWorkspaceAsync(root);
    assert.equal(after.get('file.txt').size, before.get('file.txt').size);
    assert.deepEqual(diffWorkspace(before, after).modified, ['file.txt']);
  } finally { cleanup(root); }
});

test('O4: large file is hashed completely without a null or partial digest', async () => {
  const root = fixture();
  try {
    const file = join(root, 'large.bin');
    const payload = Buffer.alloc(32 * 1024 * 1024, 0x5a);
    writeFileSync(file, payload);
    const expected = createHash('sha256').update(payload).digest('hex');
    assert.equal((await snapshotWorkspaceAsync(root)).get('large.bin').sha256, expected);
  } finally { cleanup(root); }
});

test('O4: junction is recorded but never traversed or trusted as an ordinary file', async () => {
  const root = fixture();
  const outside = fixture();
  try {
    writeFileSync(join(outside, 'secret.txt'), 'external');
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const baseline = await snapshotWorkspaceAsync(root);
    assert.equal(baseline.get('linked')?.symlink, true);
    assert.equal(baseline.has('linked/secret.txt'), false);
  } finally { cleanup(root); cleanup(outside); }
});

test('O4: abort, deadline and disappeared workspace terminate the scan with an error', async () => {
  const root = fixture();
  try {
    const controller = new AbortController();
    const aborted = snapshotWorkspaceAsync(root, { signal: controller.signal });
    controller.abort();
    await assert.rejects(aborted, (error) => error.name === 'AbortError');
    await assert.rejects(snapshotWorkspaceAsync(root, { timeoutMs: 1 }), /exceeded|Worker exited/);
    rmSync(root, { recursive: true, force: true });
    await assert.rejects(snapshotWorkspaceAsync(root), /cannot resolve workspace root/);
  } finally { if (root) cleanup(root); }
});

test('O4: scan runs outside Host event loop', async () => {
  const root = fixture();
  try {
    for (let index = 0; index < 300; index += 1) writeFileSync(join(root, `file-${index}.txt`), 'x');
    let scanSettled = false;
    const scan = snapshotWorkspaceAsync(root).finally(() => { scanSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(scanSettled, false);
    assert.equal((await scan).size, 300);
  } finally { cleanup(root); }
});

test('O4: scanner Worker does not inherit incompatible Host CLI flags', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'probe.txt'), 'ok');
    const moduleUrl = new URL('../../src/host/workspace-diff.js', import.meta.url).href;
    const script = `import { snapshotWorkspaceAsync } from ${JSON.stringify(moduleUrl)}; const result = await snapshotWorkspaceAsync(${JSON.stringify(root)}); console.log(result.size);`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), '1');
  } finally { cleanup(root); }
});
