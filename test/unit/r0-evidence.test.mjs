import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { findSensitiveMaterial, validateEvidence } from '../../scripts/r0-validate-evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const validatorPath = resolve(here, '../../scripts/r0-validate-evidence.mjs');

function response(status = 200) {
  return {
    networkOk: true,
    status,
    headers: {
      contentType: 'application/json',
      contentLength: 42,
      accessControlAllowOrigin: null,
      accessControlAllowCredentials: null,
      vary: null,
      setCookiePresent: false,
      wwwAuthenticatePresent: false,
    },
    body: {
      inspectedBytes: 42,
      truncated: false,
      format: 'json-object',
    },
  };
}

function request(id, method, context, originRelation, bodyClass, status = 200) {
  return {
    id,
    method,
    context,
    request: {
      originRelation,
      credentialsSent: false,
      bodyClass,
    },
    response: response(status),
  };
}

function validEvidence() {
  return {
    schemaVersion: 1,
    artifact: 'agent-team-control-plane-r0-http-boundary',
    capturedAt: '2026-10-22T00:00:00.000Z',
    probeStatus: 'COMPLETE',
    probe: {
      baseOrigin: 'http://127.0.0.1:8811',
      route: '/agent-team-control-plane/v1',
      safeguards: {
        credentialsSent: false,
        requestBodiesPersisted: false,
        responseBodiesPersisted: false,
        maxBodyInspectionBytes: 65536,
        noSideEffectPostAction: '__r0_probe_unknown_action_v1__',
      },
    },
    requests: [
      request('unauthenticated-get', 'GET', 'unauthenticated', 'none', 'none'),
      request('same-origin-unauthenticated-get', 'GET', 'same-origin-unauthenticated', 'same-origin', 'none'),
      request('cross-origin-unauthenticated-get', 'GET', 'cross-origin-unauthenticated', 'cross-origin', 'none'),
      request('cross-origin-preflight', 'OPTIONS', 'cross-origin-preflight', 'cross-origin', 'none', 204),
      request('unknown-action-post', 'POST', 'cross-origin-simple-post', 'cross-origin', 'fixed-unknown-action', 400),
    ],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('R0 evidence validator accepts only metadata from the fixed, credential-free probe set', () => {
  const evidence = validEvidence();
  assert.deepEqual(validateEvidence(evidence), { ok: true, errors: [] });
  assert.deepEqual(findSensitiveMaterial(evidence), []);
});

test('R0 evidence validator requires its schema version and every boundary request', () => {
  const evidence = validEvidence();
  evidence.schemaVersion = 2;
  evidence.requests.pop();
  evidence.probeStatus = 'PARTIAL';

  const result = validateEvidence(evidence);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'SCHEMA_VERSION'));
  assert.ok(result.errors.some((error) => error.code === 'REQUIRED_REQUEST_MISSING'));
});

test('R0 evidence validator rejects credential fields, credential patterns, and raw response bodies', () => {
  const evidence = validEvidence();
  evidence.authorization = 'Bearer abcdefghijklmnopqrstuvwxyz';
  evidence.requests[0].response.body.raw = 'access_token=very-secret-material';

  const result = validateEvidence(evidence);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'SENSITIVE_FIELD'));
  assert.ok(result.errors.some((error) => error.code === 'SENSITIVE_VALUE'));
  assert.ok(result.errors.some((error) => error.code === 'UNEXPECTED_FIELD' && error.path.endsWith('.*')));
  assert.ok(result.errors.every((error) => !JSON.stringify(error).includes('very-secret-material')));
});

test('R0 evidence validator accepts a fully redacted network-unavailable capture', () => {
  const evidence = validEvidence();
  evidence.probeStatus = 'NETWORK_UNAVAILABLE';
  for (const item of evidence.requests) {
    item.response = { networkOk: false, errorCode: 'CONNECTION_FAILED' };
  }

  assert.deepEqual(validateEvidence(evidence), { ok: true, errors: [] });
});

test('R0 evidence CLI returns stable exit codes without echoing rejected secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-team-r0-evidence-'));
  try {
    const goodPath = join(root, 'good.json');
    const badPath = join(root, 'bad.json');
    writeFileSync(goodPath, JSON.stringify(validEvidence()), 'utf8');

    const bad = clone(validEvidence());
    bad.requests[0].response.body.raw = 'api_key=do-not-echo-this-secret';
    bad.requests[0].id = 'api_key=secret-in-request-id';
    bad['api_key=secret-in-field-name'] = true;
    writeFileSync(badPath, JSON.stringify(bad), 'utf8');

    const good = spawnSync(process.execPath, [validatorPath, goodPath], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).ok, true);

    const rejected = spawnSync(process.execPath, [validatorPath, badPath], { encoding: 'utf8' });
    assert.equal(rejected.status, 1);
    assert.doesNotMatch(rejected.stderr, /do-not-echo-this-secret/);
    assert.doesNotMatch(rejected.stderr, /secret-in-request-id/);
    assert.doesNotMatch(rejected.stderr, /secret-in-field-name/);
    assert.ok(JSON.parse(rejected.stderr).errors.some((error) => error.code === 'SENSITIVE_VALUE'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('R0 generator and validator share the same explicit loopback allowlist', () => {
  for (const baseOrigin of ['http://localhost:8811', 'http://127.0.0.1:8811', 'http://[::1]:8811']) {
    const evidence = validEvidence();
    evidence.probe.baseOrigin = baseOrigin;
    assert.equal(validateEvidence(evidence).ok, true, baseOrigin);
  }

  const evidence = validEvidence();
  evidence.probe.baseOrigin = 'http://127.0.0.2:8811';
  assert.equal(validateEvidence(evidence).ok, false);
});
