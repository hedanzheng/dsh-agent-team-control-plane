// Isolated O4-A filesystem benchmark; never opens a production workspace or database.
// node --expose-gc scripts/bench/workspace-o4.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync,
  rmSync, statSync, lstatSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as scanner from '../../src/host/workspace-diff.js';

const scales = [100, 1000, 10000];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = (value) => Number(value.toFixed(3));

// Copy of the pre-O4 scanner's hot loop for an instrumented baseline only.
// The separate realScanner timing below is the actual production implementation.
function profileLegacy(root) {
  const phases = { readdirMs: 0, lstatMs: 0, readHashMs: 0, entries: 0, files: 0, bytes: 0 };
  const ignored = new Set(['.git', 'node_modules', '.workbuddy', '__pycache__']);
  const walk = (dir) => {
    let tick = performance.now();
    let names;
    try { names = readdirSync(dir); } catch { return; }
    phases.readdirMs += performance.now() - tick;
    for (const name of names) {
      if (ignored.has(name) || /\.sqlite(?:-wal|-shm|-journal)?$/.test(name)) continue;
      const path = join(dir, name);
      phases.entries += 1;
      tick = performance.now();
      let info;
      try { info = lstatSync(path); } catch { continue; }
      phases.lstatMs += performance.now() - tick;
      if (info.isDirectory()) { walk(path); continue; }
      if (!info.isFile()) continue;
      tick = performance.now();
      const hash = createHash('sha256');
      hash.update(readFileSync(path));
      hash.digest('hex');
      phases.readHashMs += performance.now() - tick;
      phases.files += 1;
      phases.bytes += info.size;
    }
  };
  const started = performance.now();
  walk(root);
  return { ...Object.fromEntries(Object.entries(phases).map(([key, value]) => [key, key.endsWith('Ms') ? round(value) : value])), totalMs: round(performance.now() - started) };
}

async function sample(fn) {
  global.gc?.();
  const intervalMs = 5;
  let maxLagMs = 0;
  let last = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  const timer = setInterval(() => {
    const current = performance.now();
    maxLagMs = Math.max(maxLagMs, current - last - intervalMs);
    last = current;
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, intervalMs);
  await new Promise((done) => setTimeout(done, intervalMs * 2));
  const start = performance.now();
  try {
    const map = await fn();
    const elapsed = performance.now() - start;
    await new Promise((done) => setTimeout(done, intervalMs * 2));
    return { ms: round(elapsed), maxEventLoopLagMs: round(maxLagMs), peakRssBytes,
      entries: map.size, baselineJsonBytes: Buffer.byteLength(JSON.stringify([...map])) };
  } finally { clearInterval(timer); }
}

function createFixture(root, files) {
  const src = join(root, 'src');
  mkdirSync(src);
  const payload = Buffer.alloc(256, 97);
  for (let i = 0; i < files; i += 1) {
    const dir = join(src, String(Math.floor(i / 100)));
    if (i % 100 === 0) mkdirSync(dir);
    writeFileSync(join(dir, `file-${i}.txt`), payload);
  }
}

function assertCleanup(root) {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('atcp-o4-bench-'));
}

async function run() {
  const report = { phase: typeof scanner.snapshotWorkspaceAsync === 'function' ? 'O4-A after' : 'O4-A before',
    measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`,
    gcExposed: Boolean(global.gc), scales: [], largeFile: null };
  for (const files of scales) {
    const root = mkdtempSync(join(tmpdir(), 'atcp-o4-bench-'));
    try {
      createFixture(root, files);
      const realScanner = [];
      const asyncScanner = [];
      for (let i = 0; i < 5; i += 1) {
        realScanner.push(await sample(() => scanner.snapshotWorkspace(root)));
        if (scanner.snapshotWorkspaceAsync) asyncScanner.push(await sample(() => scanner.snapshotWorkspaceAsync(root)));
      }
      const baseline = scanner.snapshotWorkspace(root);
      const db = new DatabaseSync(join(root, 'benchmark.sqlite'));
      db.exec('CREATE TABLE baselines(data TEXT NOT NULL)');
      const encoded = JSON.stringify([...baseline]);
      const insert = db.prepare('INSERT INTO baselines(data) VALUES(?)');
      const writes = [];
      for (let i = 0; i < 5; i += 1) {
        const start = performance.now();
        insert.run(encoded);
        writes.push(performance.now() - start);
      }
      db.close();
      report.scales.push({ files, contentBytes: files * 256,
        legacyPhases: profileLegacy(root),
        realScanner: { medianMs: median(realScanner.map((x) => x.ms)), maxEventLoopLagMs: median(realScanner.map((x) => x.maxEventLoopLagMs)),
          medianRssBytes: median(realScanner.map((x) => x.peakRssBytes)), baselineJsonBytes: baseline.size ? realScanner[0].baselineJsonBytes : 0 },
        asyncScanner: asyncScanner.length ? { medianMs: median(asyncScanner.map((x) => x.ms)),
          maxEventLoopLagMs: median(asyncScanner.map((x) => x.maxEventLoopLagMs)),
          medianRssBytes: median(asyncScanner.map((x) => x.peakRssBytes)), baselineJsonBytes: asyncScanner[0].baselineJsonBytes } : null,
        sqliteBaselineWriteMedianMs: round(median(writes)) });
    } finally { assertCleanup(root); rmSync(root, { recursive: true, force: true }); }
  }
  const root = mkdtempSync(join(tmpdir(), 'atcp-o4-bench-'));
  try {
    const path = join(root, 'large.bin');
    const fd = openSync(path, 'w');
    try { for (let i = 0; i < 64; i += 1) writeFileSync(fd, Buffer.alloc(1024 * 1024, 98)); }
    finally { closeSync(fd); }
    const sync = await sample(() => scanner.snapshotWorkspace(root));
    const async = scanner.snapshotWorkspaceAsync ? await sample(() => scanner.snapshotWorkspaceAsync(root)) : null;
    assert.equal(sync.entries, 1);
    if (async) assert.equal(async.entries, 1);
    report.largeFile = { sizeBytes: statSync(path).size, sync, async };
  } finally { assertCleanup(root); rmSync(root, { recursive: true, force: true }); }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
