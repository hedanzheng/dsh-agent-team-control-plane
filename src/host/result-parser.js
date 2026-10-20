import { ControlPlaneError, requireString, requireStringArray } from '../shared/contracts.js';

const START = 'AGENT_TEAM_RESULT_START';
const END = 'AGENT_TEAM_RESULT_END';
const TERMINAL = ['SUCCESS', 'PARTIAL', 'NEEDS_INPUT', 'CANNOT_START', 'FAILED'];

function optionalArray(value, field, max = 64) {
  if (value === undefined || value === null) return [];
  return requireStringArray(value, field, { max, itemMax: 2000 });
}

function optionalString(value, field, max = 10000) {
  if (value === undefined || value === null || value === '') return '';
  return requireString(value, field, { max });
}

function optionalFindings(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new ControlPlaneError('INVALID_INPUT', 'findings must be an array with at most 64 items', 400);
  }
  return value.map((item, index) => {
    if (typeof item === 'string') return requireString(item, `findings[${index}]`, { max: 2000 });
    if (item && typeof item === 'object') {
      return requireString(item.description ?? item.name, `findings[${index}].description`, { max: 2000 });
    }
    throw new ControlPlaneError('INVALID_INPUT', `findings[${index}] must be a string or bounded object`, 400);
  });
}

export function outputText(output) {
  if (!Array.isArray(output)) return '';
  return output.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text).join('\n');
}

export function parseStructuredResult(output) {
  const text = outputText(output);
  const start = text.lastIndexOf(START);
  const end = start < 0 ? -1 : text.indexOf(END, start + START.length);
  if (start < 0 || end < 0) {
    throw new ControlPlaneError('RESULT_PARSE_FAILED', 'terminal output did not contain the required result markers', 409);
  }
  let value;
  try {
    const encoded = text.slice(start + START.length, end).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    value = JSON.parse(encoded);
  } catch (error) {
    throw new ControlPlaneError('RESULT_PARSE_FAILED', `terminal JSON is invalid: ${error instanceof Error ? error.message : String(error)}`, 409);
  }
  const terminalKind = requireString(value.terminalKind, 'terminalKind', { max: 32 }).toUpperCase();
  if (!TERMINAL.includes(terminalKind)) throw new ControlPlaneError('RESULT_SCHEMA_INVALID', `unsupported terminalKind ${terminalKind}`, 409);
  const checkpoint = value.checkpoint && typeof value.checkpoint === 'object' ? {
    progress: optionalString(value.checkpoint.progress, 'checkpoint.progress', 5000),
    changedFiles: optionalArray(value.checkpoint.changedFiles, 'checkpoint.changedFiles'),
    pending: optionalString(value.checkpoint.pending, 'checkpoint.pending', 5000),
    nextStep: optionalString(value.checkpoint.nextStep, 'checkpoint.nextStep', 5000),
  } : null;
  const proposal = value.requestProposal && typeof value.requestProposal === 'object'
    ? value.requestProposal
    : null;
  // The implementation spec uses snake_case while current prompts use camelCase.
  // Normalize both, plus the two names emitted by an observed real provider, before
  // applying the same strict bounds. This is syntax compatibility, not free-form
  // state inference: the Host still validates the target, budget, cycles and scope.
  const hasProposal = Boolean(proposal && (
    proposal.toAgentId || proposal.to_agent_id || proposal.addressedTo || proposal.body || proposal.message
  ));
  const requestProposal = hasProposal ? {
    toAgentId: requireString(
      proposal.toAgentId ?? proposal.to_agent_id ?? proposal.addressedTo,
      'requestProposal.toAgentId',
      { max: 128 },
    ),
    body: requireString(proposal.body ?? proposal.message, 'requestProposal.body', { max: 5000 }),
    blocking: proposal.blocking === undefined ? true : Boolean(proposal.blocking),
    evidenceRefs: optionalArray(proposal.evidenceRefs ?? proposal.evidence_refs, 'requestProposal.evidenceRefs', 32),
  } : null;
  if (terminalKind === 'NEEDS_INPUT' && !checkpoint) {
    throw new ControlPlaneError('RESULT_SCHEMA_INVALID', 'NEEDS_INPUT requires checkpoint', 409);
  }
  if (terminalKind === 'NEEDS_INPUT' && !requestProposal) {
    throw new ControlPlaneError('RESULT_SCHEMA_INVALID', 'NEEDS_INPUT requires a non-empty requestProposal', 409);
  }
  return {
    terminalKind,
    changeSummary: requireString(value.changeSummary, 'changeSummary', { max: 10000 }),
    artifacts: optionalArray(value.artifacts, 'artifacts'),
    verifiedActions: optionalArray(value.verifiedActions, 'verifiedActions'),
    testPlan: optionalString(value.testPlan, 'testPlan', 10000),
    risks: optionalArray(value.risks, 'risks'),
    unresolved: optionalArray(value.unresolved, 'unresolved'),
    findings: optionalFindings(value.findings),
    evidenceRefs: optionalArray(value.evidenceRefs, 'evidenceRefs'),
    checkpoint,
    requestProposal,
    rawOutputExcerpt: text.slice(-20000),
  };
}

export const RESULT_MARKERS = Object.freeze({ start: START, end: END });
