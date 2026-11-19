import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENE_TEMPLATE_ID,
  SCENE_PALETTES,
  SCENE_TEMPLATES,
  gridCellCount,
  normalizeScene,
  normalizeWallLook,
  paletteCss,
  resolveScene,
  resolveSceneImageUrl,
  resolveWallBackdrop,
  toneForColor,
  wallTone,
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
    expect(l).toEqual({ layout: 'grid', gridSize: 5, transition: 'zoom', tone: 'light', backdrop: { kind: 'gradient', paletteId: 'mist' } });
    const j = normalizeWallLook({ layout: 'spiral', gridSize: 7, transition: 'warp', tone: 'sepia', backdrop: { kind: 'image', url: 'javascript:x' } }, true);
    expect(j).toEqual({ layout: 'marquee', gridSize: 4, transition: 'flip', tone: 'auto', backdrop: { kind: 'event' } });
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
