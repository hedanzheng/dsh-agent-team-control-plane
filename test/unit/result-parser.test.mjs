import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStructuredResult, RESULT_MARKERS } from '../../src/host/result-parser.js';

function output(value) {
  return [{ type: 'text', text: `work log\n${RESULT_MARKERS.start}\n${JSON.stringify(value)}\n${RESULT_MARKERS.end}` }];
}

test('structured Result parser accepts a bounded SUCCESS payload', () => {
  const parsed = parseStructuredResult(output({
    terminalKind: 'SUCCESS', changeSummary: 'changed one file', artifacts: ['phase3/a.txt'],
    verifiedActions: ['wrote phase3/a.txt'], testPlan: 'host verifies', risks: [], unresolved: [], findings: [], evidenceRefs: [], checkpoint: null, requestProposal: null,
  }));
  assert.equal(parsed.terminalKind, 'SUCCESS');
  assert.deepEqual(parsed.artifacts, ['phase3/a.txt']);
});

test('structured Result parser rejects missing markers and invalid NEEDS_INPUT checkpoint', () => {
  assert.throws(() => parseStructuredResult([{ type: 'text', text: '{}' }]), (error) => error.code === 'RESULT_PARSE_FAILED');
  assert.throws(() => parseStructuredResult(output({
    terminalKind: 'NEEDS_INPUT', changeSummary: 'blocked', artifacts: [], verifiedActions: [],
  })), (error) => error.code === 'RESULT_SCHEMA_INVALID');
});

test('structured Result parser normalizes bounded request proposal aliases', () => {
  const base = {
    terminalKind: 'NEEDS_INPUT', changeSummary: 'blocked', artifacts: [], verifiedActions: [],
    checkpoint: { progress: 'saved', changedFiles: [], pending: 'answer', nextStep: 'resume' },
  };
  const snake = parseStructuredResult(output({
    ...base,
    requestProposal: { to_agent_id: 'AGENT-REVIEWER', body: 'Which marker?', evidence_refs: ['decision:1'] },
  }));
  assert.deepEqual(snake.requestProposal, {
    toAgentId: 'AGENT-REVIEWER', body: 'Which marker?', blocking: true, evidenceRefs: ['decision:1'],
  });

  const observed = parseStructuredResult(output({
    ...base,
    requestProposal: { addressedTo: 'AGENT-REVIEWER', message: 'Which marker?', blocking: false },
  }));
  assert.deepEqual(observed.requestProposal, {
    toAgentId: 'AGENT-REVIEWER', body: 'Which marker?', blocking: false, evidenceRefs: [],
  });
});

test('structured Result parser ignores an empty non-blocking proposal and normalizes provider Finding objects', () => {
  const parsed = parseStructuredResult(output({
    terminalKind: 'SUCCESS', changeSummary: 'done', artifacts: [], verifiedActions: [],
    findings: [{ name: 'demo follow-up', blocking: false }],
    requestProposal: { toAgentId: '', body: '', blocking: false, evidenceRefs: [] },
  }));
  assert.equal(parsed.requestProposal, null);
  assert.deepEqual(parsed.findings, ['demo follow-up']);
});

