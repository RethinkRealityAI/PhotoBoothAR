import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { OrientationHistory, orientationToQuaternion, stageVerticalFov } from './orientation';
import {
  CAMERA_HEIGHT_M, DEFAULT_PLACE_M, MAX_SCALE, NEAR_PLACE_M, placementSpot, MIN_SCALE, createGesture, floorHit, gestureDown, gestureMove, gestureUp, standeeSize, yawToFace,
} from './placement';
import type { Experience } from '../../types';
import { WORLD_LOOK_PREFIX, frameArtUrl, isWorldLook, withWorldLooks, worldLookFrameUrl } from './worldLooks';
import { MIN_PATCH_STD, goodMatch, grabPatch, matchPatch, median, toGray } from './patchTrack';
import { arFrameIdFrom, createSettleGate, enterArUrl, isSettled, leaveArUrl, settleRestart, settleStep, worldTrackerFrom } from './arSession';
import { isPhoneUa } from './xr8World';
import { buildStandeeWalls, contourSegments, gridFromImageData, type StandeeGrid } from './standeeMesh';

const forwardOf = (q: Quaternion) => new Vector3(0, 0, -1).applyQuaternion(q);

describe('orientationToQuaternion', () => {
  it('phone upright (beta 90) looks at the horizon', () => {
    const f = forwardOf(orientationToQuaternion(0, 90, 0, 0));
    expect(f.y).toBeCloseTo(0, 5);
    expect(f.z).toBeCloseTo(-1, 5);
  });
  it('phone flat on its back (beta 0) looks straight down', () => {
    const f = forwardOf(orientationToQuaternion(0, 0, 0, 0));
    expect(f.y).toBeCloseTo(-1, 5);
  });
  it('tilting the top away (beta 60) looks 30° below the horizon', () => {
    const f = forwardOf(orientationToQuaternion(0, 60, 0, 0));
    expect(Math.asin(-f.y) * 180 / Math.PI).toBeCloseTo(30, 4);
  });
  it('alpha turns the view about the vertical (counter-clockwise from above)', () => {
    const f = forwardOf(orientationToQuaternion(90, 90, 0, 0));
    expect(f.x).toBeCloseTo(-1, 5);
    expect(f.y).toBeCloseTo(0, 5);
  });
  it('keeps the camera up vector pointing up when upright in portrait', () => {
    const up = new Vector3(0, 1, 0).applyQuaternion(orientationToQuaternion(0, 90, 0, 0));
    expect(up.y).toBeCloseTo(1, 5);
  });
});

describe('OrientationHistory', () => {
  const qa = new Quaternion();
  const qb = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  it('returns null when empty and clamps to the ends', () => {
    const h = new OrientationHistory();
    expect(h.at(5)).toBeNull();
    h.push(100, qa); h.push(200, qb);
    expect(h.at(0)!.angleTo(qa)).toBeCloseTo(0, 6);
    expect(h.at(999)!.angleTo(qb)).toBeCloseTo(0, 6);
  });
  it('slerps between neighbours', () => {
    const h = new OrientationHistory();
    h.push(100, qa); h.push(200, qb);
    expect(h.at(150)!.angleTo(qa)).toBeCloseTo(Math.PI / 4, 5);
  });
  it('drops samples older than its window but keeps two', () => {
    const h = new OrientationHistory(100);
    for (let t = 0; t <= 1000; t += 10) h.push(t, qa);
    expect(h.size).toBeLessThanOrEqual(12);
    expect(h.size).toBeGreaterThanOrEqual(2);
  });
  it('starts over if the clock goes backwards', () => {
    const h = new OrientationHistory();
    h.push(500, qb); h.push(100, qa);
    expect(h.size).toBe(1);
  });
});

describe('stageVerticalFov', () => {
  it('no crop: a 9:16 picture in a 9:16 stage keeps the long-side view', () => {
    expect(stageVerticalFov(64, 1080, 1920, 720, 1280)).toBeCloseTo(64, 6);
  });
  it('a 3:4 picture cover-fit into 9:16 keeps its full height', () => {
    expect(stageVerticalFov(64, 1080, 1440, 720, 1280)).toBeCloseTo(64, 6);
  });
  it('a 9:16 picture in a wider stage loses height', () => {
    expect(stageVerticalFov(64, 1080, 1920, 1080, 1440)).toBeLessThan(64);
  });
  it('bad sizes fall back to the given view', () => {
    expect(stageVerticalFov(64, 0, 0, 720, 1280)).toBe(64);
  });
});

