import { describe, expect, it } from 'vitest';
import { BOX, boxGeometry, floorAt, type BoxInput } from './beamyBox';

const base: BoxInput = { home: { x: 800, y: 700 }, heightPx: 300, room: null, par: { x: 0, y: 0 }, phone: false };

describe('beamyBox', () => {
  it('centres the box on Beamy with his feet between the back and front floor edges', () => {
    const b = boxGeometry(base);
    expect(b).not.toBeNull();
    if (b === null) return;
    expect((b.front[0].x + b.front[1].x) / 2).toBeCloseTo(800, 6);
    expect(b.front[3].y).toBeGreaterThan(base.home.y); // front edge in front of (below) his feet
    expect(b.back[3].y).toBeLessThan(base.home.y); // back edge behind (above) them
  });

  it('draws the back face as the front face scaled toward the vanishing point', () => {
    const b = boxGeometry(base);
    if (b === null) throw new Error('no box');
    const fw = b.front[1].x - b.front[0].x;
    const bw = b.back[1].x - b.back[0].x;
    expect(bw / fw).toBeCloseTo(BOX.k, 6);
    // Every back corner lies strictly inside the front face.
    for (const p of b.back) {
      expect(p.x).toBeGreaterThan(b.front[0].x);
      expect(p.x).toBeLessThan(b.front[1].x);
      expect(p.y).toBeGreaterThan(b.front[0].y);
      expect(p.y).toBeLessThan(b.front[3].y);
    }
  });

  it('turns with the pointer: pointer right slides the back face left (and vice versa)', () => {
    const mid = boxGeometry(base);
    const right = boxGeometry({ ...base, par: { x: 1, y: 0 } });
    const left = boxGeometry({ ...base, par: { x: -1, y: 0 } });
    if (mid === null || right === null || left === null) throw new Error('no box');
    expect(right.back[0].x).toBeLessThan(mid.back[0].x);
    expect(left.back[0].x).toBeGreaterThan(mid.back[0].x);
    // The front face (the room itself) never moves with the pointer.
    expect(right.front).toEqual(mid.front);
  });

  it('stays inside the room it is given, symmetric about Beamy', () => {
    const room = { left: 640, top: 450, right: 960, bottom: 720 };
    const b = boxGeometry({ ...base, room });
    if (b === null) throw new Error('no box');
    expect(b.front[0].x).toBeGreaterThanOrEqual(room.left);
    expect(b.front[1].x).toBeLessThanOrEqual(room.right);
    expect(b.front[0].y).toBeGreaterThanOrEqual(room.top);
    expect(b.front[3].y).toBeLessThanOrEqual(room.bottom);
    expect(800 - b.front[0].x).toBeCloseTo(b.front[1].x - 800, 6);
  });

  it('draws no box when there is no room for one, or no Beamy', () => {
    expect(boxGeometry({ ...base, room: { left: 760, top: 0, right: 2000, bottom: 2000 } })).toBeNull();
    expect(boxGeometry({ ...base, heightPx: 0 })).toBeNull();
    expect(boxGeometry({ ...base, heightPx: Number.NaN })).toBeNull();
  });

  it('is shallower on phones', () => {
    const d = boxGeometry(base);
    const p = boxGeometry({ ...base, phone: true });
    if (d === null || p === null) throw new Error('no box');
    expect(p.k).toBeGreaterThan(d.k);
  });

  it('maps floor coordinates with perspective scale', () => {
    const b = boxGeometry(base);
    if (b === null) throw new Error('no box');
    expect(floorAt(b, -1, 0).p).toEqual(b.back[3]);
    expect(floorAt(b, 1, 1).p).toEqual(b.front[2]);
    expect(floorAt(b, 0, 0).scale).toBeCloseTo(b.k, 6);
    expect(floorAt(b, 0, 1).scale).toBeCloseTo(1, 6);
  });
});
