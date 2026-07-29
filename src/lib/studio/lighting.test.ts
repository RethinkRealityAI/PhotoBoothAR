import { describe, it, expect } from 'vitest';
import {
  LIGHTING_PRESETS,
  LIGHTING_MAP,
  LIGHTING_IDS,
  HOST_LIGHTING_PRESETS,
  DEFAULT_LIGHTING,
  normalizeLightingPreset,
  lightingFor,
  boothLightingFor,
} from './lighting';

describe('preset table integrity', () => {
  it('ids are unique and the map matches the array', () => {
    expect(new Set(LIGHTING_IDS).size).toBe(LIGHTING_IDS.length);
    for (const p of LIGHTING_PRESETS) expect(LIGHTING_MAP[p.id]).toBe(p);
  });

  it('every preset is fully populated with host-facing copy', () => {
    for (const p of LIGHTING_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
      expect(p.exposure).toBeGreaterThan(0);
      expect(Number.isFinite(p.ambient.intensity)).toBe(true);
    }
  });

  it('every colour is a #rrggbb literal three.Color can parse', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const p of LIGHTING_PRESETS) {
      expect(p.ambient.color).toMatch(hex);
      for (const d of p.directionals) expect(d.color).toMatch(hex);
      for (const l of p.points) expect(l.color).toMatch(hex);
      for (const lf of p.environment?.lightformers ?? []) expect(lf.color).toMatch(hex);
      if (p.contactShadow) expect(p.contactShadow.color).toMatch(hex);
    }
  });
});

describe('the legacy rig is frozen', () => {
  // hope-gala / jenna-jake / detola-wuyi composite this canvas straight into the
  // saved 1080x1920 photo. These numbers are the pre-Wave-6 booth/Overlay3D.tsx
  // values; changing any of them changes a frozen event's keepsakes.
  const legacy = LIGHTING_MAP.legacy;

  it('is exactly ambient 1.2 + one directional 1.8 + one warm point 0.8', () => {
    expect(legacy.ambient).toEqual({ color: '#ffffff', intensity: 1.2 });
    expect(legacy.directionals).toEqual([{ color: '#ffffff', intensity: 1.8, position: [2, 4, 3] }]);
    expect(legacy.points).toEqual([{ color: '#E8C766', intensity: 0.8, position: [-2, 2, 2] }]);
  });

  it('has NO environment map, NO contact shadow and neutral exposure', () => {
    expect(legacy.environment).toBeNull();
    expect(legacy.contactShadow).toBeNull();
    expect(legacy.exposure).toBe(1);
  });

  it('is never offered to a host as a choice', () => {
    expect(HOST_LIGHTING_PRESETS.some((p) => p.id === 'legacy')).toBe(false);
    expect(HOST_LIGHTING_PRESETS.length).toBe(LIGHTING_PRESETS.length - 1);
  });
});

describe('the new presets are actually lit differently', () => {
  const modern = LIGHTING_PRESETS.filter((p) => p.id !== 'legacy');

  it('each carries a locally generated environment with panels', () => {
    for (const p of modern) {
      expect(p.environment).not.toBeNull();
      expect(p.environment!.lightformers.length).toBeGreaterThan(2);
      expect(p.environment!.intensity).toBeGreaterThan(0);
      // Cheap enough for a mid-range phone: one 6x64x64 cube render, once.
      expect(p.environment!.resolution).toBeLessThanOrEqual(128);
    }
  });

  it('drops direct light hard, because the IBL now carries the base exposure', () => {
    // Keeping legacy's ambient 1.2 on top of an environment map blows every
    // highlight to white and destroys the metal the IBL was added to show.
    for (const p of modern) expect(p.ambient.intensity).toBeLessThan(0.3);
  });

  it('offers a soft ground shadow for surfaces that have a floor', () => {
    for (const p of modern) {
      expect(p.contactShadow).not.toBeNull();
      expect(p.contactShadow!.opacity).toBeGreaterThan(0);
      expect(p.contactShadow!.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('round panels stay UNIFORM — SceneLighting renders them from one radius', () => {
    for (const p of modern) {
      for (const lf of p.environment!.lightformers) {
        if (lf.form === 'circle' || lf.form === 'ring') expect(lf.scale[0]).toBe(lf.scale[1]);
      }
    }
  });
});

describe('normalizeLightingPreset', () => {
  it('accepts every real id', () => {
    for (const id of LIGHTING_IDS) expect(normalizeLightingPreset(id)).toBe(id);
  });

  it('falls back for anything else, without throwing', () => {
    for (const junk of [undefined, null, '', 'Studio', 'chartreuse', 42, {}, [], true]) {
      expect(normalizeLightingPreset(junk)).toBe(DEFAULT_LIGHTING);
    }
  });

  it('honours an explicit fallback', () => {
    expect(normalizeLightingPreset('nope', 'legacy')).toBe('legacy');
  });
});

describe('lightingFor', () => {
  it('returns the requested preset', () => {
    expect(lightingFor('neon').id).toBe('neon');
  });
  it('never returns undefined for an id smuggled past the type', () => {
    expect(lightingFor('nope' as never).id).toBe('studio');
  });
});

describe('boothLightingFor — THE legacy gate', () => {
  it('forces legacy for any non-db event, whatever is stored', () => {
    for (const source of ['code', 'legacy', '', undefined]) {
      expect(boothLightingFor(source, 'neon')).toBe('legacy');
      expect(boothLightingFor(source, 'studio')).toBe('legacy');
      expect(boothLightingFor(source, undefined)).toBe('legacy');
    }
  });

  it('honours the host choice for a db event', () => {
    expect(boothLightingFor('db', 'neon')).toBe('neon');
    expect(boothLightingFor('db', 'candlelit')).toBe('candlelit');
  });

  it('defaults a db event with nothing stored to studio, never to legacy', () => {
    expect(boothLightingFor('db', undefined)).toBe('studio');
    expect(boothLightingFor('db', 'nonsense')).toBe('studio');
  });
});