describe('floorHit', () => {
  const eye = { x: 0, y: CAMERA_HEIGHT_M, z: 0 };
  it('a 45° downward look lands one camera-height away', () => {
    const p = floorHit(eye, { x: 0, y: -1, z: -1 })!;
    expect(p.y).toBe(0);
    expect(p.z).toBeCloseTo(-CAMERA_HEIGHT_M, 6);
  });
  it('rejects rays at or above the horizon', () => {
    expect(floorHit(eye, { x: 0, y: 0, z: -1 })).toBeNull();
    expect(floorHit(eye, { x: 0, y: 0.2, z: -1 })).toBeNull();
  });
  it('rejects hits that are too close or too far', () => {
    expect(floorHit(eye, { x: 0, y: -1, z: 0 })).toBeNull(); // straight down: at your feet
    expect(floorHit(eye, { x: 0, y: -0.01, z: -1 })).toBeNull();
  });
});

describe('placementSpot', () => {
  const eye = { x: 0, y: CAMERA_HEIGHT_M, z: 0 };
  it('uses the floor hit when it is comfortable', () => {
    expect(placementSpot(eye, { x: 0, y: -1, z: -1 })!.z).toBeCloseTo(-CAMERA_HEIGHT_M, 6);
  });
  it('aiming at the horizon or far away falls back to the default stand-off ahead', () => {
    expect(placementSpot(eye, { x: 1, y: 0, z: 0 })).toEqual({ x: DEFAULT_PLACE_M, y: 0, z: 0 });
    expect(placementSpot(eye, { x: 0, y: -0.05, z: -1 })!.z).toBeCloseTo(-DEFAULT_PLACE_M, 6);
  });
  // Changed Nov 24 2026 at Dapo's request: pointing down must always show the
  // frame (it used to give no spot at your feet).
  it('aiming at your feet still gives a spot, just in front of you', () => {
    const p = placementSpot(eye, { x: 0, y: -1, z: -0.1 })!;
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(-NEAR_PLACE_M, 6);
  });
  it('straight down uses the top edge of the phone as ahead', () => {
    const p = placementSpot(eye, { x: 0, y: -1, z: 0 }, { x: 0.6, y: 0, z: -0.8 })!;
    expect(p.x).toBeCloseTo(0.6 * NEAR_PLACE_M, 6);
    expect(p.z).toBeCloseTo(-0.8 * NEAR_PLACE_M, 6);
    expect(p.y).toBe(0);
  });
  it('straight down with no heading, or straight up, gives no spot', () => {
    expect(placementSpot(eye, { x: 0, y: -1, z: 0 })).toBeNull();
    expect(placementSpot(eye, { x: 0, y: 1, z: 0 })).toBeNull();
  });
  it('a close but not-too-close hit is used as is', () => {
    expect(placementSpot(eye, { x: 0, y: -1, z: -0.5 })!.z).toBeCloseTo(-0.7, 6);
  });
});

describe('placement helpers', () => {
  it('yawToFace turns the frame toward the camera', () => {
    expect(yawToFace({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -3 })).toBeCloseTo(0, 6);
    expect(yawToFace({ x: 0, y: 1, z: 0 }, { x: 3, y: 0, z: 0 })).toBeCloseTo(-Math.PI / 2, 6);
  });
  it('standeeSize keeps the art aspect at 2 m tall', () => {
    expect(standeeSize(1080, 1920)).toEqual({ w: 1.125, h: 2 });
  });
});

