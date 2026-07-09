import { describe, it, expect } from 'vitest';
import { pointToTransform2D, projectAnchorsToScreen, nearestAnchor, classifyAsset, type AnchorPoint } from './dnd';

const RECT = { left: 100, top: 50, width: 200, height: 400 };
const BASE = { scale: 1, x: 0, y: 0, rotation: 0 };

describe('pointToTransform2D — matches StageCanvas centre-% semantics', () => {
  it('centre of the stage → x/y 0', () => {
    const t = pointToTransform2D(200, 250, RECT, BASE);
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
  });
  it('corners → ±50%', () => {
    expect(pointToTransform2D(100, 50, RECT, BASE)).toMatchObject({ x: -50, y: -50 });
    expect(pointToTransform2D(300, 450, RECT, BASE)).toMatchObject({ x: 50, y: 50 });
  });
  it('far outside is clamped to ±100 (booth transform bounds)', () => {
    expect(pointToTransform2D(10_000, -10_000, RECT, BASE)).toMatchObject({ x: 100, y: -100 });
  });
  it('keeps scale/rotation from the base transform', () => {
    const t = pointToTransform2D(200, 250, RECT, { scale: 2, x: 9, y: 9, rotation: 45 });
    expect(t.scale).toBe(2);
    expect(t.rotation).toBe(45);
  });
  it('degenerate rect returns the base unchanged', () => {
    expect(pointToTransform2D(1, 1, { ...RECT, width: 0 }, BASE)).toEqual(BASE);
  });
});

/** Column-major identity with a translation — THREE.Matrix4.elements layout. */
const translation = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

const ANCHORS: AnchorPoint[] = [
  { id: 'crown', offset: [0, 8.3, 4.0] },
  { id: 'noseTip', offset: [0, -0.5, 7.6] },
  { id: 'leftEar', offset: [7.7, 1.5, -1.5] },
];

const VIEW = { width: 800, height: 600 };
const FOV = 63;

describe('projectAnchorsToScreen', () => {
  it('a centred head 40cm from the camera projects the nose to the viewport centre', () => {
    const pts = projectAnchorsToScreen([{ id: 'noseTip', offset: [0, 0, 0] }], translation(0, 0, -40), VIEW, FOV);
    expect(pts[0].x).toBeCloseTo(400);
    expect(pts[0].y).toBeCloseTo(300);
    expect(pts[0].inFront).toBe(true);
  });
  it('up in head space is up on screen (crown above nose), left ear to the right of centre when x>0', () => {
    const [crown, nose, ear] = projectAnchorsToScreen(ANCHORS, translation(0, 0, -40), VIEW, FOV);
    expect(crown.y).toBeLessThan(nose.y);
    expect(ear.x).toBeGreaterThan(400);
  });
  it('a point behind the camera is flagged not-in-front', () => {
    const pts = projectAnchorsToScreen([{ id: 'crown', offset: [0, 0, 0] }], translation(0, 0, 10), VIEW, FOV);
    expect(pts[0].inFront).toBe(false);
  });
  it('projection respects a rotated matrix (90° yaw sends +z offsets sideways)', () => {
    // column-major 90° rotation about Y: +z(head) → +x(world), then translate back
    const rotY90 = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -40, 1];
    const pts = projectAnchorsToScreen([{ id: 'noseTip', offset: [0, 0, 7.6] }], rotY90, VIEW, FOV);
    expect(pts[0].x).toBeGreaterThan(400); // nose swung to screen right
    expect(pts[0].y).toBeCloseTo(300, 0);
  });
});

describe('nearestAnchor', () => {
  const pts = projectAnchorsToScreen(ANCHORS, translation(0, 0, -40), VIEW, FOV);
  it('snaps to the closest anchor inside the radius', () => {
    const crown = pts.find((p) => p.id === 'crown')!;
    expect(nearestAnchor(pts, crown.x + 5, crown.y - 4, 40)).toBe('crown');
  });
  it('returns null when nothing is within the radius', () => {
    expect(nearestAnchor(pts, 0, 0, 10)).toBeNull();
  });
  it('ignores behind-camera anchors', () => {
    const behind = projectAnchorsToScreen(ANCHORS, translation(0, 0, 40), VIEW, FOV);
    expect(nearestAnchor(behind, 400, 300, 10_000)).toBeNull();
  });
});

describe('classifyAsset', () => {
  it('models by extension or mimetype', () => {
    expect(classifyAsset('crown.glb')).toBe('model');
    expect(classifyAsset('crown.GLTF')).toBe('model');
    expect(classifyAsset('x', 'model/gltf-binary')).toBe('model');
  });
  it('images by extension or mimetype', () => {
    expect(classifyAsset('frame.png')).toBe('image');
    expect(classifyAsset('pic.jpeg?v=2')).toBe('image');
    expect(classifyAsset('x', 'image/webp')).toBe('image');
  });
  it('unknown otherwise', () => {
    expect(classifyAsset('notes.txt')).toBe('unknown');
    expect(classifyAsset('archive')).toBe('unknown');
  });
});
