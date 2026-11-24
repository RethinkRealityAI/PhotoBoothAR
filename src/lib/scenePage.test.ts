import { describe, expect, it } from 'vitest';
import type { Experience, Post } from '../types';
import { stripLayout } from './photoStrip';
import {
  draftTone,
  heroFrameUrl,
  boothScreen,
  BOOTH_SCREEN_FALLBACK,
  withPageBorder,
  wallFieldSlots,
  wallFieldTileCentre,
  tileOrder,
  wallFieldPhotos,
  wallFieldSize,
  wallFieldColumns,
  wallFieldFill,
  stripShots,
  stripPanelCrop,
  STRIP_SAMPLE_W,
  STRIP_SAMPLE_H,
  recentWallPhotos,
  rgbTriplet,
  sceneEquals,
  sceneFrameChoices,
  boothShowcase,
  showcaseKinds,
  sceneSummary,
  sceneToSave,
  sceneUploadError,
  SCENE_UPLOAD_MAX_BYTES,
} from './scenePage';

const PUBLIC = 'https://x.supabase.co/storage/v1/object/public/assets/sam/uploads/a.png';

function exp(p: Partial<Experience>): Experience {
  return {
    id: 'e1', name: 'Frame', created_at: '', updated_at: '', is_published: true, featured: false,
    sort_order: 0, thumbnail_url: null, kind: 'border', asset_url: PUBLIC, config: {},
    ...p,
  } as Experience;
}

function post(p: Partial<Post>): Post {
  return {
    id: 'p', created_at: '2026-11-19T10:00:00Z', image_url: 'https://x/a.jpg', media_type: 'image',
    duration_ms: null, message: null, guest_name: null, experience_id: null, challenge_id: null,
    session_id: null, approved: true, hidden: false, width: null, height: null,
    ...p,
  };
}

describe('rgbTriplet', () => {
  it('splits a hex', () => expect(rgbTriplet('#D4D6FF')).toBe('212, 214, 255'));
  it('refuses non-hex', () => {
    expect(rgbTriplet('red')).toBeNull();
    expect(rgbTriplet('#fff')).toBeNull();
  });
});

