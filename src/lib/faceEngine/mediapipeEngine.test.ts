import { describe, it, expect } from 'vitest';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { sampleFromResult } from './mediapipeEngine';

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
