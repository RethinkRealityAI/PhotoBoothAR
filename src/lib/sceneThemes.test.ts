import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WALL_LOOK,
  DEFAULT_SCENE_TEMPLATE_ID,
  SCENE_PALETTES,
  SCENE_TEMPLATES,
  gridCellCount,
  normalizePageBorder,
  SCENE_PAGE_BORDERS,
  SCENE_PAGE_BORDER_META,
  normalizeScene,
  normalizeWallLook,
  paletteCss,
  resolveScene,
  resolveSceneImageUrl,
  resolveWallBackdrop,
  toneForColor,
  wallTone,
  WALL_LAYOUTS,
  WALL_LAYOUT_META,
  WALL_TRANSITIONS,
  WALL_TRANSITION_META,
  describeWallLook,
  sameWallArrangement,
  wallLookEquals,
  WALL_STYLES,
  applyWallStyle,
  matchingWallStyle,
  wallGlowColor,
} from './sceneThemes';

const SUPA = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets/ev/uploads/a.png';

describe('palettes and templates', () => {
  it('have unique ids and valid hex stops', () => {
    const ids = SCENE_PALETTES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SCENE_PALETTES) for (const s of p.stops) expect(s).toMatch(/^#[0-9A-F]{6}$/i);
    const tids = SCENE_TEMPLATES.map((t) => t.id);
    expect(new Set(tids).size).toBe(tids.length);
    for (const t of SCENE_TEMPLATES) expect(SCENE_PALETTES.some((p) => p.id === t.paletteId)).toBe(true);
  });

  it('offers both dark and light palettes', () => {
    expect(SCENE_PALETTES.some((p) => p.tone === 'dark')).toBe(true);
    expect(SCENE_PALETTES.some((p) => p.tone === 'light')).toBe(true);
  });

  it('never makes the gold line-art look the default', () => {
    const def = SCENE_TEMPLATES.find((t) => t.id === DEFAULT_SCENE_TEMPLATE_ID)!;
    expect(def.ornament).not.toBe('gilded');
    expect(SCENE_TEMPLATES[0].ornament).not.toBe('gilded');
    expect(resolveScene(undefined).ornament).not.toBe('gilded');
  });

  it('paletteCss layers glows over a diagonal base', () => {
    const css = paletteCss(SCENE_PALETTES[0]);
    expect(css).toContain('linear-gradient(135deg');
    expect(css.match(/radial-gradient/g)?.length).toBe(2);
  });
});

describe('resolveSceneImageUrl', () => {
  it('accepts supabase public objects and root-relative paths', () => {
    expect(resolveSceneImageUrl(SUPA)).toBe(SUPA);
    expect(resolveSceneImageUrl('/frames/a.png')).toBe('/frames/a.png');
  });
  it('rejects everything that could escape url() or load foreign content', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:image/png;base64,AAA',
      'http://x.supabase.co/storage/v1/object/public/a.png',
      '//evil.com/a.png',
      'https://evil.com/a.png',
      `${SUPA}") ; background: red; ("`,
      '/a b.png',
      '',
      42,
      null,
    ]) {
      expect(resolveSceneImageUrl(bad)).toBeUndefined();
    }
  });
});

describe('page border (additive)', () => {
  it('keeps a real border on any scene kind', () => {
    expect(normalizeScene({ kind: 'template', id: 'beamwall', border: 'glow' })).toEqual({ kind: 'template', id: 'beamwall', border: 'glow' });
    expect(normalizeScene({ kind: 'color', color: '#112233', border: 'filmstrip' })).toEqual({ kind: 'color', color: '#112233', border: 'filmstrip' });
  });
  it('never stores none or an unknown border, and a scene without one is unchanged', () => {
    expect(normalizeScene({ kind: 'template', id: 'beamwall', border: 'none' })).toEqual({ kind: 'template', id: 'beamwall' });
    expect(normalizeScene({ kind: 'template', id: 'beamwall', border: 'neon' })).toEqual({ kind: 'template', id: 'beamwall' });
    expect(normalizeScene({ kind: 'template', id: 'beamwall' })).toEqual({ kind: 'template', id: 'beamwall' });
  });
  it('a border cannot rescue an invalid scene', () => {
    expect(normalizeScene({ kind: 'template', id: 'nope', border: 'glow' })).toBeUndefined();
  });
  it('normalizePageBorder is total', () => {
    expect(normalizePageBorder('gilded')).toBe('gilded');
    expect(normalizePageBorder(undefined)).toBe('none');
    expect(normalizePageBorder(3)).toBe('none');
    expect(SCENE_PAGE_BORDERS.every((b) => SCENE_PAGE_BORDER_META[b].label.length > 0)).toBe(true);
  });
});

