import { beforeEach, describe, expect, it, vi } from 'vitest';

/* handRig is module-global state: each test re-imports a fresh copy with the
 * landmarker, the face side and the engine manager replaced by fakes. */
const h = vi.hoisted(() => ({
  legacy: true,
  claims: [] as string[],
  grant: true,
  calls: [] as unknown[],
  result: 'hand' as 'hand' | 'none' | 'throw',
}));

const HAND = Array.from({ length: 21 }, (_, i) => ({ x: 0.4 + i * 0.005, y: 0.5 - i * 0.01, z: 0 }));
vi.mock('./handTracking', () => ({
  getHandLandmarker: () => ({
    detectForVideo: (input: unknown) => {
      h.calls.push(input);
      if (h.result === 'throw') throw new Error('boom');
      return h.result === 'hand'
        ? { landmarks: [HAND], worldLandmarks: [HAND], handednesses: [[{ categoryName: 'Left' }]] }
        : { landmarks: [], worldLandmarks: [], handednesses: [] };
    },
  }),
}));
vi.mock('./faceRig', () => ({ getLatestFaceKeypoints: () => null, lastFaceDetectMs: () => -Infinity }));
vi.mock('./faceEngine', () => ({
  isLegacyFaceSession: () => h.legacy,
  claimFrameInference: (owner: string) => {
    h.claims.push(owner);
    return h.grant;
  },
}));
vi.mock('./faceEngine/mediapipeEngine', () => ({ detectInputSize: () => ({ w: 0, h: 0 }) }));

let now = 1000;
const video = (streamId: string, t: number) =>
  ({ readyState: 4, currentTime: t, videoWidth: 540, videoHeight: 960, srcObject: { id: streamId } }) as unknown as HTMLVideoElement;

type Rig = typeof import('./handRig');
let rig: Rig;
beforeEach(async () => {
  Object.assign(h, { legacy: true, claims: [], grant: true, calls: [], result: 'hand' });
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.resetModules();
  rig = await import('./handRig');
});

describe('handRig.detectHandsNow', () => {
  it('legacy: never touches the frame token and feeds the raw <video>', () => {
    const v = video('a', 1);
    rig.detectHandsNow(v);
    expect(h.claims).toEqual([]);
    expect(h.calls).toEqual([v]);
  });

  it('platform: one blocking inference per frame — a denied token skips without consuming the gate', () => {
    h.legacy = false;
    h.grant = false;
    const v = video('a', 1);
    rig.detectHandsNow(v);
    expect(h.claims).toEqual(['hand']);
    expect(h.calls).toEqual([]);
    // Next frame the token is free: it runs at once (the gate was not marked).
    h.grant = true;
    now += 16;
    rig.detectHandsNow(video('a', 1.016));
    expect(h.calls).toHaveLength(1);
    expect(rig.getLatestHandFrame()).not.toBeNull();
  });

  it('a camera STREAM change forgets the previous camera\'s hand (next to resetFaceRig)', () => {
    rig.detectHandsNow(video('front', 1));
    expect(rig.getLatestHandFrame()?.hands).toHaveLength(1);
    // Flip cameras; the first inference on the new stream fails, so only the
    // reset can explain an empty stash.
    h.result = 'throw';
    now += 100;
    rig.detectHandsNow(video('back', 2));
    expect(rig.getLatestHandFrame()).toBeNull();
    expect(rig.getSharedHandPose()).toBeNull();
  });

  it('the same stream never resets the stash', () => {
    rig.detectHandsNow(video('front', 1));
    h.result = 'throw';
    now += 100;
    rig.detectHandsNow(video('front', 2));
    expect(rig.getLatestHandFrame()?.hands).toHaveLength(1);
  });
});

describe('handRig.handDetectInterval', () => {
  it('keeps the 66ms cadence while a hand is tracked, on both surfaces', () => {
    expect(rig.handDetectInterval(0, true)).toBe(66);
    expect(rig.handDetectInterval(0, false)).toBe(66);
  });

  it('platform: drops to the slow palm search after 4 misses', () => {
    expect(rig.handDetectInterval(3, true)).toBe(66);
    expect(rig.handDetectInterval(4, true)).toBe(rig.PLATFORM_IDLE_DETECT_INTERVAL_MS);
    expect(rig.PLATFORM_IDLE_DETECT_INTERVAL_MS).toBe(400);
  });

  it('legacy: unchanged 150ms after 8 misses', () => {
    expect(rig.handDetectInterval(7, false)).toBe(66);
    expect(rig.handDetectInterval(8, false)).toBe(150);
  });
});