describe('gestures', () => {
  it('a quick still lift is a tap; a drag is not and turns the frame', () => {
    const g = createGesture();
    gestureDown(g, 1, { x: 100, y: 100 }, 0);
    expect(gestureUp(g, 1, 100)).toBe(true);
    gestureDown(g, 1, { x: 100, y: 100 }, 200);
    gestureMove(g, 1, { x: 300, y: 100 }, 400);
    expect(g.yaw).toBeCloseTo(Math.PI, 5);
    expect(gestureUp(g, 1, 300)).toBe(false);
  });
  it('a slow lift is not a tap', () => {
    const g = createGesture();
    gestureDown(g, 1, { x: 0, y: 0 }, 0);
    expect(gestureUp(g, 1, 900)).toBe(false);
  });
  it('pinch scales within limits; twist turns', () => {
    const g = createGesture();
    gestureDown(g, 1, { x: 0, y: 0 }, 0);
    gestureDown(g, 2, { x: 100, y: 0 }, 0);
    gestureMove(g, 2, { x: 150, y: 0 }, 400);
    expect(g.scale).toBeCloseTo(1.5, 6);
    gestureMove(g, 2, { x: 1000, y: 0 }, 400);
    expect(g.scale).toBe(MAX_SCALE);
    gestureMove(g, 2, { x: 1, y: 0 }, 400);
    expect(g.scale).toBe(MIN_SCALE);
    gestureMove(g, 2, { x: 0, y: 100 }, 400); // a quarter turn clockwise on screen
    expect(g.yaw).toBeCloseTo(-Math.PI / 2, 5);
    // Lifting one finger of a pinch never counts as a tap.
    expect(gestureUp(g, 2, 450)).toBe(false);
    expect(gestureUp(g, 1, 460)).toBe(false);
  });
  it('ignores moves of fingers it never saw', () => {
    const g = createGesture();
    gestureMove(g, 9, { x: 5, y: 5 }, 400);
    expect(g.yaw).toBe(0);
    expect(gestureUp(g, 9, 0)).toBe(false);
  });
});

describe('standee walls', () => {
  const square = (n: number, from: number, to: number): StandeeGrid => {
    const data = new Uint8ClampedArray(n * n * 4);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 4;
      data[k] = 255; data[k + 1] = 0; data[k + 2] = 0;
      data[k + 3] = i >= from && i < to && j >= from && j < to ? 255 : 0;
    }
    return gridFromImageData(data, n, n);
  };
  it('a solid square gets a closed outline of its perimeter', () => {
    const g = square(10, 2, 8);
    const segs = contourSegments(g);
    let len = 0;
    for (let s = 0; s < segs.length; s += 4) len += Math.hypot(segs[s + 2] - segs[s], segs[s + 3] - segs[s + 1]);
    // 6×6 cells, contour half a cell outside the centres → 6 per side, corners cut diagonally.
    expect(len).toBeGreaterThan(20);
    expect(len).toBeLessThan(24.5);
  });
  it('max-pools blocks so a hairline survives downsampling', () => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    data[(3 * 8 + 5) * 4 + 3] = 255; // one opaque pixel
    const g = gridFromImageData(data, 8, 8, 4);
    expect(g.w).toBe(2);
    expect(Array.from(g.alpha)).toEqual([0, 1, 0, 0]); // row 3 → top row of cells, column 5 → right cell
  });
  it('an empty picture has no walls; a full picture is walled at its border', () => {
    expect(contourSegments(square(8, 0, 0)).length).toBe(0);
    expect(contourSegments(square(8, 0, 8)).length).toBeGreaterThan(0);
  });
  it('wall normals point away from the solid area and walls face their normal', () => {
    const g = square(10, 2, 8);
    const w = buildStandeeWalls(g, { width: 1, height: 1, depth: 0.04 });
    expect(w.segments).toBeGreaterThan(0);
    for (let t = 0; t < w.positions.length; t += 9) {
      const ax = w.positions[t], ay = w.positions[t + 1], az = w.positions[t + 2];
      const bx = w.positions[t + 3], by = w.positions[t + 4], bz = w.positions[t + 5];
      const cx = w.positions[t + 6], cy = w.positions[t + 7], cz = w.positions[t + 8];
      const e1 = [bx - ax, by - ay, bz - az], e2 = [cx - ax, cy - ay, cz - az];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nx = w.normals[t], ny = w.normals[t + 1];
      expect(fn[0] * nx + fn[1] * ny).toBeGreaterThan(0);
      // Outward: from the square's centre (0, 0.5) toward the wall.
      expect((ax - 0) * nx + (ay - 0.5) * ny).toBeGreaterThan(0);
    }
    // Edge colour is the art's red, shaded.
    expect(w.colors[0]).toBeGreaterThan(0.5);
    expect(w.colors[1]).toBe(0);
  });
});

