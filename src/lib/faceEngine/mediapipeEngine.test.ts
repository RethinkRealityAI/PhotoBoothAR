import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  createMediapipeEngine,
  detectInputSize,
  sampleFromResult,
  DETECT_THROWS_BEFORE_RESET,
} from './mediapipeEngine';
import { FRAME_INFERENCE_TOKEN } from './inferenceToken';

const fl = vi.hoisted(() => ({
  inputs: [] as unknown[],
  throwNext: 0,
  resets: 0,
  alive: true,
}));
vi.mock('../faceTracking', () => ({
  getFaceLandmarker: () => (fl.alive
    ? {
      detectForVideo: (input: unknown) => {
        fl.inputs.push(input);
        if (fl.throwNext > 0) { fl.throwNext--; throw new Error('context lost'); }
        return { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] };
      },
    }
    : null),
  initializeFaceLandmarker: async () => {},
  resetFaceLandmarker: () => { fl.resets++; fl.alive = false; },
}));

const lm = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i / 1000, y: (n - i) / 1000, z: 0, visibility: 0 }));
const result = (over: Partial<FaceLandmarkerResult>): FaceLandmarkerResult =>
  ({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [], ...over }) as FaceLandmarkerResult;

describe('sampleFromResult (the shapes faceRig used to stash inline)', () => {
  it('a face: matrix data, every named category, the six keypoints', () => {
    const data = Array.from({ length: 16 }, (_, i) => i);
    const s = sampleFromResult(
      result({
        faceLandmarks: [lm(478)],
        faceBlendshapes: [{ categories: [
          { categoryName: 'mouthSmileLeft', score: 0.7, index: 0, displayName: '' },
          { categoryName: '', score: 0.9, index: 1, displayName: '' },
        ], headIndex: 0, headName: '' }],
        facialTransformationMatrixes: [{ rows: 4, columns: 4, data }],
      }),
      123,
    );
    expect(s.t).toBe(123);
    expect(s.matrix).toBe(data);
    expect(s.blendshapes).toEqual({ mouthSmileLeft: 0.7 }); // unnamed categories skipped
    expect(s.keypoints).toEqual({
      forehead: { x: 0.01, y: 0.468 },
      chin: { x: 0.152, y: 0.326 },
      leftEar: { x: (0.127 + 0.234) / 2, y: (0.351 + 0.244) / 2 },
      rightEar: { x: (0.356 + 0.454) / 2, y: (0.122 + 0.024) / 2 },
    });
  });
  it('no face: matrix null, blendshapes {} (clears the stash), keypoints null', () => {
    expect(sampleFromResult(result({}), 5)).toEqual({ t: 5, matrix: null, blendshapes: {}, keypoints: null });
    expect(sampleFromResult(undefined, 6)).toEqual({ t: 6, matrix: null, blendshapes: {}, keypoints: null });
  });
  it('too few landmarks → no keypoints (the old < 455 guard)', () => {
    expect(sampleFromResult(result({ faceLandmarks: [lm(454)] }), 1).keypoints).toBeNull();
  });
});

/* ── Detection input, snapshot, token, loss (fake DOM: canvases record their draws) ── */
interface FakeCanvas { tag: string; width: number; height: number; draws: { src: unknown; w: number; h: number }[]; getContext: () => unknown }
let made: FakeCanvas[] = [];
let frame = 1;
function fakeCanvas(): FakeCanvas {
  const c: FakeCanvas = {
    tag: `canvas${made.length}`, width: 300, height: 150, draws: [],
    getContext: () => ({ drawImage: (src: unknown, _x: number, _y: number, w: number, h: number) => { c.draws.push({ src, w, h }); } }),
  };
  made.push(c);
  return c;
}
const vid = (w = 1080, h = 1920) => {
  let t = 0;
  return { videoWidth: w, videoHeight: h, get currentTime() { return (t += 0.04); } } as unknown as HTMLVideoElement;
};

beforeEach(() => {
  made = [];
  frame = 1;
  Object.assign(fl, { inputs: [], throwNext: 0, resets: 0, alive: true });
  FRAME_INFERENCE_TOKEN.frame = Number.NaN;
  (globalThis as { document?: unknown }).document = {
    createElement: () => fakeCanvas(),
    timeline: { get currentTime() { return frame; } },
  };
});
afterEach(() => { delete (globalThis as { document?: unknown }).document; });

