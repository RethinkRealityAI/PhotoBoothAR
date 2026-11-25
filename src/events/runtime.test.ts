import { describe, it, expect, vi } from 'vitest';

// runtime.ts imports the Supabase client, which throws without env in node.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { buildRuntimeConfig } from './runtime';
import { EVENT_TEMPLATES, isUntouchedTemplateTheme, templateById } from '../lib/eventTemplates';

const row = (config: Record<string, unknown> | null) => ({
  id: 'u', slug: 's', name: 'Ada', event_type: 'wedding', status: 'live', config, plan_tier: 'pro',
});

describe('isUntouchedTemplateTheme', () => {
  it('is true for no theme and for every template theme verbatim', () => {
    expect(isUntouchedTemplateTheme(undefined)).toBe(true);
    expect(isUntouchedTemplateTheme({})).toBe(true);
    for (const t of EVENT_TEMPLATES) expect(isUntouchedTemplateTheme({ ...t.themeVars }), t.id).toBe(true);
  });

  it('is false once any token differs, is added or is missing', () => {
    const w = templateById('wedding')!.themeVars;
    expect(isUntouchedTemplateTheme({ ...w, '--color-accent': '#FF0000' })).toBe(false);
    expect(isUntouchedTemplateTheme({ ...w, '--on-accent': '#000000' })).toBe(false);
    const { ['--color-accent']: _drop, ...partial } = w;
    expect(isUntouchedTemplateTheme(partial)).toBe(false);
  });
});

describe('buildRuntimeConfig — the brand look', () => {
  it('an explicit look wins and drops the theme tokens', () => {
    const cfg = buildRuntimeConfig(row({ look: 'beamwall', themeVars: { '--color-accent': '#FF0000' } }));
    expect(cfg.look).toBe('beamwall');
    expect(cfg.themeVars).toEqual({});
  });

  it('an event that never chose its colours gets it by default', () => {
    expect(buildRuntimeConfig(row({})).look).toBe('beamwall');
    expect(buildRuntimeConfig(row(null)).look).toBe('beamwall');
    const seeded = buildRuntimeConfig(row({ themeVars: { ...templateById('gala')!.themeVars } }));
    expect(seeded.look).toBe('beamwall');
    expect(seeded.themeVars).toEqual({});
  });

  it('a host-edited theme is kept, and so is Branding’s explicit opt-out', () => {
    const edited = { ...templateById('wedding')!.themeVars, '--color-accent': '#C2185B' };
    const kept = buildRuntimeConfig(row({ themeVars: edited }));
    expect(kept.look).toBeUndefined();
    expect(kept.themeVars).toEqual(edited);
    const optOut = buildRuntimeConfig(row({ look: null, themeVars: { ...templateById('wedding')!.themeVars } }));
    expect(optOut.look).toBeUndefined();
    expect(optOut.themeVars).toEqual(templateById('wedding')!.themeVars);
  });
});

describe('buildRuntimeConfig — splash phone picture', () => {
  it('carries a root-relative or public-storage picture, drops anything else', () => {
    expect(buildRuntimeConfig(row({ boothScreen: '/events/x/wall/1.jpg' })).boothScreen).toBe('/events/x/wall/1.jpg');
    expect('boothScreen' in buildRuntimeConfig(row({}))).toBe(false);
    expect('boothScreen' in buildRuntimeConfig(row({ boothScreen: 'javascript:alert(1)' }))).toBe(false);
    expect('boothScreen' in buildRuntimeConfig(row({ boothScreen: '//evil.example/a.jpg' }))).toBe(false);
  });
});

describe('buildRuntimeConfig — guest-page scene', () => {
  it('absent or invalid scene leaves the key off (today\'s background)', () => {
    expect('scene' in buildRuntimeConfig(row({}))).toBe(false);
    expect('scene' in buildRuntimeConfig(row({ scene: { kind: 'image', url: 'javascript:alert(1)' } }))).toBe(false);
  });
  it('a valid scene is carried normalized', () => {
    expect(buildRuntimeConfig(row({ scene: { kind: 'template', id: 'pearl-studio' } })).scene)
      .toEqual({ kind: 'template', id: 'pearl-studio' });
    expect(buildRuntimeConfig(row({ scene: { kind: 'color', color: ' #112233 ' } })).scene)
      .toEqual({ kind: 'color', color: '#112233' });
  });
});

describe('buildRuntimeConfig — theme packs', () => {
  it('absent or unknown = no theme, and the rest of the config is unchanged', () => {
    const base = buildRuntimeConfig(row({ look: 'beamwall', fontHref: '/x.css' }));
    expect('theme' in base).toBe(false);
    const unknown = buildRuntimeConfig(row({ look: 'beamwall', fontHref: '/x.css', theme: { pack: 'nope' } }));
    // JSON: the per-call visual components differ by identity only.
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(base));
  });

  it('a pack IS the look: its tokens, its fonts, never the brand look', () => {
    const cfg = buildRuntimeConfig(row({
      look: 'beamwall',
      themeVars: { '--color-accent': '#FF0000' },
      theme: { pack: 'island-golden-hour' },
    }));
    expect(cfg.theme).toEqual({ pack: 'island-golden-hour' });
    expect(cfg.look).toBeUndefined();
    expect(cfg.themeVars?.['--color-accent']).toBe('#E2B04A');
    expect(cfg.themeVars?.['--tp-cta-bg']).toMatch(/gradient/);
    expect(cfg.fontHref).toBe('/fonts/theme-packs.css');
  });
});
