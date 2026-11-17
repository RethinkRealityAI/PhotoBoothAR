import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CREATE_EVENT_TYPES, EVENT_TEMPLATES, paletteThemePatch, templateById, templateConfigPatch } from './eventTemplates';
import { contrastRatio } from './themeDerive';
import { BORDER_MAP } from './borders';
import { FILTER_SHADERS } from './shaders';

const THEME_KEYS = [
  '--color-accent', '--color-accent-2', '--color-accent-3',
  '--color-brand-bg', '--color-brand-surface', '--color-brand-fg', '--color-brand-muted',
  '--accent-rgb',
];
const SHADER_IDS = new Set(FILTER_SHADERS.map((s) => s.id));

describe('event templates — integrity', () => {
  it('exposes the five expected templates with unique ids', () => {
    const ids = EVENT_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(['wedding', 'gala', 'birthday', 'corporate', 'party']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template fully re-themes (all 8 tokens set) and has accent colours', () => {
    for (const t of EVENT_TEMPLATES) {
      for (const k of THEME_KEYS) {
        expect(t.themeVars[k], `${t.id} missing ${k}`).toBeTruthy();
      }
      expect(t.accentHexes.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('only references frames + shaders that actually exist (no dangling ids)', () => {
    for (const t of EVENT_TEMPLATES) {
      expect(t.borderIds.length).toBeGreaterThan(0);
      expect(t.shaderIds.length).toBeGreaterThan(0);
      for (const b of t.borderIds) expect(BORDER_MAP[b], `${t.id} frame ${b}`).toBeTruthy();
      for (const s of t.shaderIds) expect(SHADER_IDS.has(s), `${t.id} shader ${s}`).toBe(true);
    }
  });

  it('uses only neutral frames — never an event-locked (baked-text) one', () => {
    // These built-ins bake in SCAGO / Hope Gala / couple names and must not seed a customer event.
    const LOCKED = new Set([
      'frame-classic', 'frame-hexagon', 'frame-deco', 'frame-minimal',
      'sticker-hopegala', 'sticker-hopegala-top', 'sticker-crown',
      'dw-frame-monogram', 'dw-banner', 'jj-lower-third',
    ]);
    for (const t of EVENT_TEMPLATES) {
      for (const b of t.borderIds) expect(LOCKED.has(b), `${t.id} uses locked frame ${b}`).toBe(false);
      expect(LOCKED.has(t.frameId)).toBe(false);
    }
  });

  it('the representative frame is one of the template’s own frames', () => {
    for (const t of EVENT_TEMPLATES) {
      expect(t.borderIds).toContain(t.frameId);
    }
  });
});

describe('templateConfigPatch — events.config seeding', () => {
  const wedding = templateById('wedding')!;
  const patch = templateConfigPatch(wedding, 'Ada & Bode');

  it('produces every key buildRuntimeConfig reads', () => {
    expect(patch.themeVars).toEqual(wedding.themeVars);
    expect(patch.accentHexes).toEqual(wedding.accentHexes);
    expect(patch.background_template).toBe(wedding.background);
    expect(patch.landingRoute).toBe(wedding.landingRoute);
    expect(patch.defaultExperienceId).toBe(`builtin:border:${wedding.frameId}`);
    expect(patch.arContent).toEqual({ shaderIds: wedding.shaderIds, borderIds: wedding.borderIds });
  });

  it('carries the event name through copy (survives the shallow config merge)', () => {
    const copy = patch.copy as Record<string, string>;
    expect(copy.fullName).toBe('Ada & Bode');
    expect(copy.eventName).toBe('Ada & Bode');
    expect(copy.tagline).toBe(wedding.tagline);
  });
});

describe('create-event mirror', () => {
  it("every template's eventType is accepted by the create-event edge function", () => {
    for (const t of EVENT_TEMPLATES) expect(CREATE_EVENT_TYPES as readonly string[], t.id).toContain(t.eventType);
  });

  it('the mirror matches the edge function source verbatim', () => {
    const src = readFileSync(new URL('../../supabase/functions/create-event/index.ts', import.meta.url), 'utf8');
    const m = /const EVENT_TYPES = new Set\(\[([^\]]*)\]\)/.exec(src);
    expect(m, 'EVENT_TYPES not found in create-event/index.ts').not.toBeNull();
    const server = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect([...CREATE_EVENT_TYPES].sort()).toEqual(server.sort());
  });
});

describe('paletteThemePatch', () => {
  it('{} without a usable accent', () => {
    expect(paletteThemePatch(null)).toEqual({});
    expect(paletteThemePatch({ bg: '#000000', surface: null, fg: '#FFFFFF', accent: null, accent2: null })).toEqual({});
  });

  it("uses the poster's background and a text colour that passes on it", () => {
    const p = paletteThemePatch({ bg: '#0A0806', surface: '#1A130C', fg: '#F7F1E3', accent: '#D4AF37', accent2: '#E8C766' });
    expect(p['--color-brand-bg']).toBe('#0A0806');
    expect(p['--color-brand-surface']).toBe('#1A130C');
    expect(p['--color-brand-fg']).toBe('#F7F1E3');
    expect(p['--color-accent']).toBe('#D4AF37');
    expect(p['--color-accent-2']).toBe('#E8C766');
  });

  it("never trusts a model's unreadable text pairing", () => {
    // Gold text on white is ~2:1 — must be replaced by a derived colour.
    const p = paletteThemePatch({ bg: '#FFFFFF', surface: null, fg: '#D4AF37', accent: '#D4AF37', accent2: null });
    expect(p['--color-brand-fg']).not.toBe('#D4AF37');
    expect(contrastRatio(p['--color-brand-fg'], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p['--color-brand-muted'], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('with no poster background, a good fg is kept and a bad one ignored', () => {
    const good = paletteThemePatch({ bg: null, surface: null, fg: '#FFFFFF', accent: '#2FDD8B', accent2: null });
    expect(good['--color-brand-fg']).toBe('#FFFFFF');
    const bad = paletteThemePatch({ bg: null, surface: null, fg: '#050505', accent: '#2FDD8B', accent2: null });
    expect(contrastRatio(bad['--color-brand-fg'], bad['--color-brand-bg'])).toBeGreaterThanOrEqual(7);
  });
});
