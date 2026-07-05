import { describe, it, expect } from 'vitest';
import { EVENT_TEMPLATES, templateById, templateConfigPatch } from './eventTemplates';
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
