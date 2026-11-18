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
