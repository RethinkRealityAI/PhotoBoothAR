import { describe, expect, it } from 'vitest';
import {
  DT_MAX, SIGMA, STOPS, blendSlots, damp, dampAngle, followStep, pageProgress, pinProgress, poseInSlot,
  slotWeight, stopIndex, storyHeightVh, storyStep, weightedNight, type SlotSample,
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
    expect(STOPS.map((s) => s.id)).toEqual(['hero', 'story', 'films', 'pick', 'try', 'pricing', 'start']);
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