describe('sceneUploadError', () => {
  it('accepts a normal photo', () => expect(sceneUploadError({ type: 'image/jpeg', size: 2_000_000 })).toBeNull());
  it('accepts exactly 10 MB', () => expect(sceneUploadError({ type: 'image/webp', size: SCENE_UPLOAD_MAX_BYTES })).toBeNull());
  it('refuses over 10 MB', () => expect(sceneUploadError({ type: 'image/png', size: SCENE_UPLOAD_MAX_BYTES + 1 })).toMatch(/10 MB/));
  it('refuses svg, gif and non-images', () => {
    expect(sceneUploadError({ type: 'image/svg+xml', size: 10 })).toMatch(/JPG/);
    expect(sceneUploadError({ type: 'image/gif', size: 10 })).toMatch(/JPG/);
    expect(sceneUploadError({ type: 'application/pdf', size: 10 })).toMatch(/JPG/);
  });
  it('refuses an empty file (size 0 is data, not "missing")', () => {
    expect(sceneUploadError({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});

describe('sceneFrameChoices', () => {
  it('keeps published border frames with stored art', () => {
    expect(sceneFrameChoices([exp({ id: 'a', name: 'Gold' })])).toEqual([{ id: 'a', name: 'Gold', url: PUBLIC }]);
  });
  it('drops built-in data: frames, other kinds, unpublished and duplicates', () => {
    const out = sceneFrameChoices([
      exp({ id: 'b', asset_url: 'data:image/svg+xml,<svg/>' }),
      exp({ id: 'c', kind: 'shader' }),
      exp({ id: 'd', is_published: false }),
      exp({ id: 'e' }),
      exp({ id: 'f' }),
      exp({ id: 'g', asset_url: null }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['e']);
  });
  it('accepts a bundled root-relative frame and names a blank one', () => {
    expect(sceneFrameChoices([exp({ asset_url: '/starters/gold-classic.webp', name: ' ' })])).toEqual([
      { id: 'e1', name: 'Frame', url: '/starters/gold-classic.webp' },
    ]);
  });
});

describe('sceneEquals / sceneToSave / sceneSummary', () => {
  it('compares structurally and treats undefined as the default', () => {
    expect(sceneEquals(undefined, undefined)).toBe(true);
    expect(sceneEquals({ kind: 'template', id: 'beamwall' }, undefined)).toBe(false);
    expect(sceneEquals({ kind: 'color', color: '#112233' }, { kind: 'color', color: '#112233' })).toBe(true);
    expect(sceneEquals({ kind: 'color', color: '#112233' }, { kind: 'color', color: '#112234' })).toBe(false);
  });
  it('never saves a half-valid draft', () => {
    expect(sceneToSave({ kind: 'image', url: 'javascript:alert(1)', dim: 0.3, tone: 'dark' })).toBeNull();
    expect(sceneToSave(undefined)).toBeNull();
    expect(sceneToSave({ kind: 'image', url: PUBLIC, dim: 0, tone: 'light' })).toEqual({ kind: 'image', url: PUBLIC, dim: 0, tone: 'light' });
  });
  it('summarises each kind', () => {
    expect(sceneSummary(undefined)).toMatch(/default/);
    expect(sceneSummary({ kind: 'template', id: 'pearl-studio' })).toBe('Pearl template');
    expect(sceneSummary({ kind: 'gradient', paletteId: 'mist' })).toBe('Mist gradient');
    expect(sceneSummary({ kind: 'color', color: '#abcdef' })).toBe('Solid colour #ABCDEF');
    expect(sceneSummary({ kind: 'image', url: PUBLIC, dim: 0.3, tone: 'dark' })).toMatch(/photo/);
    expect(sceneSummary({ kind: 'frame', url: PUBLIC, paletteId: 'dusk' })).toMatch(/frame/);
  });
});

describe('draftTone', () => {
  it('follows the palette, the photo choice and the colour', () => {
    expect(draftTone({ kind: 'template', id: 'pearl-studio' })).toBe('light');
    expect(draftTone({ kind: 'template', id: 'beamwall' })).toBe('dark');
    expect(draftTone({ kind: 'gradient', paletteId: 'sage' })).toBe('light');
    expect(draftTone({ kind: 'frame', url: PUBLIC, paletteId: 'midnight' })).toBe('dark');
    expect(draftTone({ kind: 'image', url: PUBLIC, dim: 0, tone: 'light' })).toBe('light');
    expect(draftTone({ kind: 'color', color: '#FFFFFF' })).toBe('light');
    expect(draftTone({ kind: 'color', color: '#000000' })).toBe('dark');
    expect(draftTone(undefined, 'light')).toBe('light');
  });
});

describe('recentWallPhotos', () => {
  it('keeps visible images, newest first, capped', () => {
    const out = recentWallPhotos([
      post({ id: 'old', created_at: '2026-11-19T09:00:00Z' }),
      post({ id: 'new', created_at: '2026-11-19T11:00:00Z' }),
      post({ id: 'vid', media_type: 'video' }),
      post({ id: 'hid', hidden: true }),
      post({ id: 'unapproved', approved: false }),
      post({ id: 'mid', created_at: '2026-11-19T10:00:00Z' }),
    ], 2);
    expect(out.map((p) => p.id)).toEqual(['new', 'mid']);
  });
  it('returns nothing for a zero limit', () => expect(recentWallPhotos([post({})], 0)).toEqual([]));
  it('does not mutate the store array', () => {
    const list = [post({ id: 'a', created_at: '1' }), post({ id: 'b', created_at: '2' })];
    recentWallPhotos(list, 5);
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('wall field', () => {
  it('sizes a phone and a desktop within the tile budget', () => {
    const phone = wallFieldSize(390, 844);
    const desk = wallFieldSize(1440, 900);
    expect(phone.cols).toBeGreaterThanOrEqual(4);
    expect(phone.tiles).toBeLessThanOrEqual(30);
    expect(desk.cols).toBe(9);
    expect(desk.tiles).toBeLessThanOrEqual(63);
    expect(wallFieldSize(NaN, 0)).toEqual(wallFieldSize(390, 844));
  });
  it('tileOrder is a stable permutation', () => {
    const o = tileOrder(30);
    expect([...o].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(tileOrder(30)).toEqual(o);
    expect(o.slice(0, 5)).not.toEqual([0, 1, 2, 3, 4]);
    expect(tileOrder(0)).toEqual([]);
  });
  it('wallFieldPhotos keeps the newest N, oldest first, so tiles never reshuffle', () => {
    const a = post({ id: 'a', created_at: '2026-11-19T09:00:00Z' });
    const b = post({ id: 'b', created_at: '2026-11-19T10:00:00Z' });
    const c = post({ id: 'c', created_at: '2026-11-19T11:00:00Z' });
    expect(wallFieldPhotos([c, a, b], 5).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(wallFieldPhotos([c, a, b], 2).map((p) => p.id)).toEqual(['b', 'c']);
  });
});

describe('wallFieldSlots', () => {
  it('is a permutation of every tile, stable across calls', () => {
    for (const [w, h] of [[390, 844], [1440, 900], [768, 1024]]) {
      const { cols, rows, tiles } = wallFieldSize(w, h);
      const s = wallFieldSlots(cols, rows, w, h);
      expect([...s].sort((a, b) => a - b)).toEqual(Array.from({ length: tiles }, (_, i) => i));
      expect(wallFieldSlots(cols, rows, w, h)).toEqual(s);
    }
  });
  it('puts on-screen tiles clear of the words and the booth first', () => {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      const { cols, rows } = wallFieldSize(w, h);
      const first = wallFieldSlots(cols, rows, w, h).slice(0, 6);
      for (const t of first) {
        const { x, y } = wallFieldTileCentre(t, cols, rows, w, h);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(1);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(1);
        if (w >= 1024) expect(x < 0.1 || x > 0.52 || y < 0.12 || y > 0.86).toBe(true);
      }
    }
  });
  it('maps the plane centre to the middle of the screen', () => {
    const c = wallFieldTileCentre(4, 9, 1, 1000, 1000);
    expect(c.x).toBeCloseTo(0.5, 5);
    expect(c.y).toBeCloseTo(0.48, 5);
  });
});

describe('withPageBorder', () => {
  it('adds, replaces and removes the border without touching the look', () => {
    const t = { kind: 'gradient', paletteId: 'aurora' } as const;
    expect(withPageBorder(t, 'glow')).toEqual({ ...t, border: 'glow' });
    expect(withPageBorder({ ...t, border: 'glow' }, 'gilded')).toEqual({ ...t, border: 'gilded' });
    expect(withPageBorder({ ...t, border: 'glow' }, 'none')).toEqual(t);
    expect(withPageBorder(t, 'none')).toBe(t);
  });
  it('a border with no look yet starts from the first template; none stays nothing', () => {
    const s = withPageBorder(undefined, 'filmstrip');
    expect(s?.kind).toBe('template');
    expect(s?.border).toBe('filmstrip');
    expect(sceneToSave(s)).toEqual(s);
    expect(withPageBorder(undefined, 'none')).toBeUndefined();
  });
});

describe('heroFrameUrl', () => {
  const a = exp({ id: 'a', kind: 'border', asset_url: 'data:image/svg+xml;utf8,<svg/>' });
  const b = exp({ id: 'b', kind: 'border', asset_url: '/frames/b.png' });
  const f = exp({ id: 'f', kind: '2d_filter', asset_url: '/x.png' });
  const bad = exp({ id: 'bad', kind: 'border', asset_url: 'javascript:alert(1)' });
  it('prefers the opening look when it is a frame, built-in or not', () => {
    expect(heroFrameUrl([a, b], 'b')).toBe('/frames/b.png');
    expect(heroFrameUrl([a, b], 'a')).toBe(a.asset_url);
  });
  it('falls back to the host’s own first frame (never a built-in), then none', () => {
    expect(heroFrameUrl([f, bad, a, b], 'f')).toBe('/frames/b.png');
    expect(heroFrameUrl([a, b], null)).toBe('/frames/b.png');
    expect(heroFrameUrl([a], null)).toBeUndefined();
    expect(heroFrameUrl([f, bad], null)).toBeUndefined();
    expect(heroFrameUrl([exp({ id: 'p', kind: 'border', asset_url: '//evil.com/a.png' })], null)).toBeUndefined();
  });
});

describe('boothScreen', () => {
  it('puts the event frame over the stand-in guest', () => {
    expect(boothScreen('/frames/b.png', '/standin.webp')).toEqual({ photo: '/standin.webp', frame: '/frames/b.png' });
  });
  it('shows a finished look, with no frame on top, when the event has no frame', () => {
    expect(boothScreen(undefined, '/standin.webp')).toEqual({ photo: BOOTH_SCREEN_FALLBACK });
    expect(boothScreen('', '/standin.webp')).toEqual({ photo: BOOTH_SCREEN_FALLBACK });
  });
  it('puts the host-chosen photo under the frame, or alone without one', () => {
    expect(boothScreen('/frames/b.png', '/standin.webp', '/events/x/me.jpg')).toEqual({ photo: '/events/x/me.jpg', frame: '/frames/b.png' });
    expect(boothScreen(undefined, '/standin.webp', '/events/x/me.jpg')).toEqual({ photo: '/events/x/me.jpg' });
    expect(boothScreen('/frames/b.png', '/standin.webp', undefined)).toEqual({ photo: '/standin.webp', frame: '/frames/b.png' });
  });
});

describe('wallFieldColumns', () => {
  it('a phone gets 4 columns, a desktop 11, each tall enough to loop', () => {
    expect(wallFieldColumns(390, 844).cols).toBe(4);
    expect(wallFieldColumns(1440, 900).cols).toBe(11);
    for (const [w, h] of [[390, 844], [1440, 900], [1024, 768], [2560, 1440]]) {
      const { cols, perCol } = wallFieldColumns(w, h);
      const tileH = ((1.38 * w) / cols) * (16 / 9);
      expect(perCol * tileH).toBeGreaterThanOrEqual(1.28 * h);
      expect(cols * perCol).toBeLessThanOrEqual(99);
    }
    expect(wallFieldColumns(NaN, -1)).toEqual(wallFieldColumns(390, 844));
  });
});

describe('wallFieldFill', () => {
  it('fills every tile from a few photos, never repeating a neighbour', () => {
    for (const n of [3, 5, 10, 12]) {
      const g = wallFieldFill(n, 11, 5);
      expect(g).toHaveLength(11);
      expect(new Set(g.flat())).toEqual(new Set(Array.from({ length: n }, (_, i) => i)));
      g.forEach((col, c) => col.forEach((v, r) => {
        expect(v).toBeGreaterThanOrEqual(0);
        if (r > 0) expect(v).not.toBe(col[r - 1]);
        if (c > 0) expect(v).not.toBe(g[c - 1][r]);
      }));
      // The column loops: its last tile meets its first.
      g.forEach((col) => expect(col[col.length - 1]).not.toBe(col[0]));
      expect(wallFieldFill(n, 11, 5)).toEqual(g);
    }
  });
  it('two photos alternate down a column; one photo fills everything; none is glass', () => {
    const two = wallFieldFill(2, 4, 6);
    two.forEach((col) => col.forEach((v, r) => { if (r > 0) expect(v).not.toBe(col[r - 1]); }));
    expect(wallFieldFill(1, 3, 4).flat().every((v) => v === 0)).toBe(true);
    expect(wallFieldFill(0, 3, 4)).toEqual([[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]);
  });
});

describe('stripShots', () => {
  const W = STRIP_SAMPLE_W;
  const H = STRIP_SAMPLE_H;
  /** Deterministic noise in 0-255, like a busy photo. */
  const noise = (x: number, y: number) => ((Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 0) % 200) + 20;
  const strip = (shots: 2 | 3) => {
    const L = stripLayout(1080, 1920, shots);
    const lum = new Float32Array(W * H);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const px = ((x + 0.5) / W) * 1080;
        const py = ((y + 0.5) / H) * 1920;
        const inPanel = L.panels.some((p) => px >= p.x && px < p.x + p.w && py >= p.y && py < p.y + p.h);
        lum[y * W + x] = inPanel ? noise(x, y) : 30 + y * 0.25;
      }
    }
    return lum;
  };
  it('recognises 3- and 2-panel strips', () => {
    expect(stripShots(strip(3), W, H)).toBe(3);
    expect(stripShots(strip(2), W, H)).toBe(2);
  });
  it('a busy single shot, a centred subject on a plain wall and a flat image are single shots', () => {
    const busyShot = Float32Array.from({ length: W * H }, (_, i) => noise(i % W, Math.floor(i / W)));
    expect(stripShots(busyShot, W, H)).toBe(0);
    const subject = Float32Array.from({ length: W * H }, (_, i) => {
      const x = i % W;
      return x > W * 0.25 && x < W * 0.75 ? noise(x, Math.floor(i / W)) : 120;
    });
    expect(stripShots(subject, W, H)).toBe(0);
    expect(stripShots(new Float32Array(W * H).fill(128), W, H)).toBe(0);
    expect(stripShots([], W, H)).toBe(0);
  });
  it('crops to the first panel, cover-fit', () => {
    const c = stripPanelCrop(3);
    const p = stripLayout(1080, 1920, 3).panels[0];
    expect(c.cx).toBeCloseTo(0.5, 2);
    expect(c.cy).toBeCloseTo((p.y + p.h / 2) / 1920, 5);
    expect(Math.min(p.w / 1080, p.h / 1920) * c.scale).toBeCloseTo(1, 5);
    expect(stripPanelCrop(2).scale).toBeGreaterThan(1);
  });
});

describe('boothShowcase', () => {
  const own = (id: string, kind: Experience['kind'], extra: Partial<Experience> = {}) =>
    exp({ id, kind, thumbnail_url: `/t/${id}.webp`, asset_url: null, ...extra });

  it('fills with generic defaults when the event has no looks', () => {
    const cards = boothShowcase([], 6);
    expect(cards).toHaveLength(6);
    expect(cards.every((c) => c.id.startsWith('default-'))).toBe(true);
    expect(cards.some((c) => c.url.includes('gold'))).toBe(false);
  });

  it('puts the event\'s own looks first, kinds interleaved, globals after', () => {
    const cards = boothShowcase([
      own('g1', 'border', { is_global: true }),
      own('f1', 'border'),
      own('f2', 'border'),
      own('p1', '3d_attachment'),
      own('s1', 'shader'),
    ], 5);
    expect(cards.map((c) => c.id)).toEqual(['f1', 'p1', 's1', 'f2', 'g1']);
    expect(cards.map((c) => c.kind)).toEqual(['frame', 'prop', 'filter', 'frame', 'frame']);
  });

  it('shows a frame\'s own art when it has no thumbnail, and skips pictureless looks', () => {
    const cards = boothShowcase([
      own('f', 'border', { thumbnail_url: null, asset_url: '/frames/f.png' }),
      own('s', 'shader', { thumbnail_url: null }),
      own('bad', '3d_attachment', { thumbnail_url: 'javascript:alert(1)' }),
    ], 3);
    expect(cards[0]).toEqual({ id: 'f', kind: 'frame', url: '/frames/f.png', fit: 'contain' });
    expect(cards.slice(1).every((c) => c.id.startsWith('default-'))).toBe(true);
  });

  it('skips the built-in engine looks', () => {
    const cards = boothShowcase([own('builtin:border:gala', 'border')], 2);
    expect(cards.every((c) => c.id.startsWith('default-'))).toBe(true);
  });

  it('never shows the same picture twice', () => {
    const cards = boothShowcase([own('a', 'border', { thumbnail_url: '/x.webp' }), own('b', 'border', { thumbnail_url: '/x.webp' })], 6);
    expect(new Set(cards.map((c) => c.url)).size).toBe(cards.length);
  });

  it('showcaseKinds lists only the kinds present, in caption order', () => {
    expect(showcaseKinds([{ id: 'a', kind: 'frame', url: '/a', fit: 'cover' }, { id: 'b', kind: 'prop', url: '/b', fit: 'cover' }]))
      .toEqual(['prop', 'frame']);
  });
});
