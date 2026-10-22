#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARTIFACT = 'agent-team-control-plane-r0-http-boundary';
const ROUTE = '/agent-team-control-plane/v1';
const UNKNOWN_ACTION = '__r0_probe_unknown_action_v1__';
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

const EXPECTED_REQUESTS = new Map([
  ['unauthenticated-get', { method: 'GET', context: 'unauthenticated', originRelation: 'none', bodyClass: 'none' }],
  ['same-origin-unauthenticated-get', { method: 'GET', context: 'same-origin-unauthenticated', originRelation: 'same-origin', bodyClass: 'none' }],
  ['cross-origin-unauthenticated-get', { method: 'GET', context: 'cross-origin-unauthenticated', originRelation: 'cross-origin', bodyClass: 'none' }],
  ['cross-origin-preflight', { method: 'OPTIONS', context: 'cross-origin-preflight', originRelation: 'cross-origin', bodyClass: 'none' }],
  ['unknown-action-post', { method: 'POST', context: 'cross-origin-simple-post', originRelation: 'cross-origin', bodyClass: 'fixed-unknown-action' }],
]);

const SENSITIVE_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'xapikey',
  'password',
  'passwd',
  'clientsecret',
  'privatekey',
]);

const SENSITIVE_VALUE_PATTERNS = [
  /\bauthorization\s*:\s*\S+/i,
  /\bcookie\s*:\s*\S+/i,
  /\bset-cookie\s*:\s*\S+/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bbasic\s+[A-Za-z0-9+/=]{8,}/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|password|client[_-]?secret)\s*[=:]\s*["']?[^\s"',}]{4,}/i,
  /(?:[?&])(?:token|access_token|refresh_token|api_key|key)=[^&#\s]{4,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/i,
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizedKey = (key) => key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

function addError(errors, code, path, message) {
  errors.push({ code, path, message });
}

function checkAllowedKeys(value, allowed, path, errors) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addError(errors, 'UNEXPECTED_FIELD', `${path}.*`, 'an input field is not part of the redacted evidence schema');
    }
  }
}

function requireObject(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, 'TYPE_MISMATCH', path, 'must be an object');
    return false;
  }
  return true;
}

function requireBoolean(value, path, errors, expected) {
  if (typeof value !== 'boolean') {
    addError(errors, 'TYPE_MISMATCH', path, 'must be a boolean');
  } else if (expected !== undefined && value !== expected) {
    addError(errors, 'SAFEGUARD_VIOLATION', path, `must be ${expected}`);
  }
}

function requireNullableString(value, path, errors) {
  if (value !== null && typeof value !== 'string') {
    addError(errors, 'TYPE_MISMATCH', path, 'must be a string or null');
  }
}

function requireIntegerInRange(value, min, max, path, errors) {
  if (!Number.isInteger(value) || value < min || value > max) {
    addError(errors, 'TYPE_MISMATCH', path, `must be an integer between ${min} and ${max}`);
  }
}

