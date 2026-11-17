/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  COLLAGE_BLURBS,
  COLLAGE_HEIGHT,
  COLLAGE_LABELS,
  COLLAGE_TEMPLATES,
  COLLAGE_WIDTH,
  collageCapacity,
  collageFileName,
  collageLayout,
  photoRect,
  pickCollagePhotos,
  seededUnit,
  type CollagePlacement,
  type CollageTemplate,
} from './recapCollage';

const W = COLLAGE_WIDTH;
const H = COLLAGE_HEIGHT;

/** ids that look like the real thing — post ids are uuids. */
function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `9f${i}c4d1e-aaaa-4bbb-8ccc-00000000${String(i).padStart(4, '0')}`);
}

function centre(c: CollagePlacement): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}

/** Strict overlap: sharing only an edge is not an overlap. */
function overlaps(a: CollagePlacement, b: CollagePlacement): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('collage templates — the registry the picker renders', () => {
  it('offers exactly three, each with a label and a blurb', () => {
    expect(COLLAGE_TEMPLATES).toEqual(['mosaic', 'filmstrip', 'scatter']);
    for (const t of COLLAGE_TEMPLATES) {
      expect(COLLAGE_LABELS[t].length).toBeGreaterThan(0);
      expect(COLLAGE_BLURBS[t].length).toBeGreaterThan(0);
    }
  });

  it('caps each template between 12 and 16 photos', () => {
    expect(collageCapacity('mosaic')).toBe(16);
    expect(collageCapacity('filmstrip')).toBe(12);
    expect(collageCapacity('scatter')).toBe(12);
    for (const t of COLLAGE_TEMPLATES) {
      expect(collageCapacity(t)).toBeGreaterThanOrEqual(12);
      expect(collageCapacity(t)).toBeLessThanOrEqual(16);
    }
  });

  it('never lays out more cells than the template can hold', () => {
    for (const t of COLLAGE_TEMPLATES) {
      expect(collageLayout(500, W, H, t, ids(500)).cells).toHaveLength(collageCapacity(t));
    }
  });

  it('survives a count of zero and a degenerate canvas', () => {
    for (const t of COLLAGE_TEMPLATES) {
      expect(collageLayout(0, W, H, t).cells).toEqual([]);
      const tiny = collageLayout(4, 1, 1, t, ids(4));
      expect(tiny.width).toBeGreaterThanOrEqual(2);
      expect(tiny.height).toBeGreaterThanOrEqual(2);
      for (const c of tiny.cells) {
        expect(Number.isFinite(c.x)).toBe(true);
        expect(Number.isFinite(c.y)).toBe(true);
        expect(Number.isFinite(c.rotation)).toBe(true);
      }
    }
  });

  it('echoes the post id it placed, so a layout can be traced to its album', () => {
    const seeds = ids(6);
    for (const t of COLLAGE_TEMPLATES) {
      const cells = collageLayout(6, W, H, t, seeds).cells;
      expect(cells.map((c) => c.seed)).toEqual(seeds);
    }
  });
});