describe('world looks', () => {
  const base = { created_at: '', updated_at: '', thumbnail_url: 't.webp', is_published: true, featured: false, sort_order: 0 };
  const border = { ...base, id: 'b1', name: 'Birthday Boss', kind: 'border', asset_url: '/f/boss.webp', config: {} } as Experience;
  const twin = { ...base, id: 'c1', name: 'Boss Mode', kind: 'composite', asset_url: null,
    config: { layers: [{ id: 'l', kind: 'border', asset_url: '/f/boss.webp' }, { id: 'p', kind: '3d_attachment', asset_url: '/m.glb' }] } } as Experience;
  const prop = { ...base, id: 'p1', name: 'Cap', kind: '3d_attachment', asset_url: '/cap.glb', config: {} } as Experience;
  const tint = { ...base, id: 'f1', name: 'Tint', kind: '2d_filter', asset_url: '/tint.png', config: {} } as Experience;

  it('adds one 3D tile per distinct Frame art, after the catalog', () => {
    const out = withWorldLooks([border, twin, prop, tint]);
    expect(out.slice(0, 4)).toEqual([border, twin, prop, tint]);
    expect(out).toHaveLength(5);
    const w = out[4];
    expect(w.id).toBe(`${WORLD_LOOK_PREFIX}b1`);
    expect(w.kind).toBe('3d_attachment');
    expect(w.asset_url).toBeNull();
    expect(w.name).toBe('Birthday Boss 3D');
    expect(w.thumbnail_url).toBe('t.webp');
    expect(worldLookFrameUrl(w)).toBe('/f/boss.webp');
  });
  it('names the tile after the plain border even when its composite twin comes first', () => {
    const out = withWorldLooks([twin, border]);
    expect(out).toHaveLength(3);
    expect(out[2].name).toBe('Birthday Boss 3D');
    expect(out[2].id).toBe(`${WORLD_LOOK_PREFIX}b1`);
  });
  it('a composite with a border layer counts; a hidden layer or a tint does not', () => {
    expect(frameArtUrl(twin)).toBe('/f/boss.webp');
    expect(frameArtUrl(tint)).toBeNull();
    const hidden = { ...twin, config: { layers: [{ id: 'l', kind: 'border', asset_url: '/x.webp', hidden: true }] } } as Experience;
    expect(frameArtUrl(hidden)).toBeNull();
  });
  it('ordinary looks are not world looks', () => {
    expect(isWorldLook(prop)).toBe(false);
    expect(isWorldLook(null)).toBe(false);
    expect(isWorldLook({ ...prop, id: 'world:fake' })).toBe(false); // no config.world
    expect(worldLookFrameUrl(border)).toBeNull();
  });
  it('a catalog without Frames is returned unchanged', () => {
    expect(withWorldLooks([prop])).toEqual([prop]);
  });
});

describe('patch tracking', () => {
  // Deterministic textured "floor": smooth noise so sub-pixel refinement has gradients to use.
  const W = 120, H = 120;
  const tex = (ox: number, oy: number) => {
    const g = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x - ox, v = y - oy;
      g[y * W + x] = 128 + 50 * Math.sin(u * 0.37 + Math.cos(v * 0.21) * 2) + 40 * Math.cos(v * 0.29 + Math.sin(u * 0.17) * 3);
    }
    return g;
  };
  it('toGray weights RGB like luma', () => {
    const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    expect(g[0]).toBeCloseTo(76.245, 2);
    expect(g[1]).toBeCloseTo(149.685, 2);
  });
  it('finds where a patch moved, to sub-pixel accuracy', () => {
    const a = tex(0, 0);
    const p = grabPatch(a, W, H, 60, 60, 16)!;
    expect(p.std).toBeGreaterThan(MIN_PATCH_STD);
    const b = tex(5.4, -3.6); // the picture moved right 5.4 px and up 3.6 px
    const m = matchPatch(b, W, H, p, 60, 60, 10)!;
    expect(goodMatch(m)).toBe(true);
    expect(m.x).toBeCloseTo(65.4, 0);
    expect(m.y).toBeCloseTo(56.4, 0);
    expect(Math.abs(m.x - 65.4)).toBeLessThan(0.35);
  });
  it('a blank floor has no texture to lock onto', () => {
    const flat = new Float32Array(W * H).fill(90);
    expect(grabPatch(flat, W, H, 60, 60, 16)!.std).toBe(0);
  });
  it('ignores patches that do not fit', () => {
    expect(grabPatch(tex(0, 0), W, H, 3, 60, 16)).toBeNull();
    const p = grabPatch(tex(0, 0), W, H, 60, 60, 16)!;
    expect(matchPatch(tex(0, 0), W, H, p, -50, 60, 5)).toBeNull();
  });
  it('a stripe pattern is ambiguous along the stripes and is not trusted', () => {
    const s = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s[y * W + x] = x % 8 < 4 ? 40 : 200;
    const p = grabPatch(s, W, H, 60, 60, 16)!;
    expect(goodMatch(matchPatch(s, W, H, p, 60, 60, 10))).toBe(false);
  });
  it('median ignores one outlier', () => {
    expect(median([1, 1.2, 40])).toBe(1.2);
    expect(median([])).toBe(0);
  });
});

