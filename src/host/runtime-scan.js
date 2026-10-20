import { now } from '../shared/contracts.js';

const CODEX_CAPABILITIES = Object.freeze({
  oneShot: true,
  sessionResume: false,
  liveTeamRequest: false,
  progressStream: false,
  cancel: true,
  cwdOverride: true,
  toolInjection: false,
  permissionEnforced: true,
});

export class HostRuntimeScanner {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async scan(cwd = process.cwd()) {
    const scannedAt = now();
    const runtimes = [];
    const errors = [];
    for (const provider of this.ctx.llm.listProviders()) {
      try {
        const models = await this.ctx.llm.listModels(provider.id);
        runtimes.push({
          providerKey: `harness:${provider.id}`,
          kind: 'harness-agent',
          displayName: provider.name,
          availability: models.length > 0 ? 'AVAILABLE' : 'NOT_CONFIGURED',
          capabilities: {
            oneShot: true,
            sessionResume: true,
            liveTeamRequest: true,
            progressStream: true,
            cancel: null,
            cwdOverride: true,
            toolInjection: true,
            permissionEnforced: true,
            models: models.map((model) => ({ id: model.id, name: model.name ?? model.id })),
          },
          source: 'ctx.llm.listProviders/listModels',
          lastScannedAt: scannedAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ source: `llm:${provider.id}`, message });
        runtimes.push({
          providerKey: `harness:${provider.id}`,
          kind: 'harness-agent',
          displayName: provider.name,
          availability: 'NOT_CONFIGURED',
          capabilities: {},
          source: 'ctx.llm.listProviders/listModels',
          lastScannedAt: scannedAt,
          scanError: message,
        });
      }
    }

    for (const providerName of this.ctx.subagents.list()) {
      runtimes.push({
        providerKey: `subagent:${providerName}`,
        kind: 'external-worker',
        displayName: `${providerName} one-shot Worker`,
        availability: 'AVAILABLE',
        capabilities: providerName === 'codex' ? CODEX_CAPABILITIES : {
          oneShot: true,
          sessionResume: false,
          liveTeamRequest: false,
          progressStream: false,
          cancel: null,
          cwdOverride: null,
          toolInjection: false,
          permissionEnforced: null,
        },
        source: 'ctx.subagents.list',
        lastScannedAt: scannedAt,
      });
    }

    let skillDiscovery;
    try {
      const observation = await this.ctx.skills.snapshot({ cwd });
      const names = observation.skills.map((skill) => skill.name);
      skillDiscovery = {
        complete: observation.complete,
        grillMeAvailable: names.includes('grill-me'),
        skills: names,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ source: 'skills', message });
      skillDiscovery = { complete: false, grillMeAvailable: false, skills: [], error: message };
    }

    return { scannedAt, runtimes, skillDiscovery, errors };
  }
}
