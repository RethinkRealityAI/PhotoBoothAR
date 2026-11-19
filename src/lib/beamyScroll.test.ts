import { describe, expect, it } from 'vitest';
import {
  DPR_CALM_S, DT_MAX, GLIDE_DT_MAX, JUMP_VH, SIGMA, STOPS, blendSlots, governDpr, damp, dampAngle, followStep, glideStep, pageProgress, pinProgress,
  poseInSlot, slotWeight, stopIndex, storyEdgeOffsets, storyHeightVh, storySnapOffsets, storySnapOn, storyStep, weightedNight, type GlidePt, type SlotSample,
} from './beamyScroll';

const VW = 1440;
const VH = 900;
const slot = (id: string, left: number, top: number, w: number, h: number, yaw = 0, fx?: Record<string, number>): SlotSample => ({
  id, rect: { left, top, width: w, height: h }, pose: { fit: 0.9, yaw, fx },
});

describe('slot weights', () => {
  it('is 1 at the viewport centre and falls off as a Gaussian of viewport heights', () => {
    expect(slotWeight(VH / 2, VH)).toBeCloseTo(1, 6);
    expect(slotWeight(VH / 2 + SIGMA * VH, VH)).toBeCloseTo(Math.exp(-1), 6);
    expect(slotWeight(VH / 2 - VH, VH)).toBeLessThan(0.01);
  });
});

describe('poseInSlot', () => {
  it('stands his feet on the slot floor, as tall as the fit allows', () => {
    const p = poseInSlot({ left: 100, top: 200, width: 400, height: 300 }, { fit: 0.8, yaw: 0 });
    expect(p).toEqual({ x: 300, y: 500, heightPx: 240 });
  });
  it('fits a narrow slot by its width', () => {
    const p = poseInSlot({ left: 0, top: 0, width: 85, height: 600 }, { fit: 1, yaw: 0 });
    expect(p.heightPx).toBeCloseTo(100, 6);
  });
});

describe('blendSlots', () => {
  it('sits exactly in a slot centred on the viewport', () => {
    const b = blendSlots([slot('a', 100, VH / 2 - 150, 300, 300, 0.4), slot('b', 1000, VH * 3, 300, 300, -0.4)], VW, VH, false);
    expect(b.active).toBe(0);
    expect(b.x).toBeCloseTo(250, 0);
    expect(b.y).toBeCloseTo(VH / 2 + 150, 0);
    expect(b.yaw).toBeCloseTo(0.4, 2);
    expect(b.presence).toBe(1);
  });
  it('glides between two slots: half way when both are equally far', () => {
    const a = slot('a', 0, VH / 2 - 150 - 300, 200, 300);
    const c = slot('b', 1000, VH / 2 - 150 + 300, 200, 300);
    const b = blendSlots([a, c], VW, VH, false);
    expect(b.x).toBeCloseTo((100 + 1100) / 2, 3);
    expect(b.share).toBeCloseTo(0.5, 6);
  });
  it('blends angles the short way round', () => {
    const a = slot('a', 0, VH / 2 - 150 - 200, 200, 300, Math.PI - 0.1);
    const c = slot('b', 0, VH / 2 - 150 + 200, 200, 300, -Math.PI + 0.1);
    const b = blendSlots([a, c], VW, VH, false);
    expect(Math.abs(Math.abs(b.yaw) - Math.PI)).toBeLessThan(1e-6);
  });
  it('weights effects by how present their slot is', () => {
    const b = blendSlots([slot('a', 0, VH / 2 - 150, 200, 300, 0, { qr: 1 }), slot('b', 0, VH * 4, 200, 300, 0, { wall: 1 })], VW, VH, false);
    expect(b.fx.qr).toBeGreaterThan(0.99);
    expect(b.fx.wall ?? 0).toBeLessThan(0.01);
  });
  it('dissolves him on phones while the weight is split, never on desktop', () => {
    const a = slot('a', 0, VH / 2 - 150 - 300, 200, 300);
    const c = slot('b', 0, VH / 2 - 150 + 300, 200, 300);
    expect(blendSlots([a, c], 412, VH, true).presence).toBe(0);
    expect(blendSlots([a, c], VW, VH, false).presence).toBe(1);
    const settled = blendSlots([slot('a', 0, VH / 2 - 150, 200, 300), slot('b', 0, VH * 3, 200, 300)], 412, VH, true);
    expect(settled.presence).toBe(1);
  });
  it('holds the nearest slot when every slot is far away, and ignores empty boxes', () => {
    const b = blendSlots([slot('a', 0, -8000, 200, 300), slot('b', 500, 9000, 200, 300), slot('z', 0, VH / 2, 0, 0)], VW, VH, false);
    expect(b.active).toBe(0);
    expect(b.x).toBeCloseTo(100, 6);
  });
  it('waits mid-screen, hidden, with no slot at all', () => {
    const b = blendSlots([], VW, VH, false);
    expect(b.active).toBe(-1);
    expect(b.presence).toBe(0);
  });
});