describe('world mode page (arSession)', () => {
  it('reads ?ar= and rejects odd ids', () => {
    expect(arFrameIdFrom('?ar=abc-123')).toBe('abc-123');
    expect(arFrameIdFrom('?x=1')).toBeNull();
    expect(arFrameIdFrom('?ar=../../x')).toBeNull();
  });
  it('builds enter/leave URLs and keeps tester params', () => {
    expect(enterArUrl('/e/party', '?faceEngine=xr8&cam=1', 'f1')).toBe('/e/party/booth?faceEngine=xr8&ar=f1');
    expect(leaveArUrl('/e/party', '?faceEngine=xr8&ar=f1', 'look9')).toBe('/e/party/experience/look9?faceEngine=xr8&cam=1');
    expect(leaveArUrl('/e/party', '?ar=f1', null)).toBe('/e/party/booth?cam=1');
  });
  it('picks the tracker: URL override, then build default (xr8 unless "sensors")', () => {
    expect(worldTrackerFrom('?wtrack=sensors', undefined)).toBe('sensors');
    expect(worldTrackerFrom('', 'sensors')).toBe('sensors');
    expect(worldTrackerFrom('', undefined)).toBe('xr8');
    expect(worldTrackerFrom('?wtrack=xr8', 'sensors')).toBe('xr8');
  });
  it('phones by user agent, never by touch', () => {
    expect(isPhoneUa('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', 'iPhone', 5)).toBe(true);
    expect(isPhoneUa('Mozilla/5.0 (Macintosh)', 'MacIntel', 5)).toBe(true); // iPadOS
    expect(isPhoneUa('Mozilla/5.0 (Windows NT 10.0)', 'Win32', 10)).toBe(false); // touchscreen laptop
  });
});

describe('settle gate', () => {
  const run = (steps: Array<[number, boolean, number]>) => {
    let g = settleRestart(createSettleGate(), 0);
    for (const [t, normal, gap] of steps) g = settleStep(g, t, normal, gap);
    return isSettled(g);
  };
  it('never settles before the run starts', () => {
    let g = createSettleGate();
    g = settleStep(g, 5000, true, 16);
    expect(isSettled(g)).toBe(false);
  });
  it('needs NORMAL for 1.2 s and 1.5 s since start', () => {
    expect(run([[0, true, 16], [1100, true, 16]])).toBe(false);
    expect(run([[0, true, 16], [1300, true, 16]])).toBe(false); // < 1.5 s run
    expect(run([[0, true, 16], [1600, true, 16]])).toBe(true);
  });
  it('LIMITED resets the NORMAL clock', () => {
    expect(run([[0, true, 16], [1000, false, 16], [1600, true, 16], [2000, true, 16]])).toBe(false);
    expect(run([[0, true, 16], [1000, false, 16], [1600, true, 16], [2900, true, 16]])).toBe(true);
  });
  it('a stall in the last second blocks it', () => {
    expect(run([[0, true, 16], [1200, true, 400], [1700, true, 16]])).toBe(false);
    expect(run([[0, true, 16], [1200, true, 400], [2300, true, 16]])).toBe(true);
  });
  it('latches: a later stall or LIMITED never unsettles', () => {
    let g = settleRestart(createSettleGate(), 0);
    g = settleStep(g, 0, true, 16);
    g = settleStep(g, 1600, true, 16);
    g = settleStep(g, 1700, false, 900);
    expect(isSettled(g)).toBe(true);
    expect(isSettled(settleRestart(g, 2000))).toBe(false);
  });
});
