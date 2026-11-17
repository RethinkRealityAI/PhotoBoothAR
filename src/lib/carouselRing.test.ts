/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  ringLayout,
  rotationForIndex,
  shortestAngleDelta,
  ringWindow,
  ndcBoundsToScreenRect,
  isFacingViewer,
  depthPresence,
  ringRadiusForCount,
  cameraDistanceForCard,
  safeThreeColor,
  cardHeightFraction,
  ringSlotsForViewport,
  aimHeightForFrontCard,
  RING_MAX_REPEATS,
  DEFAULT_RADIUS,
  RING_MAX_CARDS,
  RING_MIN_CARDS,
} from './carouselRing';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('ringLayout', () => {
  it('puts slot 0 at the front (local +Z), facing the camera', () => {
    const [first] = ringLayout(8);
    expect(first.angle).toBe(0);
    expect(near(first.position[0], 0)).toBe(true);
    expect(near(first.position[2], DEFAULT_RADIUS)).toBe(true);
    // rotationY 0 leaves the plane's default +Z normal pointing at the camera.
    expect(first.rotationY).toBe(0);
  });

  it('spaces cards evenly all the way round', () => {
    const slots = ringLayout(4);
    expect(slots.map((s) => s.angle)).toEqual([0, Math.PI / 2, Math.PI, Math.PI * 1.5]);
  });

  it('keeps every card on the circle of the given radius', () => {
    for (const s of ringLayout(9, { radius: 3 })) {
      expect(near(Math.hypot(s.position[0], s.position[2]), 3, 1e-12)).toBe(true);
    }
  });

  it('faces each card outward — rotationY equals its own angle', () => {
    for (const s of ringLayout(6)) expect(s.rotationY).toBe(s.angle);
  });

  it('applies the helix rise per slot', () => {
    expect(ringLayout(3, { riseY: 0.1 }).map((s) => s.position[1])).toEqual([0, 0.1, 0.2]);
  });

  it('returns nothing for a non-positive count rather than throwing', () => {
    expect(ringLayout(0)).toEqual([]);
    expect(ringLayout(-3)).toEqual([]);
  });
});

describe('rotationForIndex', () => {
  it('brings the requested slot to the front by negating its angle', () => {
    expect(rotationForIndex(0, 8)).toBe(-0);
    expect(near(rotationForIndex(2, 8), -Math.PI / 2)).toBe(true);
  });

  it('wraps an out-of-range index instead of over-rotating', () => {
    expect(rotationForIndex(9, 8)).toBe(rotationForIndex(1, 8));
  });

  it('is 0 for an empty ring', () => {
    expect(rotationForIndex(3, 0)).toBe(0);
  });
});

describe('shortestAngleDelta', () => {
  it('takes the short way across the 0/2π seam', () => {
    // From just before a full turn to just after: +0.2, not -6.08.
    const d = shortestAngleDelta(Math.PI * 2 - 0.1, 0.1);
    expect(near(d, 0.2, 1e-9)).toBe(true);
  });

  it('goes backwards when backwards is shorter', () => {
    expect(near(shortestAngleDelta(0.1, Math.PI * 2 - 0.1), -0.2, 1e-9)).toBe(true);
  });

  it('is zero for identical angles and for full-turn multiples', () => {
    expect(near(shortestAngleDelta(1.2, 1.2), 0)).toBe(true);
    expect(near(shortestAngleDelta(0, Math.PI * 2), 0, 1e-12)).toBe(true);
  });

  it('always lands within (-π, π]', () => {
    for (let i = -20; i <= 20; i++) {
      const d = shortestAngleDelta(0, i * 0.7);
      expect(d > -Math.PI - 1e-9 && d <= Math.PI + 1e-9).toBe(true);
    }
  });
});