describe('normalizeScene', () => {
  it('returns undefined for absent or junk input (keeps today\'s background)', () => {
    expect(normalizeScene(undefined)).toBeUndefined();
    expect(normalizeScene(null)).toBeUndefined();
    expect(normalizeScene('dusk')).toBeUndefined();
    expect(normalizeScene({ kind: 'template', id: 'nope' })).toBeUndefined();
    expect(normalizeScene({ kind: 'color', color: 'red' })).toBeUndefined();
    expect(normalizeScene({ kind: 'image', url: 'https://evil.com/x.png' })).toBeUndefined();
  });
  it('keeps valid scenes and clamps dim', () => {
    expect(normalizeScene({ kind: 'template', id: 'pearl-studio' })).toEqual({ kind: 'template', id: 'pearl-studio' });
    expect(normalizeScene({ kind: 'image', url: SUPA, dim: 5 })).toEqual({ kind: 'image', url: SUPA, dim: 0.8, tone: 'dark' });
    expect(normalizeScene({ kind: 'image', url: SUPA, tone: 'light' })).toEqual({ kind: 'image', url: SUPA, dim: 0.35, tone: 'light' });
    expect(normalizeScene({ kind: 'frame', url: '/f.png', paletteId: 'x' })).toEqual({ kind: 'frame', url: '/f.png', paletteId: 'dusk' });
  });
});

describe('resolveScene', () => {
  it('derives tone from the palette or colour', () => {
    expect(resolveScene({ kind: 'template', id: 'pearl-studio' }).tone).toBe('light');
    expect(resolveScene({ kind: 'gradient', paletteId: 'midnight' }).tone).toBe('dark');
    expect(resolveScene({ kind: 'color', color: '#FFFFFF' }).tone).toBe('light');
    expect(resolveScene({ kind: 'color', color: '#101010' }).tone).toBe('dark');
    expect(toneForColor('#777777')).toBe('dark');
  });
  it('photo scenes cover, frame scenes contain', () => {
    expect(resolveScene({ kind: 'image', url: SUPA, dim: 0.3, tone: 'dark' }).imageFit).toBe('cover');
    expect(resolveScene({ kind: 'frame', url: '/f.png', paletteId: 'dusk' }).imageFit).toBe('contain');
  });
});

describe('normalizeWallLook', () => {
  it('a wall that never saved a look keeps its old gallery', () => {
    expect(normalizeWallLook(undefined).layout).toBe('masonry');
    expect(normalizeWallLook(undefined, true).layout).toBe('marquee');
    expect(normalizeWallLook(undefined).backdrop).toEqual({ kind: 'event' });
    expect(normalizeWallLook(undefined).tone).toBe('auto');
  });
  it('accepts valid values and rejects junk field by field', () => {
    const l = normalizeWallLook({ layout: 'grid', gridSize: 5, transition: 'zoom', tone: 'light', backdrop: { kind: 'gradient', paletteId: 'mist' } });
    expect(l).toEqual({ layout: 'grid', gridSize: 5, transition: 'zoom', tone: 'light', backdrop: { kind: 'gradient', paletteId: 'mist' }, card: 'classic', glow: 'none', corners: 'soft', beam: 'beam', ambient: 'glow', captions: true });
    const j = normalizeWallLook({ layout: 'spiral', gridSize: 7, transition: 'warp', tone: 'sepia', backdrop: { kind: 'image', url: 'javascript:x' } }, true);
    expect(j).toEqual({ layout: 'marquee', gridSize: 4, transition: 'flip', tone: 'auto', backdrop: { kind: 'event' }, card: 'classic', glow: 'none', corners: 'soft', beam: 'beam', ambient: 'glow', captions: true });
  });
});