function isLoopbackOrigin(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    return loopback
      && (url.protocol === 'http:' || url.protocol === 'https:')
      && url.username === ''
      && url.password === ''
      && url.pathname === '/'
      && url.search === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

export function findSensitiveMaterial(value) {
  const findings = [];
  const seen = new Set();

  function visit(current, path) {
    if (typeof current === 'string') {
      for (const pattern of SENSITIVE_VALUE_PATTERNS) {
        if (pattern.test(current)) {
          findings.push({ code: 'SENSITIVE_VALUE', path, message: 'value matches a credential or secret pattern' });
          break;
        }
      }
      return;
    }
    if (current === null || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(current)) {
      if (SENSITIVE_KEYS.has(normalizedKey(key))) {
        findings.push({ code: 'SENSITIVE_FIELD', path: `${path}.*`, message: 'credential-bearing field names are prohibited' });
      }
      visit(child, `${path}.*`);
    }
  }

  visit(value, '$');
  return findings;
}

function validateSafeguards(probe, errors) {
  if (!requireObject(probe, '$.probe', errors)) return;
  checkAllowedKeys(probe, new Set(['baseOrigin', 'route', 'safeguards']), '$.probe', errors);

  if (typeof probe.baseOrigin !== 'string' || !isLoopbackOrigin(probe.baseOrigin)) {
    addError(errors, 'INVALID_LOCAL_ORIGIN', '$.probe.baseOrigin', 'must be a loopback HTTP(S) origin without credentials, path, query, or fragment');
  }
  if (probe.route !== ROUTE) {
    addError(errors, 'INVALID_ROUTE', '$.probe.route', `must equal ${ROUTE}`);
  }

  if (!requireObject(probe.safeguards, '$.probe.safeguards', errors)) return;
  const safeguards = probe.safeguards;
  checkAllowedKeys(safeguards, new Set([
    'credentialsSent',
    'requestBodiesPersisted',
    'responseBodiesPersisted',
    'maxBodyInspectionBytes',
    'noSideEffectPostAction',
  ]), '$.probe.safeguards', errors);

  requireBoolean(safeguards.credentialsSent, '$.probe.safeguards.credentialsSent', errors, false);
  requireBoolean(safeguards.requestBodiesPersisted, '$.probe.safeguards.requestBodiesPersisted', errors, false);
  requireBoolean(safeguards.responseBodiesPersisted, '$.probe.safeguards.responseBodiesPersisted', errors, false);
  requireIntegerInRange(safeguards.maxBodyInspectionBytes, 1024, 1048576, '$.probe.safeguards.maxBodyInspectionBytes', errors);
  if (safeguards.noSideEffectPostAction !== UNKNOWN_ACTION) {
    addError(errors, 'UNSAFE_POST_ACTION', '$.probe.safeguards.noSideEffectPostAction', 'must be the fixed R0 unknown action');
  }
}

function validateRequest(item, index, errors, bodyLimit) {
  const path = `$.requests[${index}]`;
  if (!requireObject(item, path, errors)) return null;
  checkAllowedKeys(item, new Set(['id', 'method', 'context', 'request', 'response']), path, errors);

  if (typeof item.id !== 'string') {
    addError(errors, 'TYPE_MISMATCH', `${path}.id`, 'must be a string');
    return null;
  }
  const expected = EXPECTED_REQUESTS.get(item.id);
  if (!expected) {
    addError(errors, 'UNKNOWN_REQUEST', `${path}.id`, 'request is not part of the fixed R0 probe set');
  } else {
    if (item.method !== expected.method) addError(errors, 'REQUEST_MISMATCH', `${path}.method`, `must equal ${expected.method}`);
    if (item.context !== expected.context) addError(errors, 'REQUEST_MISMATCH', `${path}.context`, `must equal ${expected.context}`);
  }

  if (requireObject(item.request, `${path}.request`, errors)) {
    checkAllowedKeys(item.request, new Set(['originRelation', 'credentialsSent', 'bodyClass']), `${path}.request`, errors);
    requireBoolean(item.request.credentialsSent, `${path}.request.credentialsSent`, errors, false);
    if (expected) {
      if (item.request.originRelation !== expected.originRelation) {
        addError(errors, 'REQUEST_MISMATCH', `${path}.request.originRelation`, `must equal ${expected.originRelation}`);
      }
      if (item.request.bodyClass !== expected.bodyClass) {
        addError(errors, 'REQUEST_MISMATCH', `${path}.request.bodyClass`, `must equal ${expected.bodyClass}`);
      }
    }
  }

  if (!requireObject(item.response, `${path}.response`, errors)) return item.id;
  requireBoolean(item.response.networkOk, `${path}.response.networkOk`, errors);

  if (item.response.networkOk === true) {
    checkAllowedKeys(item.response, new Set(['networkOk', 'status', 'headers', 'body']), `${path}.response`, errors);
    requireIntegerInRange(item.response.status, 100, 599, `${path}.response.status`, errors);

    if (requireObject(item.response.headers, `${path}.response.headers`, errors)) {
      const headers = item.response.headers;
      checkAllowedKeys(headers, new Set([
        'contentType',
        'contentLength',
        'accessControlAllowOrigin',
        'accessControlAllowCredentials',
        'vary',
        'setCookiePresent',
        'wwwAuthenticatePresent',
      ]), `${path}.response.headers`, errors);
      requireNullableString(headers.contentType, `${path}.response.headers.contentType`, errors);
      if (headers.contentLength !== null) {
        requireIntegerInRange(headers.contentLength, 0, Number.MAX_SAFE_INTEGER, `${path}.response.headers.contentLength`, errors);
      }
      requireNullableString(headers.accessControlAllowOrigin, `${path}.response.headers.accessControlAllowOrigin`, errors);
      requireNullableString(headers.accessControlAllowCredentials, `${path}.response.headers.accessControlAllowCredentials`, errors);
      requireNullableString(headers.vary, `${path}.response.headers.vary`, errors);
      requireBoolean(headers.setCookiePresent, `${path}.response.headers.setCookiePresent`, errors);
      requireBoolean(headers.wwwAuthenticatePresent, `${path}.response.headers.wwwAuthenticatePresent`, errors);
    }

    if (requireObject(item.response.body, `${path}.response.body`, errors)) {
      const body = item.response.body;
      checkAllowedKeys(body, new Set(['inspectedBytes', 'truncated', 'format']), `${path}.response.body`, errors);
      requireIntegerInRange(body.inspectedBytes, 0, bodyLimit, `${path}.response.body.inspectedBytes`, errors);
      requireBoolean(body.truncated, `${path}.response.body.truncated`, errors);
      if (!['empty', 'json-object', 'json-array', 'json-scalar', 'non-json'].includes(body.format)) {
        addError(errors, 'TYPE_MISMATCH', `${path}.response.body.format`, 'must be a supported body classification');
      }
    }
  } else if (item.response.networkOk === false) {
    checkAllowedKeys(item.response, new Set(['networkOk', 'errorCode']), `${path}.response`, errors);
    if (!['TIMEOUT_OR_CANCELLED', 'CONNECTION_FAILED', 'REQUEST_FAILED'].includes(item.response.errorCode)) {
      addError(errors, 'TYPE_MISMATCH', `${path}.response.errorCode`, 'must be a stable redacted network error code');
    }
  }

  return item.id;
}

export function validateEvidence(evidence) {
  const errors = [];
  if (!requireObject(evidence, '$', errors)) return { ok: false, errors };

  checkAllowedKeys(evidence, new Set(['schemaVersion', 'artifact', 'capturedAt', 'probeStatus', 'probe', 'requests']), '$', errors);
  if (evidence.schemaVersion !== 1) addError(errors, 'SCHEMA_VERSION', '$.schemaVersion', 'must equal 1');
  if (evidence.artifact !== ARTIFACT) addError(errors, 'ARTIFACT_NAME', '$.artifact', `must equal ${ARTIFACT}`);
  if (typeof evidence.capturedAt !== 'string' || !Number.isFinite(Date.parse(evidence.capturedAt))) {
    addError(errors, 'INVALID_TIMESTAMP', '$.capturedAt', 'must be an ISO-compatible timestamp');
  }
  if (!['COMPLETE', 'PARTIAL', 'NETWORK_UNAVAILABLE'].includes(evidence.probeStatus)) {
    addError(errors, 'TYPE_MISMATCH', '$.probeStatus', 'must be COMPLETE, PARTIAL, or NETWORK_UNAVAILABLE');
  }

  validateSafeguards(evidence.probe, errors);
  const bodyLimit = isObject(evidence.probe?.safeguards)
    && Number.isInteger(evidence.probe.safeguards.maxBodyInspectionBytes)
    ? evidence.probe.safeguards.maxBodyInspectionBytes
    : 1048576;

  if (!Array.isArray(evidence.requests)) {
    addError(errors, 'TYPE_MISMATCH', '$.requests', 'must be an array');
  } else {
    const ids = [];
    evidence.requests.forEach((item, index) => {
      const id = validateRequest(item, index, errors, bodyLimit);
      if (id !== null) ids.push(id);
    });
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) addError(errors, 'DUPLICATE_REQUEST', '$.requests', 'contains a duplicate request id');
      seen.add(id);
    }
    for (const id of EXPECTED_REQUESTS.keys()) {
      if (!seen.has(id)) addError(errors, 'REQUIRED_REQUEST_MISSING', '$.requests', `missing required request id ${id}`);
    }

    const networkSuccessCount = evidence.requests.filter((item) => item?.response?.networkOk === true).length;
    const expectedStatus = networkSuccessCount === evidence.requests.length
      ? 'COMPLETE'
      : networkSuccessCount === 0
        ? 'NETWORK_UNAVAILABLE'
        : 'PARTIAL';
    if (evidence.probeStatus !== expectedStatus) {
      addError(errors, 'STATUS_MISMATCH', '$.probeStatus', `must equal ${expectedStatus} for the recorded responses`);
    }
  }

  errors.push(...findSensitiveMaterial(evidence));
  return { ok: errors.length === 0, errors };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const current = resolve(fileURLToPath(import.meta.url));
  const invoked = resolve(process.argv[1]);
  return process.platform === 'win32'
    ? current.toLowerCase() === invoked.toLowerCase()
    : current === invoked;
}