describe('ringWindow', () => {
  const many = Array.from({ length: 100 }, (_, i) => i);

  it('caps a long night at RING_MAX_CARDS, newest first', () => {
    const out = ringWindow(many);
    expect(out).toHaveLength(RING_MAX_CARDS);
    expect(out[0]).toBe(0);
  });

  it('repeats a short list so the circle stays whole', () => {
    const out = ringWindow([1, 2, 3]);
    expect(out).toHaveLength(RING_MIN_CARDS);
    expect(out.slice(0, 3)).toEqual([1, 2, 3]);
    expect(out[3]).toBe(1);
  });

  it('leaves the list untouched when the target is what it already has', () => {
    const ten = Array.from({ length: 10 }, (_, i) => i);
    expect(ringWindow(ten, 10)).toEqual(ten);
  });

  it('pads toward the target, but never past RING_MAX_REPEATS copies', () => {
    const six = Array.from({ length: 6 }, (_, i) => i);
    const out = ringWindow(six, 30);
    expect(out).toHaveLength(6 * RING_MAX_REPEATS);
    expect(out.slice(0, 6)).toEqual(six);
    expect(out.slice(6)).toEqual(six);
  });

  it('still fills a very short list to the minimum — an arc is not a ring', () => {
    // The repeat cap yields into RING_MIN_CARDS: three photos would otherwise
    // give six slots, and one photo would give two.
    expect(ringWindow([1, 2, 3], 30)).toHaveLength(RING_MIN_CARDS);
    expect(ringWindow([1], 30)).toHaveLength(RING_MIN_CARDS);
  });

  it('never exceeds the target', () => {
    const many2 = Array.from({ length: 100 }, (_, i) => i);
    expect(ringWindow(many2, 12)).toHaveLength(12);
    expect(ringWindow(many2, 25)).toHaveLength(25);
  });

  it('returns empty for empty — callers render their own empty state', () => {
    expect(ringWindow([])).toEqual([]);
  });

  it('never divides by zero on a single item', () => {
    const out = ringWindow(['a']);
    expect(out).toHaveLength(RING_MIN_CARDS);
    expect(new Set(out)).toEqual(new Set(['a']));
  });
});

describe('ndcBoundsToScreenRect', () => {
  const canvas = { left: 0, top: 0, width: 1000, height: 500 };

  it('maps a centred NDC box to the middle of the canvas', () => {
    const r = ndcBoundsToScreenRect(
      [{ x: -0.2, y: -0.4 }, { x: 0.2, y: 0.4 }],
      canvas,
    )!;
    expect(r.width).toBeCloseTo(200, 6);
    expect(r.height).toBeCloseTo(200, 6);
    expect(r.left).toBeCloseTo(400, 6);
    expect(r.top).toBeCloseTo(150, 6);
  });

  it('INVERTS y — NDC +1 is the top of the screen', () => {
    // A box hugging NDC top (+y) must sit at small screen `top`.
    const r = ndcBoundsToScreenRect([{ x: -0.1, y: 0.8 }, { x: 0.1, y: 1 }], canvas)!;
    expect(r.top).toBeCloseTo(0, 6);
  });

  it('offsets by the canvas position — the wall has a header above it', () => {
    const r = ndcBoundsToScreenRect(
      [{ x: -0.2, y: -0.4 }, { x: 0.2, y: 0.4 }],
      { left: 40, top: 96, width: 1000, height: 500 },
    )!;
    expect(r.left).toBeCloseTo(440, 6);
    expect(r.top).toBeCloseTo(246, 6);
  });

  it('rejects an edge-on card — a sliver is not somewhere to land ~13k points', () => {
    expect(ndcBoundsToScreenRect([{ x: 0, y: -0.4 }, { x: 0.001, y: 0.4 }], canvas)).toBeNull();
  });

  it('rejects non-finite projections instead of emitting NaN rects', () => {
    expect(ndcBoundsToScreenRect([{ x: NaN, y: 0 }, { x: 0.5, y: 0.5 }], canvas)).toBeNull();
    expect(ndcBoundsToScreenRect([{ x: 0, y: Infinity }, { x: 0.5, y: 0.5 }], canvas)).toBeNull();
  });

  it('returns null for no corners', () => {
    expect(ndcBoundsToScreenRect([], canvas)).toBeNull();
  });

  it('takes the bounding box of all corners, not just the first two', () => {
    const r = ndcBoundsToScreenRect(
      [{ x: -0.5, y: 0 }, { x: 0, y: 0.5 }, { x: 0.5, y: 0 }, { x: 0, y: -0.5 }],
      canvas,
    )!;
    expect(r.width).toBeCloseTo(500, 6);
    expect(r.height).toBeCloseTo(250, 6);
  });
});

describe('isFacingViewer', () => {
  it('accepts the slot at the front', () => {
    expect(isFacingViewer(0, 0)).toBe(true);
  });

  it('rejects the slot on the far side of the ring', () => {
    expect(isFacingViewer(Math.PI, 0)).toBe(false);
  });

  it('accounts for the ring having spun that slot to the front', () => {
    expect(isFacingViewer(Math.PI, -Math.PI)).toBe(true);
  });

  it('handles the seam — a slot just past 2π still reads as front', () => {
    expect(isFacingViewer(Math.PI * 2 - 0.05, 0)).toBe(true);
  });
});