describe('wall backdrop + tone', () => {
  it('event backdrop keeps the event background', () => {
    expect(resolveWallBackdrop(normalizeWallLook({}))).toBeNull();
    expect(wallTone(normalizeWallLook({}), 'light')).toBe('light');
  });
  it('explicit tone wins over the backdrop', () => {
    const look = normalizeWallLook({ backdrop: { kind: 'gradient', paletteId: 'pearl' }, tone: 'dark' });
    expect(resolveWallBackdrop(look)!.tone).toBe('dark');
    expect(wallTone(normalizeWallLook({ backdrop: { kind: 'gradient', paletteId: 'pearl' } }))).toBe('light');
  });
  it('grid cell counts', () => {
    expect([3, 4, 5].map((n) => gridCellCount(n as 3 | 4 | 5))).toEqual([9, 16, 25]);
  });
});

describe('wall look helpers', () => {
  it('has copy for every layout and transition', () => {
    for (const l of WALL_LAYOUTS) expect(WALL_LAYOUT_META[l].label.length).toBeGreaterThan(0);
    for (const t of WALL_TRANSITIONS) expect(WALL_TRANSITION_META[t].label.length).toBeGreaterThan(0);
  });

  it('sameWallArrangement looks only at layout and grid size', () => {
    const a = normalizeWallLook({ layout: 'grid', gridSize: 4, backdrop: { kind: 'gradient', paletteId: 'aurora' } });
    expect(sameWallArrangement(a, { ...a, tone: 'light', backdrop: { kind: 'event' } })).toBe(true);
    expect(sameWallArrangement(a, { ...a, gridSize: 5 })).toBe(false);
    expect(sameWallArrangement(a, { ...a, layout: 'masonry' })).toBe(false);
  });

  it('wallLookEquals compares every field, backdrop included', () => {
    const a = normalizeWallLook({ layout: 'grid', backdrop: { kind: 'color', color: '#AABBCC' } });
    expect(wallLookEquals(a, normalizeWallLook({ layout: 'grid', backdrop: { kind: 'color', color: '#aabbcc' } }))).toBe(true);
    expect(wallLookEquals(a, { ...a, transition: 'zoom' })).toBe(false);
    expect(wallLookEquals(a, { ...a, backdrop: { kind: 'event' } })).toBe(false);
    const img = normalizeWallLook({ backdrop: { kind: 'image', url: SUPA, dim: 0.3 } });
    expect(wallLookEquals(img, { ...img, backdrop: { kind: 'image', url: SUPA, dim: 0.5 } })).toBe(false);
  });

  it('describeWallLook reads like a sentence for the host', () => {
    expect(describeWallLook(normalizeWallLook({ layout: 'grid', gridSize: 4, backdrop: { kind: 'gradient', paletteId: 'aurora' }, tone: 'dark' })))
      .toBe('Grid 4×4 · Aurora · Dark');
    expect(describeWallLook(normalizeWallLook(undefined))).toBe('Gallery · Event theme · Auto');
  });
});

describe('image fit (setup wizard fit tool)', () => {
  const url = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets/ev/bg.jpg';
  it('keeps a valid focal point + zoom and clamps it', () => {
    const s = normalizeScene({ kind: 'image', url, dim: 0.3, fit: { x: 120, y: 20, zoom: 9 } });
    expect(s).toMatchObject({ kind: 'image', fit: { x: 100, y: 20, zoom: 3 } });
    expect(resolveScene(s).imagePlacement).toEqual({ x: 100, y: 20, zoom: 3 });
  });
  it('drops the default and junk so old scenes stay identical', () => {
    expect(normalizeScene({ kind: 'image', url, dim: 0.3, fit: { x: 50, y: 50, zoom: 1 } })).not.toHaveProperty('fit');
    expect(normalizeScene({ kind: 'image', url, dim: 0.3, fit: 'centre' })).not.toHaveProperty('fit');
    expect(resolveScene(normalizeScene({ kind: 'image', url, dim: 0.3 })).imagePlacement).toBeUndefined();
  });
});