describe('damping', () => {
  it('is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 100, 12.6, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i++) b = damp(b, 100, 12.6, 1 / 30);
    expect(a).toBeCloseTo(b, 6);
  });
  it('clamps a long frame to 34ms', () => {
    expect(damp(0, 100, 10, 1)).toBeCloseTo(damp(0, 100, 10, DT_MAX), 9);
  });
  it('turns the short way round', () => {
    const v = dampAngle(Math.PI - 0.1, -Math.PI + 0.1, 100, DT_MAX);
    expect(v).toBeGreaterThan(Math.PI - 0.1);
  });
  it('caps the follow speed', () => {
    const p = followStep({ x: 0, y: 0 }, { x: 10000, y: 0 }, 1 / 60, 600);
    expect(p.x).toBeCloseTo(10, 6);
  });
});

describe('pinned story', () => {
  it('sizes the section n × 85vh + 100vh (75vh a step on phones)', () => {
    expect(storyHeightVh(5, false)).toBe(525);
    expect(storyHeightVh(5, true)).toBe(475);
  });
  it('maps scroll to steps with floor(progress × n), holding the last', () => {
    const h = VH * 5.25;
    expect(pinProgress(0, h, VH)).toBe(0);
    expect(pinProgress(-(h - VH), h, VH)).toBe(1);
    expect(storyStep(0, 5)).toBe(0);
    expect(storyStep(0.19, 5)).toBe(0);
    expect(storyStep(0.2, 5)).toBe(1);
    expect(storyStep(1, 5)).toBe(4);
    expect(storyStep(-1, 5)).toBe(0);
  });
});

describe('page journey', () => {
  it('lists the stops top to bottom with alternating sides after the hero', () => {
    expect(STOPS.map((s) => s.id)).toEqual(['hero', 'story', 'films', 'virtual', 'pick', 'try', 'pricing', 'start']);
    expect(stopIndex('films')).toBe(2);
    const sides = STOPS.filter((s) => s.side !== 'centre').map((s) => s.side);
    for (let i = 1; i < sides.length; i++) expect(sides[i]).not.toBe(sides[i - 1]);
  });
  it('blends the night like the slots, holding inside a section', () => {
    const secs = [{ top: -2000, height: 1500, night: 0 }, { top: -500, height: 3000, night: 1 }];
    expect(weightedNight(secs, VH)).toBeGreaterThan(0.99);
    const edge = weightedNight([{ top: -VH, height: VH * 1.5, night: 0 }, { top: VH / 2, height: VH, night: 1 }], VH);
    expect(edge).toBeGreaterThan(0.3);
    expect(edge).toBeLessThan(0.7);
    expect(pageProgress(500, 2000, 1000)).toBe(0.5);
  });
});

/* A page of slots in page px (alternating sides), spaced like /beamy's: measured
   on the built page, no scroll position is ever more than ~1.3 viewport
   heights from a slot. Sampled at a scroll position. */