describe('depthPresence', () => {
  it('is fully present dead ahead and dimmest dead behind', () => {
    expect(depthPresence(0, 0)).toBeCloseTo(1, 6);
    expect(depthPresence(Math.PI, 0)).toBeCloseTo(0, 6);
  });

  it('follows the ring as it turns', () => {
    // A card at the back becomes the front card after half a turn.
    expect(depthPresence(Math.PI, Math.PI)).toBeCloseTo(1, 6);
  });

  it('never leaves the 0..1 range for any angle', () => {
    for (let a = -8; a <= 8; a += 0.13) {
      const v = depthPresence(a, 1.7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('decreases monotonically from front to back', () => {
    let prev = depthPresence(0, 0);
    for (let a = 0.1; a <= Math.PI; a += 0.1) {
      const v = depthPresence(a, 0);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it('honours a custom floor', () => {
    expect(depthPresence(Math.PI, 0, 0)).toBeCloseTo(0, 6);
    expect(depthPresence(Math.PI, 0, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe('ringRadiusForCount', () => {
  it('keeps the spacing between cards constant as the ring grows', () => {
    const w = 1.35;
    const spacing = (count: number) => (Math.PI * 2 * ringRadiusForCount(count, w)) / count;
    expect(spacing(12)).toBeCloseTo(spacing(18), 6);
    expect(spacing(12)).toBeCloseTo(w * 1.25, 6);
  });

  it('grows with the photo count', () => {
    const w = 1.35;
    expect(ringRadiusForCount(18, w)).toBeGreaterThan(ringRadiusForCount(12, w));
  });

  it('never collapses below the minimum, whatever it is handed', () => {
    expect(ringRadiusForCount(0, 1.35)).toBe(2.2);
    expect(ringRadiusForCount(-4, 1.35)).toBe(2.2);
    expect(ringRadiusForCount(Number.NaN, 1.35)).toBe(2.2);
    expect(ringRadiusForCount(1, 1.35)).toBe(2.2);
  });

  it('honours a custom gap', () => {
    expect(ringRadiusForCount(14, 1.35, 2)).toBeGreaterThan(ringRadiusForCount(14, 1.35, 1.25));
  });
});

describe('cameraDistanceForCard', () => {
  it('puts the card at the requested fraction of frame height', () => {
    const fov = 32;
    const d = cameraDistanceForCard(2.4, fov, 0.45);
    const visible = 2 * d * Math.tan((fov * Math.PI) / 360);
    expect(2.4 / visible).toBeCloseTo(0.45, 6);
  });

  it('stands further back for a narrower lens', () => {
    expect(cameraDistanceForCard(2.4, 24)).toBeGreaterThan(cameraDistanceForCard(2.4, 45));
  });

  it('clamps a nonsense fraction instead of dividing by zero', () => {
    expect(Number.isFinite(cameraDistanceForCard(2.4, 32, 0))).toBe(true);
    expect(cameraDistanceForCard(2.4, 32, 4)).toBeCloseTo(cameraDistanceForCard(2.4, 32, 1), 6);
  });
});

describe('safeThreeColor', () => {
  it('accepts the hex notations three parses', () => {
    expect(safeThreeColor('#D4AF37', '#000')).toBe('#D4AF37');
    expect(safeThreeColor('#abc', '#000')).toBe('#abc');
    expect(safeThreeColor('  #5B8CFF  ', '#000')).toBe('#5B8CFF');
    expect(safeThreeColor('rgb(212, 175, 55)', '#000')).toBe('rgb(212, 175, 55)');
  });

  it('refuses CSS the renderer cannot read', () => {
    expect(safeThreeColor('var(--color-accent)', '#5B8CFF')).toBe('#5B8CFF');
    expect(safeThreeColor('oklch(0.7 0.15 250)', '#5B8CFF')).toBe('#5B8CFF');
    expect(safeThreeColor('#D4AF3759', '#5B8CFF')).toBe('#5B8CFF');
    expect(safeThreeColor('rebeccapurple', '#5B8CFF')).toBe('#5B8CFF');
  });

  it('falls back on nothing at all', () => {
    expect(safeThreeColor(null, '#5B8CFF')).toBe('#5B8CFF');
    expect(safeThreeColor(undefined, '#5B8CFF')).toBe('#5B8CFF');
    expect(safeThreeColor('', '#5B8CFF')).toBe('#5B8CFF');
    expect(safeThreeColor('   ', '#5B8CFF')).toBe('#5B8CFF');
  });
});

describe('ringSlotsForViewport', () => {
  const CARD_H = 2.4;
  const CARD_W = CARD_H * (9 / 16);
  const base = { cardWidth: CARD_W, cardHeight: CARD_H, fovDeg: 32 };

  it('fills a wide screen with more cards than a narrow one', () => {
    const wide = ringSlotsForViewport(16 / 9, base);
    const narrow = ringSlotsForViewport(390 / 844, { ...base, heroFraction: 0.3 });
    expect(wide).toBeGreaterThan(narrow);
    expect(wide).toBeGreaterThan(20);
  });

  it('produces a ring that really does span about `fill` of the width', () => {
    // Round-trip through the two functions the renderer actually uses: the
    // slot count sets the radius, the radius sets the camera distance.
    const aspect = 16 / 9;
    const slots = ringSlotsForViewport(aspect, base);
    const radius = ringRadiusForCount(slots, CARD_W);
    const camera = radius + cameraDistanceForCard(CARD_H, 32);
    const halfVisible = camera * Math.tan((32 * Math.PI) / 360) * aspect;
    expect(radius / halfVisible).toBeGreaterThan(0.8);
    expect(radius / halfVisible).toBeLessThanOrEqual(1);
  });

  it('stays inside the ring bounds for any aspect', () => {
    for (let a = 0.3; a <= 4; a += 0.1) {
      const n = ringSlotsForViewport(a, base);
      expect(n).toBeGreaterThanOrEqual(RING_MIN_CARDS);
      expect(n).toBeLessThanOrEqual(RING_MAX_CARDS);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('falls back to the minimum on nonsense input', () => {
    expect(ringSlotsForViewport(0, base)).toBe(RING_MIN_CARDS);
    expect(ringSlotsForViewport(Number.NaN, base)).toBe(RING_MIN_CARDS);
    expect(ringSlotsForViewport(1.6, { ...base, cardWidth: 0 })).toBe(RING_MIN_CARDS);
  });
});

describe('cardHeightFraction', () => {
  it('holds the hero smaller on a wide canvas than a tall one', () => {
    expect(cardHeightFraction(16 / 9)).toBeCloseTo(0.45, 6);
    expect(cardHeightFraction(390 / 844)).toBeCloseTo(0.62, 6);
  });

  it('moves smoothly between the two, never past either end', () => {
    let prev = cardHeightFraction(0.5);
    for (let a = 0.5; a <= 2.5; a += 0.05) {
      const v = cardHeightFraction(a);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      expect(v).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(v).toBeLessThanOrEqual(0.62 + 1e-9);
      prev = v;
    }
  });

  it('can be inverted, which is how the wall shrinks its hero on a phone', () => {
    // Wall endpoints: landscape keeps 0.45, portrait pulls back to 0.30 so the
    // neighbouring cards stay in frame under the QR panels.
    expect(cardHeightFraction(16 / 9, 0.45, 0.3)).toBeCloseTo(0.45, 6);
    expect(cardHeightFraction(390 / 844, 0.45, 0.3)).toBeCloseTo(0.3, 6);
    expect(cardHeightFraction(1, 0.45, 0.3)).toBeGreaterThan(0.3);
    expect(cardHeightFraction(1, 0.45, 0.3)).toBeLessThan(0.45);
  });

  it('falls back to the wide framing for a nonsense aspect', () => {
    expect(cardHeightFraction(0)).toBeCloseTo(0.45, 6);
    expect(cardHeightFraction(-2)).toBeCloseTo(0.45, 6);
    expect(cardHeightFraction(Number.NaN)).toBeCloseTo(0.45, 6);
  });
});

describe('aimHeightForFrontCard', () => {
  /** Height of the view axis at `depth` in front of the camera. */
  const axisAt = (camH: number, aimY: number, camZ: number, depth: number) =>
    camH - (depth * (camH - aimY)) / camZ;

  it('puts the view axis exactly through the front card', () => {
    const camH = 1.4;
    const lift = 0.45;
    const radius = 6.94;
    const front = 7.61;
    const aim = aimHeightForFrontCard(camH, lift, radius, front);
    expect(axisAt(camH, aim, radius + front, front)).toBeCloseTo(lift, 9);
  });

  it('aims below the ring — the correction that looks wrong and is right', () => {
    expect(aimHeightForFrontCard(1.4, 0.45, 6.94, 7.61)).toBeLessThan(0.45);
  });

  it('needs no correction when the camera is level with the ring', () => {
    expect(aimHeightForFrontCard(0.45, 0.45, 6.94, 7.61)).toBeCloseTo(0.45, 9);
  });

  it('holds for any ring size', () => {
    for (const radius of [2.2, 4, 6.94, 9.5]) {
      for (const front of [6, 7.61, 12]) {
        const aim = aimHeightForFrontCard(1.4, 0.45, radius, front);
        expect(axisAt(1.4, aim, radius + front, front)).toBeCloseTo(0.45, 9);
      }
    }
  });

  it('falls back to the ring height on a degenerate distance', () => {
    expect(aimHeightForFrontCard(1.4, 0.45, 5, 0)).toBe(0.45);
    expect(aimHeightForFrontCard(1.4, 0.45, 5, Number.NaN)).toBe(0.45);
  });
});
