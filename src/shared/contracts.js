import { randomUUID } from 'node:crypto';

export const PROJECT_STATUS = Object.freeze([
  'CHARTER_INTERVIEW',
  'CHARTER_PENDING_APPROVAL',
  'TEAM_PENDING_APPROVAL',
  'ACTIVE',
  'COMPLETED',
  'STOPPED',
]);

export const CHARTER_STATUS = Object.freeze(['DRAFT', 'APPROVED', 'SUPERSEDED']);
export const AGENT_STATUS = Object.freeze(['PENDING_APPROVAL', 'IDLE', 'RUNNING', 'WAITING', 'UNAVAILABLE', 'REPLACED']);
export const AGENT_ROLE = Object.freeze(['PROJECT_LEAD', 'WORKER', 'REVIEWER']);
export const RUNTIME_AVAILABILITY = Object.freeze(['AVAILABLE', 'NOT_CONFIGURED', 'UNSUPPORTED', 'UNVERIFIED']);
export const TASK_STATUS = Object.freeze([
  'PENDING', 'READY', 'RUNNING', 'WAITING', 'SUBMITTED', 'VERIFIED', 'FAILED', 'CANCELLED',
]);
export const CONTROL_LEVEL = Object.freeze(['ROUTINE', 'IMPORTANT', 'CRITICAL']);
export const REVIEW_POLICY = Object.freeze(['AUTO', 'PL', 'REVIEWER_PL']);
export const CHARTER_IMPACT = Object.freeze(['NONE', 'MISSION', 'SCOPE', 'CONSTRAINTS']);
export const VERIFICATION_COMMAND_STATUS = Object.freeze(['APPROVED', 'REVOKED']);
export const TASK_PROPOSAL_STATUS = Object.freeze(['PENDING', 'ACCEPTED', 'REJECTED']);
export const TASK_RUN_STATUS = Object.freeze([
  'CREATED', 'STARTING', 'RUNNING', 'SUCCEEDED', 'NEEDS_INPUT', 'PARTIAL',
  'FAILED', 'CANCELLED', 'TIMED_OUT', 'CANNOT_START', 'UNKNOWN',
]);
export const RESULT_OUTCOME = Object.freeze([
  'SUCCESS', 'PARTIAL', 'NEEDS_INPUT', 'CANNOT_START', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN',
]);
export const REQUEST_STATUS = Object.freeze(['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'TIMED_OUT']);
export const RESPONSE_OUTCOME = Object.freeze(['ANSWER', 'UNABLE_TO_ANSWER', 'REQUEST_TIMEOUT']);
export const REVIEW_DECISION = Object.freeze(['APPROVE', 'REJECT']);
export const FINDING_STATUS = Object.freeze(['OPEN', 'LINKED_TO_TASK', 'CLOSED']);

export class ControlPlaneError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'ControlPlaneError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function id(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function now() {
  return new Date().toISOString();
}

export function requireString(value, field, { min = 1, max = 4000 } = {}) {
  if (typeof value !== 'string') throw new ControlPlaneError('INVALID_INPUT', `${field} must be a string`);
  const result = value.trim();
  if (result.length < min || result.length > max) {
    throw new ControlPlaneError('INVALID_INPUT', `${field} length must be between ${min} and ${max}`);
  }
  return result;
}

export function requireStringArray(value, field, { min = 0, max = 32, itemMax = 1000 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new ControlPlaneError('INVALID_INPUT', `${field} must contain between ${min} and ${max} items`);
  }
  return value.map((item, index) => requireString(item, `${field}[${index}]`, { max: itemMax }));
}

export function requireInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ControlPlaneError('INVALID_INPUT', `${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function requireActor(actor) {
  if (!actor || !['human', 'pl', 'agent'].includes(actor.type)) {
    throw new ControlPlaneError('UNAUTHORIZED', 'actor.type must be human, pl, or agent', 403);
  }
  return { type: actor.type, id: requireString(actor.id, 'actor.id', { max: 128 }) };
}

export function assertExpectedVersion(project, expectedVersion) {
  requireInteger(expectedVersion, 'expectedVersion', { min: 1 });
  if (project.version !== expectedVersion) {
    throw new ControlPlaneError('VERSION_CONFLICT', 'project version changed; reload before retrying', 409, {
      expectedVersion,
      actualVersion: project.version,
    });
  }
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return JSON.parse(value);
}

export function json(value) {
  return JSON.stringify(value);
}

export const FALLBACK_INTERVIEW = Object.freeze([
  { id: 'scope_allowed', prompt: '哪些目录、模块或交付物明确属于本项目范围？' },
  { id: 'constraints', prompt: '有哪些禁止修改项、技术约束或时间约束？' },
  { id: 'success_criteria', prompt: '满足哪些可验证条件才算项目成功？' },
]);

export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  PROJECT_LEAD: [
    'project:read', 'charter:draft', 'team:propose', 'agent:manage-within-approved-limit',
    'task:create', 'task:assign', 'review:decide', 'activity:read',
  ],
  WORKER: ['project:read', 'charter:read', 'task:execute-assigned', 'result:submit', 'request:create', 'response:submit', 'finding:report', 'task:propose'],
  REVIEWER: ['project:read', 'charter:read', 'task:review-assigned', 'review:submit', 'response:submit', 'finding:report', 'task:propose'],
});