const PAGE = [
  { id: 'hero', left: 520, top: 200, w: 400, h: 520 },
  { id: 'story', left: 80, top: 1450, w: 420, h: 560 },
  { id: 'pick', left: 940, top: 2750, w: 420, h: 560 },
  { id: 'try', left: 520, top: 4000, w: 400, h: 520 },
];
const at = (scroll: number, vw = VW): SlotSample[] => PAGE.map((p) => slot(p.id, p.left * (vw / VW), p.top - scroll, p.w * (vw / VW), p.h));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('the glide is continuous', () => {
  it('moves the target a little for a little scroll, everywhere on the page', () => {
    let prev = blendSlots(at(0), VW, VH, false);
    let worst = 0;
    for (let y = 1; y <= 4200; y++) {
      const b = blendSlots(at(y), VW, VH, false);
      worst = Math.max(worst, dist(b, prev), Math.abs(b.heightPx - prev.heightPx));
      prev = b;
    }
    // One px of scroll never moves him more than a few px (the steepest real
    // hand-over measured on /beamy is 3.6; a jump would be ~1000).
    expect(worst).toBeLessThan(10);
  });
  it('on phones, any hand-over between slots happens while he is dissolved', () => {
    const w = 412;
    let prev = blendSlots(at(0, w), w, VH, true);
    for (let y = 1; y <= 4200; y++) {
      const b = blendSlots(at(y, w), w, VH, true);
      if (dist(b, prev) > 6) expect(Math.min(b.presence, prev.presence), `scroll ${y}`).toBeLessThan(0.02);
      prev = b;
    }
  });
  it('rides a scrolling slot exactly: no lag to drift out of', () => {
    let cur: GlidePt = { x: 300, y: 600, h: 400 };
    let prev: GlidePt = { ...cur };
    for (let i = 1; i <= 60; i++) {
      const target = { x: 300, y: 600 - i * 45, h: 400 };
      cur = glideStep(cur, prev, target, 1 / 60, VH);
      prev = target;
      expect(dist(cur, target)).toBeLessThan(1e-9);
    }
  });
  it('eases what is left over, frame-rate independent, and resumes a stall without teleporting', () => {
    const t: GlidePt = { x: 600, y: 500, h: 300 };
    let a: GlidePt = { x: 400, y: 500, h: 300 };
    for (let i = 0; i < 20; i++) a = glideStep(a, t, t, 1 / 60, VH);
    let b: GlidePt = { x: 400, y: 500, h: 300 };
    for (let i = 0; i < 10; i++) b = glideStep(b, t, t, 1 / 30, VH);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.x).toBeGreaterThan(400);
    expect(a.x).toBeLessThan(600);
    const long = glideStep({ x: 400, y: 500, h: 300 }, t, t, 5, VH);
    expect(long.x).toBeCloseTo(glideStep({ x: 400, y: 500, h: 300 }, t, t, GLIDE_DT_MAX, VH).x, 9);
    expect(long.x).toBeLessThan(600);
  });
  it('does not feed a one-frame jump through, and snaps over a long gap or while dissolved', () => {
    const from: GlidePt = { x: 300, y: 500, h: 300 };
    const jumped = { x: 300, y: 500 + JUMP_VH * VH + 50, h: 300 };
    const g = glideStep(from, from, jumped, 1 / 60, VH);
    expect(g.y - 500).toBeLessThan((jumped.y - 500) * 0.5);
    expect(glideStep(from, from, { x: 300, y: 500 + VH * 1.5, h: 300 }, 1 / 60, VH).y).toBe(500 + VH * 1.5);
    expect(glideStep(from, from, { x: 900, y: 520, h: 280 }, 1 / 60, VH, 12, true)).toEqual({ x: 900, y: 520, h: 280 });
  });
  it('still rides the scroll on a slow device (5 fps frames carry big moves)', () => {
    const from: GlidePt = { x: 300, y: 700, h: 300 };
    const moved = { x: 300, y: 700 - 500, h: 300 };
    expect(glideStep(from, from, moved, 0.2, VH)).toEqual(moved);
  });
  it('turns a page sweep into small steps at 60 fps', () => {
    let cur: GlidePt | null = null;
    let prev: GlidePt | null = null;
    let worst = 0;
    for (let y = 0; y <= 4200; y += 30) {
      const b = blendSlots(at(y), VW, VH, false);
      const target = { x: b.x, y: b.y, h: b.heightPx };
      const next: GlidePt = cur === null ? target : glideStep(cur, prev, target, 1 / 60, VH);
      if (cur !== null) worst = Math.max(worst, dist(next, cur));
      cur = next;
      prev = target;
    }
    // 30 px of scroll a frame (a brisk scroll): he moves a few times that at
    // most, never the ~1000 px of a slot-to-slot jump.
    expect(worst).toBeLessThan(250);
  });
});

