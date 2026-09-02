/**
 * Pulls supabase/functions/ai-event-designer/profiles.ts under vitest AND tsc
 * (tsconfig excludes supabase/, but a src import drags the module into
 * `npm run lint`) — the module must therefore stay Deno-free.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AGENT_PROFILES,
  THINKING_HEADROOM,
  resolveProfile,
  type AgentMode,
} from '../../supabase/functions/ai-event-designer/profiles.ts';

const MODES: AgentMode[] = ['create', 'copilot', 'scene'];
const noEnv = () => undefined;
const envOf = (vars: Record<string, string | undefined>) => (key: string) => vars[key];

describe('AGENT_PROFILES defaults', () => {
  it('match the plan (model · temperature · thinking · max tokens · timeout)', () => {
    expect(AGENT_PROFILES.create).toEqual({ model: 'gemini-2.5-flash', temperature: 0.6, thinkingBudget: 0, maxOutputTokens: 2048, timeoutMs: 25_000 });
    expect(AGENT_PROFILES.copilot).toEqual({ model: 'gemini-2.5-flash', temperature: 0.2, thinkingBudget: 0, maxOutputTokens: 3072, timeoutMs: 25_000 });
    expect(AGENT_PROFILES.scene).toEqual({ model: 'gemini-2.5-flash', temperature: 0.5, thinkingBudget: 512, maxOutputTokens: 4096, timeoutMs: 40_000 });
  });

  it('only scene thinks (create/copilot are structured extraction → budget 0)', () => {
    expect(AGENT_PROFILES.create.thinkingBudget).toBe(0);
    expect(AGENT_PROFILES.copilot.thinkingBudget).toBe(0);
    expect(AGENT_PROFILES.scene.thinkingBudget).toBeGreaterThan(0);
  });

  it('every default already satisfies maxOutputTokens > thinkingBudget + headroom', () => {
    for (const mode of MODES) {
      const p = AGENT_PROFILES[mode];
      expect(p.maxOutputTokens).toBeGreaterThan(p.thinkingBudget + THINKING_HEADROOM);
    }
  });
});

describe('resolveProfile without env', () => {
  it('returns the defaults for every mode, as a fresh object', () => {
    for (const mode of MODES) {
      const p = resolveProfile(mode, noEnv);
      expect(p).toEqual(AGENT_PROFILES[mode]);
      expect(p).not.toBe(AGENT_PROFILES[mode]);
    }
  });

  it('reads the upper-cased mode suffix for all four keys', () => {
    const seen: string[] = [];
    resolveProfile('copilot', (k) => { seen.push(k); return undefined; });
    expect(seen.sort()).toEqual([
      'GEMINI_MAX_TOKENS_COPILOT',
      'GEMINI_MODEL_COPILOT',
      'GEMINI_TEMPERATURE_COPILOT',
      'GEMINI_THINKING_COPILOT',
    ]);
  });
});

describe('resolveProfile env overrides', () => {
  it('GEMINI_MODEL_<MODE> — accepted, trimmed, quotes stripped', () => {
    expect(resolveProfile('create', envOf({ GEMINI_MODEL_CREATE: 'gemini-2.5-pro' })).model).toBe('gemini-2.5-pro');
    expect(resolveProfile('scene', envOf({ GEMINI_MODEL_SCENE: ' "gemini-2.5-flash-lite"\n' })).model).toBe('gemini-2.5-flash-lite');
    // Another mode's key never leaks across.
    expect(resolveProfile('copilot', envOf({ GEMINI_MODEL_CREATE: 'gemini-2.5-pro' })).model).toBe('gemini-2.5-flash');
  });

  it('GEMINI_MODEL_<MODE> — invalid ids are ignored', () => {
    for (const bad of ['', '   ', 'gemini 2.5', 'models/gemini-2.5-pro', 'gemini_2.5', '"" ', 'x;rm']) {
      expect(resolveProfile('create', envOf({ GEMINI_MODEL_CREATE: bad })).model).toBe('gemini-2.5-flash');
    }
  });

  it('GEMINI_THINKING_<MODE> — integer 0..8192', () => {
    expect(resolveProfile('copilot', envOf({ GEMINI_THINKING_COPILOT: '1024' })).thinkingBudget).toBe(1024);
    expect(resolveProfile('scene', envOf({ GEMINI_THINKING_SCENE: '0' })).thinkingBudget).toBe(0);
    expect(resolveProfile('scene', envOf({ GEMINI_THINKING_SCENE: ' "256" ' })).thinkingBudget).toBe(256);
    for (const bad of ['-1', '8193', '1.5', 'abc', '', 'NaN', '1e3', 'Infinity']) {
      expect(resolveProfile('scene', envOf({ GEMINI_THINKING_SCENE: bad })).thinkingBudget).toBe(512);
    }
  });

  it('GEMINI_TEMPERATURE_<MODE> — number 0..2', () => {
    expect(resolveProfile('create', envOf({ GEMINI_TEMPERATURE_CREATE: '0.9' })).temperature).toBe(0.9);
    expect(resolveProfile('create', envOf({ GEMINI_TEMPERATURE_CREATE: '0' })).temperature).toBe(0);
    expect(resolveProfile('create', envOf({ GEMINI_TEMPERATURE_CREATE: '2' })).temperature).toBe(2);
    for (const bad of ['2.1', '-0.1', 'NaN', 'Infinity', '', 'warm']) {
      expect(resolveProfile('create', envOf({ GEMINI_TEMPERATURE_CREATE: bad })).temperature).toBe(0.6);
    }
  });

  it('GEMINI_MAX_TOKENS_<MODE> — integer 256..8192', () => {
    expect(resolveProfile('copilot', envOf({ GEMINI_MAX_TOKENS_COPILOT: '4096' })).maxOutputTokens).toBe(4096);
    expect(resolveProfile('create', envOf({ GEMINI_MAX_TOKENS_CREATE: '8192' })).maxOutputTokens).toBe(8192);
    for (const bad of ['255', '8193', '2048.5', 'lots', '']) {
      expect(resolveProfile('copilot', envOf({ GEMINI_MAX_TOKENS_COPILOT: bad })).maxOutputTokens).toBe(3072);
    }
  });

  it('never overrides timeoutMs', () => {
    expect(resolveProfile('scene', envOf({ GEMINI_TIMEOUT_SCENE: '1' })).timeoutMs).toBe(40_000);
  });
});

describe('thinking/output invariant', () => {
  it('raises maxOutputTokens instead of throwing when a thinking override eats the budget', () => {
    const p = resolveProfile('copilot', envOf({ GEMINI_THINKING_COPILOT: '4096' }));
    expect(p.thinkingBudget).toBe(4096);
    expect(p.maxOutputTokens).toBeGreaterThan(4096 + THINKING_HEADROOM);
  });

  it('raises when both overrides are valid individually but conflict together', () => {
    const p = resolveProfile('scene', envOf({ GEMINI_THINKING_SCENE: '1024', GEMINI_MAX_TOKENS_SCENE: '1024' }));
    expect(p.thinkingBudget).toBe(1024);
    expect(p.maxOutputTokens).toBeGreaterThan(1024 + THINKING_HEADROOM);
  });

  it('leaves a satisfying override alone', () => {
    const p = resolveProfile('scene', envOf({ GEMINI_THINKING_SCENE: '1024', GEMINI_MAX_TOKENS_SCENE: '2048' }));
    expect(p.maxOutputTokens).toBe(2048);
  });

  it('holds for every mode under any override combination tried', () => {
    for (const mode of MODES) {
      for (const thinking of ['0', '512', '4096', '8192']) {
        for (const max of ['256', '1024', '8192']) {
          const key = mode.toUpperCase();
          const p = resolveProfile(mode, envOf({ [`GEMINI_THINKING_${key}`]: thinking, [`GEMINI_MAX_TOKENS_${key}`]: max }));
          expect(p.maxOutputTokens).toBeGreaterThan(p.thinkingBudget + THINKING_HEADROOM);
        }
      }
    }
  });
});

describe('module hygiene', () => {
  const source = readFileSync(new URL('../../supabase/functions/ai-event-designer/profiles.ts', import.meta.url), 'utf8');

  it('is Deno-free (no Deno global, no jsr: imports) so it runs under vitest + tsc', () => {
    expect(source).not.toMatch(/\bDeno\b/);
    expect(source).not.toMatch(/['"]jsr:/);
    expect(source).not.toMatch(/['"]npm:/);
  });

  it('documents why only scene thinks and the empty-MAX_TOKENS failure mode', () => {
    expect(source).toMatch(/MAX_TOKENS/);
    expect(source).toMatch(/creative/i);
  });
});
