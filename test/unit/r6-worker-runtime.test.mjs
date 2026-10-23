import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { AgentTeamControlPlane } from '../../src/host/control-plane.js';
import { ControlPlaneStore } from '../../src/host/store.js';

const OWNER = { type: 'human', id: 'human-owner' };

function operation(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function scanner() {
  return {
    async scan() {
      const lastScannedAt = new Date().toISOString();
      return {
        scannedAt: lastScannedAt,
        runtimes: [
          {
            providerKey: 'harness:deepseek-official', kind: 'harness-agent', displayName: 'DeepSeek Official',
            availability: 'AVAILABLE', capabilities: { oneShot: true, sessionResume: true }, source: 'mock-host', lastScannedAt,
          },
          {
            providerKey: 'subagent:codex', kind: 'external-worker', displayName: 'codex one-shot Worker',
            availability: 'AVAILABLE', capabilities: { oneShot: true }, source: 'mock-host', lastScannedAt,
          },
          {
            providerKey: 'subagent:spawn', kind: 'external-worker', displayName: 'spawn one-shot Worker',
            availability: 'AVAILABLE', capabilities: { oneShot: true }, source: 'mock-host', lastScannedAt,
          },
        ],
        skillDiscovery: { complete: true, grillMeAvailable: false, skills: [] },
        errors: [],
      };
    },
  };
}

test('R6 Project creation persists the chosen Worker runtime and defaults only when omitted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atcp-r6-worker-'));
  const database = join(root, 'control-plane.sqlite');
  let store = new ControlPlaneStore(database);
  try {
    let plane = new AgentTeamControlPlane(store, scanner());
    let state = await plane.rescanRuntimes({ actor: OWNER, operationId: operation('scan'), cwd: root });
    for (const runtime of state.runtimes) {
      state = plane.authorizeRuntime({ actor: OWNER, operationId: operation('authorize'), providerKey: runtime.providerKey, authorized: true });
    }

    assert.throws(() => plane.createProject({
      actor: OWNER, operationId: operation('wrong-kind'), ownerId: OWNER.id,
      name: 'Wrong Worker kind', workspaceDir: root, initialGoal: 'Reject a PL runtime as Worker.',
      maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official', workerRuntimeKey: 'harness:deepseek-official',
    }), (error) => error.code === 'INVALID_WORKER_RUNTIME');

    state = plane.createProject({
      actor: OWNER, operationId: operation('default-worker'), ownerId: OWNER.id,
      name: 'Default Worker', workspaceDir: root, initialGoal: 'Use the Host default Worker runtime.',
      maxAgents: 3, leadRuntimeKey: 'harness:deepseek-official',
    });
    assert.equal(state.selected.project.workerRuntimeKey, 'subagent:codex');

    state = plane.createProject({
      actor: OWNER, operationId: operation('selected-worker'), ownerId: OWNER.id,
      name: 'Selected Worker', workspaceDir: root, initialGoal: 'Use the explicitly selected Worker runtime.',
      maxAgents: 4, leadRuntimeKey: 'harness:deepseek-official', workerRuntimeKey: 'subagent:spawn',
    });
    const projectId = state.selected.project.id;
    assert.equal(state.selected.project.workerRuntimeKey, 'subagent:spawn');

    state = plane.answerInterview({
      actor: OWNER, operationId: operation('interview'), projectId,
      expectedVersion: state.selected.project.version,
      answers: { scope_allowed: ['src/**'], constraints: ['bounded'], success_criteria: ['tests pass'] },
    });
    state = plane.approveCharter({
      actor: OWNER, operationId: operation('approve-charter'), projectId,
      expectedVersion: state.selected.project.version,
    });
    const members = state.selected.approvals.find((item) => item.kind === 'TEAM' && item.status === 'PENDING').payload.members;
    assert.ok(members.filter((member) => member.role === 'WORKER').every((member) => member.providerKey === 'subagent:spawn'));

    store.close();
    store = null;
    store = new ControlPlaneStore(database);
    plane = new AgentTeamControlPlane(store, scanner());
    assert.equal(plane.snapshot(projectId).selected.project.workerRuntimeKey, 'subagent:spawn');
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('schema v9 migrates an existing Project Worker assignment into the Project default', () => {
  const root = mkdtempSync(join(tmpdir(), 'atcp-r6-migration-'));
  const database = join(root, 'legacy.sqlite');
  const legacy = new DatabaseSync(database);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE runtime_sources (
      provider_key TEXT PRIMARY KEY, kind TEXT NOT NULL, display_name TEXT NOT NULL,
      availability TEXT NOT NULL, authorized INTEGER NOT NULL DEFAULT 0,
      capabilities_json TEXT NOT NULL, source TEXT NOT NULL, last_scanned_at TEXT NOT NULL, scan_error TEXT
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, lead_agent_id TEXT,
      lead_runtime_key TEXT NOT NULL REFERENCES runtime_sources(provider_key), workspace_dir TEXT NOT NULL,
      initial_goal TEXT NOT NULL, charter_version INTEGER NOT NULL DEFAULT 0, max_agents INTEGER NOT NULL,
      replan_every_n INTEGER NOT NULL DEFAULT 5, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      pl_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL, provider_key TEXT NOT NULL REFERENCES runtime_sources(provider_key),
      role TEXT NOT NULL, permissions_json TEXT NOT NULL, skills_json TEXT NOT NULL, status TEXT NOT NULL,
      current_task_id TEXT, replaces_agent_id TEXT REFERENCES agents(id), created_at TEXT NOT NULL
    );
    INSERT INTO runtime_sources VALUES
      ('harness:deepseek-official','harness-agent','DeepSeek','AVAILABLE',1,'{}','legacy','2026-10-23T00:00:00.000Z',NULL),
      ('subagent:spawn','external-worker','spawn Worker','AVAILABLE',1,'{}','legacy','2026-10-23T00:00:00.000Z',NULL);
    INSERT INTO projects VALUES
      ('PROJECT-LEGACY','Legacy','human-owner','AGENT-PL','harness:deepseek-official','D:\\work','legacy',1,3,5,'ACTIVE',7,NULL,'2026-10-23T00:00:00.000Z','2026-10-23T00:00:00.000Z');
    INSERT INTO agents VALUES
      ('AGENT-PL','PROJECT-LEGACY','Project Lead','harness:deepseek-official','PROJECT_LEAD','[]','[]','IDLE',NULL,NULL,'2026-10-23T00:00:00.000Z'),
      ('AGENT-WORKER','PROJECT-LEGACY','Implementation Worker','subagent:spawn','WORKER','[]','[]','IDLE',NULL,NULL,'2026-10-23T00:00:00.000Z');
  `);
  legacy.close();

  const store = new ControlPlaneStore(database);
  try {
    assert.equal(store.getProject('PROJECT-LEGACY').workerRuntimeKey, 'subagent:spawn');
    assert.equal(store.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value, '9');
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('R6 Panel exposes Worker selection and has no redundant return-to-PL button', () => {
  const source = readFileSync(resolve('client.js'), 'utf8');
  assert.match(source, /data-testid': 'project-workerRuntimeKey'/);
  assert.match(source, /Worker Runtime（可选）/);
  assert.match(source, /same-workspace-warning/);
  assert.match(source, /下一步交给 PL 诊断/);
  assert.doesNotMatch(source, /data-testid': 'return-pl-chat'/);
});
