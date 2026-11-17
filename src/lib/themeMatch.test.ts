import { describe, it, expect } from 'vitest';
import { FILTER_LOOKS, accentHexesFor, effectiveDefaultFrame, followAccentFramePalette, hueAffinity, lookSeason, looksConfigPatch, rankLooks, seededLooks, selectionFromConfig, shownWhenUnset } from './themeMatch';
import { GENERIC_FRAMES, GENERIC_FRAME_IDS } from './borders';
import { builtinBorderExperiences, builtinShaderExperiences } from './catalog';
import type { EventARContent } from '../events/types';
import { FILTER_SHADERS } from './shaders';
import { EVENT_TEMPLATES, templateById } from './eventTemplates';

describe('FILTER_LOOKS', () => {
  it('has an entry for every filter the booth can show', () => {
    for (const s of FILTER_SHADERS) expect(FILTER_LOOKS[s.id], s.id).toBeDefined();
  });
});

describe('seasonal looks (LooksPicker seed ⇄ booth)', () => {
  it('tags the Christmas set and nothing else', () => {
    expect(lookSeason('frame', 'xmas-lights')).toBe('christmas');
    expect(lookSeason('filter', 'snowfall-glow')).toBe('christmas');
    expect(lookSeason('frame', 'frame-classic-gold')).toBeNull();
    expect(lookSeason('filter', 'champagne-sparkle')).toBeNull();
  });

  it("an empty selection seeds exactly what the booth shows for an empty allow-list — seasonal looks OFF", () => {
    const empty = {} as EventARContent;
    for (const t of [null, 'party', 'corporate', 'wedding']) {
      const r = rankLooks({ eventType: t, accentHex: '#C8102E' });
      const boothFrames = new Set(builtinBorderExperiences(empty).map((e) => e.id.slice('builtin:border:'.length)).filter((id) => GENERIC_FRAME_IDS.has(id)));
      const boothFilters = new Set(builtinShaderExperiences(empty).map((e) => e.id.slice('builtin:shader:'.length)));
      expect(new Set(shownWhenUnset('frame', r.frameIds))).toEqual(boothFrames);
      expect(new Set(shownWhenUnset('filter', r.filterIds))).toEqual(boothFilters);
      expect(shownWhenUnset('frame', r.frameIds).some((id) => lookSeason('frame', id) !== null)).toBe(false);
    }
  });

  it('keeps the ranked order of what it keeps', () => {
    const r = rankLooks({ eventType: 'party' });
    const kept = shownWhenUnset('frame', r.frameIds);
    expect(kept).toEqual(r.frameIds.filter((id) => kept.includes(id)));
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

  it('a second colour rides along as accent2; a duplicate or invalid one does not', () => {
    const gala = templateById('gala')!;
    expect(seededLooks(gala, '#B0223B', '#2E8B57').arContent.framePalette).toEqual({ accent: '#B0223B', accent2: '#2E8B57' });
    expect(seededLooks(gala, '#B0223B', '#b0223b').arContent.framePalette).toEqual({ accent: '#B0223B' });
    expect(seededLooks(gala, '#B0223B', 'green').arContent.framePalette).toEqual({ accent: '#B0223B' });
    expect(seededLooks(gala, null, '#2E8B57').arContent.framePalette).toBeUndefined();
  });
});

describe('followAccentFramePalette', () => {
  const cfg = (framePalette?: unknown) => ({
    arContent: { borderIds: ['frame-classic-gold'], shaderIds: ['neon-pulse'], headPieceIds: ['royal-crown'], ...(framePalette ? { framePalette } : {}) },
  });

  it('frames in match mode follow the new colour — same shape create writes, other arContent kept', () => {
    const out = followAccentFramePalette(cfg({ accent: '#19E3FF' }), ['#19e3ff'], '#b0223b');
    expect(out).toEqual({
      arContent: { borderIds: ['frame-classic-gold'], shaderIds: ['neon-pulse'], headPieceIds: ['royal-crown'], framePalette: { accent: '#B0223B' } },
    });
    // …which the booth/Library read back as the new palette.
    expect(selectionFromConfig(out!).palette).toEqual({ accent: '#B0223B', accent2: null });
  });

  it('keeps a stored second colour', () => {
    const out = followAccentFramePalette(cfg({ accent: '#19E3FF', accent2: '#2E8B57' }), ['#19E3FF'], '#B0223B');
    expect((out!.arContent.framePalette as Record<string, unknown>)).toEqual({ accent: '#B0223B', accent2: '#2E8B57' });
  });

  it('leaves frames alone when match mode is off (no palette)', () => {
    expect(followAccentFramePalette(cfg(), ['#19E3FF'], '#B0223B')).toBeNull();
    expect(followAccentFramePalette(null, ['#19E3FF'], '#B0223B')).toBeNull();
  });

  it('leaves a deliberately different frame palette alone', () => {
    expect(followAccentFramePalette(cfg({ accent: '#FFD166' }), ['#19E3FF', null, undefined], '#B0223B')).toBeNull();
  });

  it('no-ops on an invalid or unchanged colour', () => {
    expect(followAccentFramePalette(cfg({ accent: '#19E3FF' }), ['#19E3FF'], 'red')).toBeNull();
    expect(followAccentFramePalette(cfg({ accent: '#19E3FF' }), ['#19E3FF'], undefined)).toBeNull();
    expect(followAccentFramePalette(cfg({ accent: '#19E3FF' }), ['#19E3FF'], '#19e3ff')).toBeNull();
  });
});

describe('effectiveDefaultFrame', () => {
  const sel = (frameId: string | null, borderIds = ['frame-deco-plain', 'frame-classic-gold']) =>
    ({ borderIds, shaderIds: ['neon-pulse'], frameId, palette: null });

  it("the host's own pick wins when it is selected", () => {
    expect(effectiveDefaultFrame(sel('frame-classic-gold'), 'some-ai-uuid')).toBe('frame-classic-gold');
  });

  it('falls back to the first selected frame when nothing else opens first', () => {
    expect(effectiveDefaultFrame(sel(null), undefined)).toBe('frame-deco-plain');
    expect(effectiveDefaultFrame(sel(null), '')).toBe('frame-deco-plain');
    expect(effectiveDefaultFrame(sel(null), 'builtin:border:frame-hexagon-plain')).toBe('frame-deco-plain');
  });

  it('never replaces an AI frame the event already opens with', () => {
    expect(effectiveDefaultFrame(sel(null), '7f0c2a1e-0000-4000-8000-000000000000')).toBeNull();
    // ...and a null default leaves defaultExperienceId out of the patch.
    expect(looksConfigPatch({}, { ...sel(null), frameId: null })).not.toHaveProperty('defaultExperienceId');
  });

  it('no frames selected → null', () => {
    expect(effectiveDefaultFrame(sel(null, []), undefined)).toBeNull();
  });
});

describe('accentHexesFor', () => {
  const tpl = ['#D4AF37', '#E8C766', '#FBF3D9', '#B8860B'];

  it('puts the chosen colour first and keeps the palette length', () => {
    expect(accentHexesFor('#c0392b', tpl)).toEqual(['#C0392B', '#D4AF37', '#E8C766', '#FBF3D9']);
  });

  it('adds a second colour right after the first', () => {
    expect(accentHexesFor('#C0392B', tpl, '#1E8449')).toEqual(['#C0392B', '#1E8449', '#D4AF37', '#E8C766']);
  });

  it('moves an existing colour to the front instead of repeating it (any case)', () => {
    expect(accentHexesFor('#e8c766', tpl)).toEqual(['#E8C766', '#D4AF37', '#FBF3D9', '#B8860B']);
  });

  it('an invalid accent keeps the existing palette, cleaned', () => {
    expect(accentHexesFor('red', ['#d4af37', 'nope', 3, '#D4AF37'])).toEqual(['#D4AF37']);
    expect(accentHexesFor(null, undefined)).toEqual([]);
    expect(accentHexesFor('#C0392B', 'not-a-list')).toEqual(['#C0392B']);
  });

  it('never mutates its input', () => {
    const copy = [...tpl];
    accentHexesFor('#C0392B', tpl, '#1E8449');
    expect(tpl).toEqual(copy);
  });
});
