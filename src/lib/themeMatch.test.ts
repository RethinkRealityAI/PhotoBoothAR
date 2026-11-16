import { describe, it, expect } from 'vitest';
import { FILTER_LOOKS, hueAffinity, looksConfigPatch, rankLooks, seededLooks, selectionFromConfig } from './themeMatch';
import { GENERIC_FRAMES } from './borders';
import { FILTER_SHADERS } from './shaders';
import { EVENT_TEMPLATES, templateById } from './eventTemplates';

describe('FILTER_LOOKS', () => {
  it('has an entry for every filter the booth can show', () => {
    for (const s of FILTER_SHADERS) expect(FILTER_LOOKS[s.id], s.id).toBeDefined();
  });
});

describe('hueAffinity', () => {
  it('1 for the same hue, 0 for opposite hues, 0.5 against grey', () => {
    expect(hueAffinity('#FF0000', '#FF0000')).toBeCloseTo(1, 5);
    expect(hueAffinity('#FF0000', '#00FFFF')).toBeCloseTo(0, 5);
    expect(hueAffinity('#808080', '#FF0000')).toBe(0.5);
  });
});

describe('rankLooks', () => {
  it('returns every generic frame and every filter exactly once', () => {
    const r = rankLooks({ templateId: 'wedding', accentHex: '#D4AF37' });
    expect([...r.frameIds].sort()).toEqual(GENERIC_FRAMES.map((f) => f.id).sort());
    expect([...r.filterIds].sort()).toEqual(FILTER_SHADERS.map((s) => s.id).sort());
  });

  it("the template's own set comes first", () => {
    for (const t of EVENT_TEMPLATES) {
      const r = rankLooks({ templateId: t.id });
      expect(new Set(r.frameIds.slice(0, t.borderIds.length)), t.id).toEqual(new Set(t.borderIds));
      expect(new Set(r.filterIds.slice(0, t.shaderIds.length)), t.id).toEqual(new Set(t.shaderIds));
    }
  });

  it('falls back to event_type when no template id is known', () => {
    expect(rankLooks({ eventType: 'party' })).toEqual(rankLooks({ templateId: 'party' }));
  });

  it("'remote' / unknown events rank by colour alone, stably", () => {
    const r = rankLooks({ eventType: 'remote', accentHex: '#FF2D9B' });
    expect(r.filterIds[0]).toBe('neon-pulse');
    expect(rankLooks({ eventType: 'remote' })).toEqual(rankLooks({ eventType: 'remote' }));
  });

  it('colour moves an off-set filter up among equals', () => {
    const cyan = rankLooks({ eventType: 'remote', accentHex: '#19E3FF' }).filterIds;
    const pink = rankLooks({ eventType: 'remote', accentHex: '#FF2D9B' }).filterIds;
    expect(cyan.indexOf('laser-sparkle')).toBeLessThan(pink.indexOf('laser-sparkle'));
  });
});

describe('selection ⇄ config', () => {
  const config = {
    defaultExperienceId: 'builtin:border:dw-corners',
    arContent: { borderIds: ['dw-corners', 'dw-frame-classic'], shaderIds: ['velvet-film'], headPieceIds: ['crown'], framePalette: { accent: '#2fdd8b' } },
  };

  it('reads the current selection', () => {
    expect(selectionFromConfig(config)).toEqual({
      borderIds: ['dw-corners', 'dw-frame-classic'],
      shaderIds: ['velvet-film'],
      frameId: 'dw-corners',
      palette: { accent: '#2FDD8B', accent2: null },
    });
    expect(selectionFromConfig(null)).toEqual({ borderIds: [], shaderIds: [], frameId: null, palette: null });
    expect(selectionFromConfig({ defaultExperienceId: 'exp-uuid' }).frameId).toBeNull();
  });

  it('the patch keeps other arContent keys and pins only a selected default', () => {
    const p = looksConfigPatch(config, { borderIds: ['dw-frame-classic'], shaderIds: ['velvet-film', 'neon-pulse'], frameId: 'dw-frame-classic', palette: null });
    expect(p).toEqual({
      arContent: { borderIds: ['dw-frame-classic'], shaderIds: ['velvet-film', 'neon-pulse'], headPieceIds: ['crown'] },
      defaultExperienceId: 'builtin:border:dw-frame-classic',
    });
    const q = looksConfigPatch(config, { borderIds: ['dw-frame-classic'], shaderIds: [], frameId: 'dw-corners', palette: { accent: '#FF5A5F' } });
    expect(q.defaultExperienceId).toBeUndefined();
    expect((q.arContent as Record<string, unknown>).framePalette).toEqual({ accent: '#FF5A5F' });
  });

  it('never mutates its input', () => {
    const snap = JSON.stringify(config);
    looksConfigPatch(config, { borderIds: [], shaderIds: [], frameId: null, palette: null });
    expect(JSON.stringify(config)).toBe(snap);
  });
});

describe('seededLooks', () => {
  it("with no colour: exactly the template's ids, no palette", () => {
    for (const t of EVENT_TEMPLATES) {
      const s = seededLooks(t, null).arContent as { borderIds: string[]; shaderIds: string[]; framePalette?: unknown };
      expect([...s.borderIds].sort(), t.id).toEqual([...t.borderIds].sort());
      expect([...s.shaderIds].sort(), t.id).toEqual([...t.shaderIds].sort());
      expect(s.framePalette).toBeUndefined();
    }
  });

  it('with a colour: the palette rides along', () => {
    expect(seededLooks(templateById('gala')!, '#ff5a5f').arContent.framePalette).toEqual({ accent: '#FF5A5F' });
  });
});
