import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function loadClientPlugin() {
  let definition;
  const window = { __ModuleLoader__: { load(value) { definition = value; } } };
  new Function('window', readFileSync(resolve('client.js'), 'utf8'))(window);
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...(props || {}), children } }; },
    useState() { throw new Error('component rendering is not needed in this test'); },
  };
  return definition.factory((name) => {
    assert.equal(name, 'react');
    return React;
  });
}

function clientFixture({ existingSessions = {} } = {}) {
  const plugin = loadClientPlugin();
  let panelRenderer;
  const calls = [];
  const ctx = {
    slots: {
      inject(_slot, install) { install(); },
      register(meta, renderer) { if (meta.name === 'main') panelRenderer = renderer; return () => {}; },
    },
    layout: { selectPanel() {} },
    uiWorkspace: {
      openSession(sessionId) { calls.push(['openSession', sessionId]); },
      async openWorkspace(workspaceId, beforeOpen, options) {
        calls.push(['openWorkspace', workspaceId, options]);
        beforeOpen('SESSION-NEW');
      },
    },
    sessions: {
      list: { getSnapshot: () => ({ current: 'SESSION-CURRENT', ids: Object.keys(existingSessions), byId: existingSessions }) },
      binding: () => ({ ctx: { id: 'binding-context' } }),
    },
    workspaces: {
      list: { getSnapshot: () => ({ items: [{ workspaceId: 'WORKSPACE-1', path: 'D:/work', createdAt: '2026-10-23T00:00:00.000Z', sessionIds: ['SESSION-CURRENT'] }] }) },
    },
    conversation: {
      input: {
        requestDraftInitialization(_binding, input) { calls.push(['initializeDraft', input.prompt]); return 'initialized'; },
        for() { return { submit() { calls.push(['submit']); } }; },
      },
    },
  };
  plugin.apply(ctx);
  const panel = panelRenderer();
  return { calls, openPLChat: panel.props.onOpenPLChat };
}

const PROJECT = {
  id: 'PROJECT-1', name: 'R5 session', workspaceDir: 'D:/work', status: 'ACTIVE', initialGoal: 'test',
};

test('R5 Panel returns to the one bound PL Session and never creates another', async () => {
  const fx = clientFixture({ existingSessions: { 'SESSION-BOUND': { id: 'SESSION-BOUND' } } });
  const result = await fx.openPLChat({ project: { ...PROJECT, plSessionId: 'SESSION-BOUND' } });
  assert.equal(result.reused, true);
  assert.deepEqual(fx.calls, [['openSession', 'SESSION-BOUND']]);
});

test('R5 Panel binds a newly created PL Session before submitting its first prompt', async () => {
  const fx = clientFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    fx.calls.push(['bind', body.projectId, body.plSessionId]);
    return { ok: true, async json() { return { ok: true, data: {} }; } };
  };
  try {
    const result = await fx.openPLChat({ project: { ...PROJECT, plSessionId: null } });
    assert.equal(result.reused, false);
    assert.equal(result.sessionId, 'SESSION-NEW');
    assert.deepEqual(fx.calls.map((call) => call[0]), ['openWorkspace', 'initializeDraft', 'bind', 'submit']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