function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3) {
    process.stderr.write('Usage: node scripts/r0-validate-evidence.mjs <redacted-evidence.json>\n');
    process.exitCode = 2;
    return;
  }

  let text;
  try {
    text = readFileSync(resolve(inputPath), 'utf8');
  } catch {
    process.stderr.write(JSON.stringify({ ok: false, errors: [{ code: 'READ_FAILED', path: '$', message: 'evidence file could not be read' }] }) + '\n');
    process.exitCode = 1;
    return;
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_EVIDENCE_BYTES) {
    process.stderr.write(JSON.stringify({ ok: false, errors: [{ code: 'EVIDENCE_TOO_LARGE', path: '$', message: 'evidence exceeds the 2 MiB limit' }] }) + '\n');
    process.exitCode = 1;
    return;
  }

  let evidence;
  try {
    evidence = JSON.parse(text);
  } catch {
    process.stderr.write(JSON.stringify({ ok: false, errors: [{ code: 'INVALID_JSON', path: '$', message: 'evidence is not valid JSON' }] }) + '\n');
    process.exitCode = 1;
    return;
  }

  const result = validateEvidence(evidence);
  if (!result.ok) {
    process.stderr.write(JSON.stringify(result) + '\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    artifact: evidence.artifact,
    requestCount: evidence.requests.length,
    probeStatus: evidence.probeStatus,
  }) + '\n');
}

if (isMainModule()) runCli();