describe('detectInputSize', () => {
  it('keeps the aspect with the short side at 360, both orientations', () => {
    expect(detectInputSize(1080, 1920)).toEqual({ w: 360, h: 640 });
    expect(detectInputSize(1920, 1080)).toEqual({ w: 640, h: 360 });
    expect(detectInputSize(720, 1280)).toEqual({ w: 360, h: 640 });
  });
  it('never upscales, and rejects an empty frame', () => {
    expect(detectInputSize(320, 240)).toEqual({ w: 320, h: 240 });
    expect(detectInputSize(0, 1080)).toEqual({ w: 0, h: 0 });
    expect(detectInputSize(Number.NaN, 1080)).toEqual({ w: 0, h: 0 });
  });
});

describe('mediapipe engine detection path', () => {
  it('legacy (default) path: the landmarker reads the <video> element itself — no canvas, no token', () => {
    const e = createMediapipeEngine();
    const v = vid();
    expect(e.poll(v, 100)).not.toBeNull();
    expect(fl.inputs).toEqual([v]);
    expect(made).toHaveLength(0);
    expect(e.getAnalysedFrame()).toBeNull();
    expect(e.getDetectionCanvas()).toBeNull();
    expect(Number.isNaN(FRAME_INFERENCE_TOKEN.frame)).toBe(true);
  });

  it('platform path: detects on a reused 360x640 downscale of the frame', () => {
    const e = createMediapipeEngine();
    e.setPlatformPath(true);
    const v = vid();
    e.poll(v, 100);
    frame++;
    e.poll(v, 200);
    expect(made).toHaveLength(1); // ONE reused detection canvas
    const small = made[0];
    expect(fl.inputs).toEqual([small, small]);
    expect([small.width, small.height]).toEqual([360, 640]);
    expect(small.draws.map((d) => d.src)).toEqual([v, v]);
    expect(e.getDetectionCanvas()).toBe(small);
    expect(e.getAnalysedFrame()).toBeNull(); // no snapshot unless a surface frame-locks
  });

  it('frame snapshot: full-res copy first, the detector reads a downscale OF THAT COPY', () => {
    const e = createMediapipeEngine();
    e.setPlatformPath(true);
    e.setFrameSnapshot(true);
    const v = vid();
    e.poll(v, 100);
    const [snap, small] = made;
    expect([snap.width, snap.height]).toEqual([1080, 1920]);
    expect(snap.draws.map((d) => d.src)).toEqual([v]);
    expect(small.draws.map((d) => d.src)).toEqual([snap]); // provably the same frame
    expect(fl.inputs).toEqual([small]);
    expect(e.getAnalysedFrame()).toBe(snap);
    // A failed inference invalidates it: the frame no longer belongs to a pose.
    fl.throwNext = 1;
    frame++;
    e.poll(v, 200);
    expect(e.getAnalysedFrame()).toBeNull();
    e.setFrameSnapshot(false);
    expect([snap.width, snap.height]).toEqual([0, 0]); // buffer released
  });

  it('one blocking inference per frame on the platform path (hybrid pose + blendshapes)', () => {
    const e = createMediapipeEngine();
    e.setPlatformPath(true);
    const v = vid();
    expect(e.poll(v, 100)).not.toBeNull();
    expect(e.pollBlendshapes(v, 100)).toBeNull(); // same frame: token taken
    frame++;
    expect(e.pollBlendshapes(v, 117)).not.toBeNull(); // gate was not burned by the refusal
    expect(fl.inputs).toHaveLength(2);
  });

  it(`${DETECT_THROWS_BEFORE_RESET} consecutive throws close the landmarker and report once (platform)`, () => {
    const lost: string[] = [];
    const e = createMediapipeEngine({ onLost: (r) => lost.push(r) });
    e.setPlatformPath(true);
    const v = vid();
    fl.throwNext = DETECT_THROWS_BEFORE_RESET - 1;
    for (let i = 0; i < DETECT_THROWS_BEFORE_RESET - 1; i++) { frame++; e.poll(v, 100 + i * 40); }
    frame++;
    e.poll(v, 1000); // a success resets the count
    fl.throwNext = DETECT_THROWS_BEFORE_RESET;
    for (let i = 0; i < DETECT_THROWS_BEFORE_RESET; i++) { frame++; e.poll(v, 2000 + i * 40); }
    expect(fl.resets).toBe(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]).toContain('context lost');
    expect(e.poll(v, 5000)).toBeNull(); // landmarker gone until the manager re-inits
  });

  it('the legacy path keeps its silent catch (shipped behaviour)', () => {
    const lost: string[] = [];
    const e = createMediapipeEngine({ onLost: (r) => lost.push(r) });
    fl.throwNext = DETECT_THROWS_BEFORE_RESET * 2;
    const v = vid();
    for (let i = 0; i < DETECT_THROWS_BEFORE_RESET * 2; i++) e.poll(v, 100 + i * 40);
    expect(fl.resets).toBe(0);
    expect(lost).toHaveLength(0);
  });
});