describe('seededUnit — the reason there is no Math.random in here', () => {
  it('is stable across calls', () => {
    expect(seededUnit('post-a', 3)).toBe(seededUnit('post-a', 3));
  });

  it('stays in [0, 1)', () => {
    for (let i = 0; i < 500; i += 1) {
      const v = seededUnit(`post-${i}`, i % 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('decorrelates salts, so one photo’s tilt does not follow its position', () => {
    const a = seededUnit('same-id', 1);
    const b = seededUnit('same-id', 2);
    const c = seededUnit('same-id', 3);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('spreads different ids across the range', () => {
    const vals = ids(200).map((s) => seededUnit(s, 4));
    expect(Math.min(...vals)).toBeLessThan(0.15);
    expect(Math.max(...vals)).toBeGreaterThan(0.85);
    // No pathological clumping: at least 190 distinct values out of 200.
    expect(new Set(vals).size).toBeGreaterThan(190);
  });
});

describe('mosaic — the template that promises a clean grid', () => {
  const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 15, 16];

  it('keeps every cell inside the canvas', () => {
    for (const n of counts) {
      const l = collageLayout(n, W, H, 'mosaic', ids(n));
      for (const c of l.cells) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(W + 1e-6);
        expect(c.y + c.h).toBeLessThanOrEqual(H + 1e-6);
        expect(c.w).toBeGreaterThan(0);
        expect(c.h).toBeGreaterThan(0);
      }
    }
  });

  it('never overlaps two cells', () => {
    for (const n of counts) {
      const cells = collageLayout(n, W, H, 'mosaic', ids(n)).cells;
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          expect(overlaps(cells[i], cells[j])).toBe(false);
        }
      }
    }
  });

  it('never runs a cell under the name plate', () => {
    for (const n of counts) {
      const l = collageLayout(n, W, H, 'mosaic', ids(n));
      for (const c of l.cells) {
        expect(c.y + c.h).toBeLessThanOrEqual(l.plate.y + 1e-6);
      }
      expect(l.plate.y + l.plate.h).toBeLessThanOrEqual(H);
    }
  });

  it('centres a short last row instead of left-aligning it', () => {
    // 7 photos on a 4:5 canvas lands 3 columns, so the last row holds one.
    const l = collageLayout(7, W, H, 'mosaic', ids(7));
    const lastRow = l.cells.slice(6);
    expect(lastRow).toHaveLength(1);
    const c = centre(lastRow[0]);
    expect(c.x).toBeCloseTo(W / 2, 6);
  });

  it('mounts photos flush — no polaroid mat, no rotation', () => {
    const l = collageLayout(9, W, H, 'mosaic', ids(9));
    expect(l.mat).toBe(0);
    expect(l.matBottom).toBe(0);
    expect(l.strips).toEqual([]);
    for (const c of l.cells) expect(c.rotation).toBe(0);
  });
});

describe('filmstrip — angled runs on film stock', () => {
  it('uses two strips for a short album and three once it grows', () => {
    expect(collageLayout(3, W, H, 'filmstrip', ids(3)).strips).toHaveLength(2);
    expect(collageLayout(4, W, H, 'filmstrip', ids(4)).strips).toHaveLength(2);
    expect(collageLayout(5, W, H, 'filmstrip', ids(5)).strips).toHaveLength(3);
    expect(collageLayout(12, W, H, 'filmstrip', ids(12)).strips).toHaveLength(3);
    // One photo cannot make two strips, one of which would be empty film.
    expect(collageLayout(1, W, H, 'filmstrip', ids(1)).strips).toHaveLength(1);
  });

  it('spreads frames across the strips, remainder to the earlier ones', () => {
    const l = collageLayout(5, W, H, 'filmstrip', ids(5));
    expect(l.cells).toHaveLength(5);
    // 5 over 3 strips = 2/2/1: exactly three distinct strip angles are used.
    const byAngle = new Map<number, number>();
    for (const c of l.cells) byAngle.set(c.rotation, (byAngle.get(c.rotation) ?? 0) + 1);
    expect([...byAngle.values()].sort()).toEqual([1, 2, 2]);
  });

  it('turns every frame on a strip by that strip’s own angle', () => {
    const l = collageLayout(9, W, H, 'filmstrip', ids(9));
    const angles = new Set(l.cells.map((c) => c.rotation));
    expect(angles.size).toBe(l.strips.length);
    for (const a of angles) expect(l.strips.some((s) => s.rotation === a)).toBe(true);
    // Leaning, not flat — a straight filmstrip is just a row of pictures.
    for (const a of angles) expect(Math.abs(a)).toBeGreaterThan(0.01);
  });

  it('keeps every frame’s centre on the canvas even though strips over-run it', () => {
    for (const n of [1, 2, 5, 8, 12]) {
      const l = collageLayout(n, W, H, 'filmstrip', ids(n));
      for (const c of l.cells) {
        const p = centre(c);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(W);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(H);
      }
      // The stock itself is deliberately wider than the canvas.
      for (const s of l.strips) expect(s.w).toBeGreaterThan(W);
    }
  });

  it('lays frames left to right in order along each strip', () => {
    const l = collageLayout(9, W, H, 'filmstrip', ids(9));
    for (const s of l.strips) {
      const run = l.cells.filter((c) => c.rotation === s.rotation);
      for (let i = 1; i < run.length; i += 1) {
        expect(run[i].x).toBeGreaterThan(run[i - 1].x);
      }
    }
  });

  it('never overlaps two frames on the same strip', () => {
    // The mosaic's axis-aligned overlap test cannot be reused: these frames are
    // turned, so two boxes whose UNROTATED rects intersect may not touch at all
    // once drawn. Frames on one strip share an angle, so the honest check is the
    // gap between consecutive centres measured along the run — it must clear a
    // whole frame width.
    for (const n of [2, 5, 9, 12]) {
      const l = collageLayout(n, W, H, 'filmstrip', ids(n));
      for (const s of l.strips) {
        const run = l.cells.filter((c) => c.rotation === s.rotation);
        for (let i = 1; i < run.length; i += 1) {
          const a = centre(run[i - 1]);
          const b = centre(run[i]);
          const apart = Math.hypot(b.x - a.x, b.y - a.y);
          expect(apart).toBeGreaterThan(run[i].w);
        }
      }
    }
  });

  it('mounts frames flush on the stock — no polaroid mat', () => {
    const l = collageLayout(8, W, H, 'filmstrip', ids(8));
    expect(l.mat).toBe(0);
    expect(l.matBottom).toBe(0);
  });
});

describe('the exported picture', () => {
  it('is portrait 4:5, the crop phone galleries and social surfaces are kindest to', () => {
    expect(COLLAGE_WIDTH).toBe(1600);
    expect(COLLAGE_HEIGHT).toBe(2000);
    expect(COLLAGE_WIDTH / COLLAGE_HEIGHT).toBeCloseTo(0.8, 10);
  });

  it('lays out at whatever size the preview canvas happens to be', () => {
    // The on-screen preview is a CSS-sized canvas and the export is 1600×2000,
    // and BOTH run this same function — so what the guest taps download on has
    // to be what lands in their gallery.
    //
    // The check is on the composition, not the arithmetic: pads, gaps and radii
    // are rounded to whole pixels so canvas edges stay crisp, which makes a
    // small canvas differ from a large one by up to a pixel per rounded term
    // (at 320px wide the 4.5% pad rounds to 14, which is 70 rather than 72 when
    // scaled up ×5). A pixel of pad is invisible; a print in the wrong place is
    // not, so positions are compared as fractions of the canvas.
    for (const t of COLLAGE_TEMPLATES) {
      const small = collageLayout(9, 320, 400, t, ids(9));
      const big = collageLayout(9, W, H, t, ids(9));
      expect(small.cells).toHaveLength(big.cells.length);
      for (let i = 0; i < small.cells.length; i += 1) {
        const a = small.cells[i];
        const b = big.cells[i];
        expect(a.x / 320).toBeCloseTo(b.x / W, 2);
        expect(a.y / 400).toBeCloseTo(b.y / H, 2);
        expect(a.w / 320).toBeCloseTo(b.w / W, 2);
        // Angles carry no pixels at all, so they must match exactly.
        expect(a.rotation).toBe(b.rotation);
      }
    }
  });
});

describe('scatter — deterministic polaroids', () => {
  it('is exactly reproducible from the same post ids', () => {
    const seeds = ids(10);
    const a = collageLayout(10, W, H, 'scatter', seeds);
    const b = collageLayout(10, W, H, 'scatter', seeds);
    expect(a.cells).toEqual(b.cells);
  });

  it('lays a different album out differently', () => {
    const a = collageLayout(10, W, H, 'scatter', ids(10));
    const b = collageLayout(10, W, H, 'scatter', ids(10).map((s) => `${s}-x`));
    expect(a.cells).not.toEqual(b.cells);
  });

  it('keeps every tilt inside 11 degrees — a pile, not a whirlwind', () => {
    const max = (11 * Math.PI) / 180;
    for (const c of collageLayout(12, W, H, 'scatter', ids(12)).cells) {
      expect(Math.abs(c.rotation)).toBeLessThanOrEqual(max + 1e-9);
    }
  });

  it('keeps every print’s centre inside the canvas', () => {
    for (const n of [1, 4, 7, 12]) {
      for (const c of collageLayout(n, W, H, 'scatter', ids(n)).cells) {
        const p = centre(c);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(W);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(H);
      }
    }
  });

  it('varies print size, so the pile has depth', () => {
    const widths = collageLayout(12, W, H, 'scatter', ids(12)).cells.map((c) => c.w);
    expect(new Set(widths.map((w) => Math.round(w))).size).toBeGreaterThan(6);
  });

  it('gives each print a polaroid mat with a deeper bottom lip', () => {
    const l = collageLayout(6, W, H, 'scatter', ids(6));
    expect(l.mat).toBeGreaterThan(0);
    expect(l.matBottom).toBeGreaterThan(l.mat);
  });

  it('tilts the caption card too', () => {
    expect(collageLayout(6, W, H, 'scatter', ids(6)).plate.rotation).not.toBe(0);
  });
});

describe('photoRect — the window inside a print', () => {
  it('sits strictly inside its print, with the lip at the bottom', () => {
    const l = collageLayout(6, W, H, 'scatter', ids(6));
    for (const c of l.cells) {
      const r = photoRect(c, l);
      expect(r.x).toBeGreaterThan(c.x);
      expect(r.y).toBeGreaterThan(c.y);
      expect(r.x + r.w).toBeLessThan(c.x + c.w);
      expect(r.y + r.h).toBeLessThan(c.y + c.h);
      // Bottom gutter deeper than the top one — that is what makes it a polaroid.
      const top = r.y - c.y;
      const bottom = c.y + c.h - (r.y + r.h);
      expect(bottom).toBeGreaterThan(top);
    }
  });

  it('is the whole cell when the template mounts flush', () => {
    const l = collageLayout(6, W, H, 'mosaic', ids(6));
    const c = l.cells[0];
    expect(photoRect(c, l)).toEqual({ x: c.x, y: c.y, w: c.w, h: c.h });
  });
});

describe('pickCollagePhotos — whose photos survive the cut', () => {
  const album = ids(30).map((id) => ({ id }));

  it('never drops the guest’s own photo for a stranger’s', () => {
    // Three of the guest's shots sit at the very back of a 30-photo album.
    const mine = new Set([album[27].id, album[28].id, album[29].id]);
    const picked = pickCollagePhotos(album, mine, 'filmstrip');
    expect(picked).toHaveLength(12);
    expect(picked.slice(0, 3).map((p) => p.id)).toEqual([...mine]);
  });

  it('keeps the input order inside each half', () => {
    const mine = new Set([album[5].id, album[1].id]);
    const picked = pickCollagePhotos(album, mine, 'mosaic');
    // album order is 1 before 5, and that is what must survive.
    expect(picked[0].id).toBe(album[1].id);
    expect(picked[1].id).toBe(album[5].id);
    expect(picked[2].id).toBe(album[0].id);
  });

  it('fills up with everyone else once the guest’s own run out', () => {
    const picked = pickCollagePhotos(album, new Set(), 'mosaic');
    expect(picked.map((p) => p.id)).toEqual(album.slice(0, 16).map((p) => p.id));
  });

  it('drops duplicates rather than printing one photo twice', () => {
    const dupes = [album[0], album[0], album[1]];
    expect(pickCollagePhotos(dupes, new Set(), 'scatter')).toHaveLength(2);
  });

  it('handles an album smaller than the template', () => {
    expect(pickCollagePhotos(album.slice(0, 3), new Set(), 'scatter')).toHaveLength(3);
    expect(pickCollagePhotos([], new Set(), 'mosaic')).toEqual([]);
  });
});

describe('collageFileName', () => {
  it('names the download after the event and the template', () => {
    expect(collageFileName('Hope Gala 2026', 'mosaic')).toBe('Hope-Gala-2026-mosaic.png');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(collageFileName('', 'scatter')).toBe('event-scatter.png');
    expect(collageFileName('!!!', 'filmstrip')).toBe('event-filmstrip.png');
  });

  it('covers every template', () => {
    for (const t of COLLAGE_TEMPLATES as readonly CollageTemplate[]) {
      expect(collageFileName('Night', t).endsWith('.png')).toBe(true);
    }
  });
});