describe('the stage pixel budget', () => {
  it('steps down at once on a slow second, never under 1', () => {
    expect(governDpr(1.5, 30, 1.5, 3)).toEqual({ dpr: 1.25, calm: 0 });
    expect(governDpr(1, 20, 1.5, 0).dpr).toBe(1);
  });
  it('steps back up only after a run of calm seconds, never over the cap', () => {
    let s = { dpr: 1, calm: 0 };
    for (let i = 0; i < DPR_CALM_S - 1; i++) s = governDpr(s.dpr, 60, 1.5, s.calm);
    expect(s.dpr).toBe(1);
    s = governDpr(s.dpr, 60, 1.5, s.calm);
    expect(s.dpr).toBe(1.25);
    expect(governDpr(1.5, 60, 1.5, 10).dpr).toBe(1.5);
    expect(governDpr(1.25, 50, 1.5, 3)).toEqual({ dpr: 1.25, calm: 0 });
  });

  it('puts one phone snap anchor in the middle of every story step', () => {
    // 390×844 phone: header 64, five steps at 75vh.
    for (const [vh, header] of [[844, 64], [915, 72], [667, 60]]) {
      const n = 5;
      const h = (storyHeightVh(n, true) / 100) * vh;
      const a = storySnapOffsets(n, h, vh, header);
      expect(a).toHaveLength(n);
      a.forEach((off, k) => {
        // Snapped (anchor top at the viewport top): the page reads step k, mid-step.
        const p = pinProgress(-off - header, h, vh - header);
        expect(p).toBeCloseTo((k + 0.5) / n, 9);
        expect(storyStep(p, n)).toBe(k);
        // Inside the section, increasing, evenly spaced: one stop per step.
        expect(off).toBeGreaterThan(0);
        expect(off).toBeLessThan(h);
        if (k > 0) expect(off - a[k - 1]).toBeCloseTo((h - (vh - header)) / n, 9);
      });
    }
    expect(storySnapOffsets(0, 1000, 800, 64)).toEqual([]);
  });

  it('snaps only strictly inside the pinned stretch, with an anchor at each end to leave by', () => {
    const vh = 844, header = 64, n = 5;
    const h = (storyHeightVh(n, true) / 100) * vh;
    const [start, end] = storyEdgeOffsets(h, vh, header);
    expect(pinProgress(-start - header, h, vh - header)).toBe(0);
    expect(pinProgress(-end - header, h, vh - header)).toBe(1);
    // Snapped on an end anchor, snapping is off: the next swipe leaves freely.
    expect(storySnapOn(-start, -start + h, header, vh)).toBe(false);
    expect(storySnapOn(-end, -end + h, header, vh)).toBe(false);
    // Every step anchor is strictly inside: snapping holds a flick to one step.
    for (const a of storySnapOffsets(n, h, vh, header)) expect(storySnapOn(-a, -a + h, header, vh)).toBe(true);
    // Above or below the story: off.
    expect(storySnapOn(300, 300 + h, header, vh)).toBe(false);
    expect(storySnapOn(-h, 0, header, vh)).toBe(false);
  });
});