describe('wall styling (2026-11-20)', () => {
  it('a look saved before styling existed renders exactly as before', () => {
    const l = normalizeWallLook({ layout: 'grid', gridSize: 4 });
    expect(l).toMatchObject({ card: 'classic', glow: 'none', corners: 'soft', beam: 'beam', ambient: 'glow', captions: true });
    expect(l.glowColor).toBeUndefined();
  });
  it('keeps valid styling and drops anything unknown', () => {
    const ok = normalizeWallLook({ card: 'polaroid', glow: 'strong', glowColor: '#FFD27A', corners: 'round', beam: 'sparkle', ambient: 'still', captions: false });
    expect(ok).toMatchObject({ card: 'polaroid', glow: 'strong', glowColor: '#FFD27A', corners: 'round', beam: 'sparkle', ambient: 'still', captions: false });
    const bad = normalizeWallLook({ card: 'velvet', glow: 9, glowColor: 'red', corners: 'blob', beam: 'laser', ambient: 'storm', captions: 'no' });
    expect(bad).toMatchObject({ card: 'classic', glow: 'none', corners: 'soft', beam: 'beam', ambient: 'glow', captions: true });
    expect(bad.glowColor).toBeUndefined();
  });
  it('equality sees every styling field', () => {
    const a = normalizeWallLook({ card: 'glass' });
    expect(wallLookEquals(a, normalizeWallLook({ card: 'glass' }))).toBe(true);
    expect(wallLookEquals(a, normalizeWallLook({ card: 'glass', beam: 'reveal' }))).toBe(false);
    expect(wallLookEquals(a, normalizeWallLook({ card: 'glass', glowColor: '#FFFFFF' }))).toBe(false);
    expect(wallLookEquals(normalizeWallLook({ glowColor: '#ffffff' }), normalizeWallLook({ glowColor: '#FFFFFF' }))).toBe(true);
  });
  it('a style keeps the layout and captions, and is recognised afterwards', () => {
    const start = normalizeWallLook({ layout: 'grid', gridSize: 5, captions: false, glowColor: '#FF9EC4' });
    for (const style of WALL_STYLES) {
      const next = applyWallStyle(start, style);
      expect(next.layout).toBe('grid');
      expect(next.gridSize).toBe(5);
      expect(next.captions).toBe(false);
      expect(next.glowColor).toBe(style.look.glowColor);
      expect(matchingWallStyle(next)?.id).toBe(style.id);
      // Every style survives a save/load round trip.
      expect(wallLookEquals(normalizeWallLook(JSON.parse(JSON.stringify(next))), next)).toBe(true);
    }
    // A brand-new wall (nothing saved) is a named style, not "Your own mix".
    expect(matchingWallStyle(normalizeWallLook(undefined))?.id).toBe('classic');
    expect(matchingWallStyle(normalizeWallLook(undefined, true))?.id).toBe('classic');
    expect(matchingWallStyle(DEFAULT_WALL_LOOK)?.id).toBe('classic');
    expect(new Set(WALL_STYLES.map((s) => s.id)).size).toBe(WALL_STYLES.length);
  });
  it('glow colour falls back to the accent', () => {
    expect(wallGlowColor(normalizeWallLook({}), '#7FE3D8')).toBe('#7FE3D8');
    expect(wallGlowColor(normalizeWallLook({ glowColor: '#FFD27A' }), '#7FE3D8')).toBe('#FFD27A');
    expect(wallGlowColor(normalizeWallLook({}), 'nope')).toBe('#D4D6FF');
  });
  it('describe names a non-classic card', () => {
    expect(describeWallLook(normalizeWallLook({ card: 'polaroid' }))).toBe('Gallery · Event theme · Auto · Polaroid');
  });
});
