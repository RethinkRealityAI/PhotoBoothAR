import { describe, it, expect } from 'vitest';
import {
  createEarState, observeEars, estimateEars, resetEarState,
  EAR_LOBE_DEFAULT, CANAL_TO_LOBE, EDGE_TO_LOBE_X, EAR_FORGET_AFTER_MS,
  type EarSideObservation,
} from './earPoints';

const none: EarSideObservation = { lobe: null, canal: null, edge: null };

describe('earPoints', () => {
  it('with nothing observed (MediaPipe / studio) both ears are the measured default, mirrored', () => {
    for (const s of [null, createEarState()]) {
      const e = estimateEars(s);
      expect(e.left).toEqual([EAR_LOBE_DEFAULT[0], EAR_LOBE_DEFAULT[1], EAR_LOBE_DEFAULT[2]]);
      expect(e.right).toEqual([-EAR_LOBE_DEFAULT[0], EAR_LOBE_DEFAULT[1], EAR_LOBE_DEFAULT[2]]);
      expect(e.leftSource).toBe('default');
      expect(e.rightSource).toBe('default');
    }
  });

  it('a tracked lobe wins, and repeated sightings average out the noise', () => {
    const s = createEarState();
    for (let i = 0; i < 20; i++) {
      const n = i % 2 === 0 ? 0.2 : -0.2;
      observeEars(s, 1000 + i * 50, { lobe: [8.6 + n, -2.0 + n, -4.1], canal: null, edge: null }, none);
    }
    const e = estimateEars(s);
    expect(e.leftSource).toBe('lobe');
    expect(e.left[0]).toBeCloseTo(8.6, 5);
    expect(e.left[1]).toBeCloseTo(-2.0, 5);
  });

  it('an ear that was seen stays known after it is hidden (rigid in head space)', () => {
    const s = createEarState();
    observeEars(s, 1000, { lobe: [8.5, -2.1, -4.0], canal: null, edge: null }, none);
    for (let i = 1; i < 10; i++) observeEars(s, 1000 + i * 50, none, none);
    expect(estimateEars(s).left).toEqual([8.5, -2.1, -4.0]);
  });

  it('only the canal found: the lobe is the canal plus the measured step, toward the head on each side', () => {
    const s = createEarState();
    observeEars(s, 1000, { lobe: null, canal: [9.0, 0, -3.9], edge: null }, { lobe: null, canal: [-9.0, 0, -3.9], edge: null });
    const e = estimateEars(s);
    expect(e.leftSource).toBe('canal');
    expect(e.left[0]).toBeCloseTo(9.0 + CANAL_TO_LOBE[0], 9);
    expect(e.right[0]).toBeCloseTo(-9.0 - CANAL_TO_LOBE[0], 9);
    expect(e.left[1]).toBeCloseTo(CANAL_TO_LOBE[1], 9);
  });

  it('one ear seen, the other never: the unseen ear is the reflection of the seen one', () => {
    const s = createEarState();
    observeEars(s, 1000, none, { lobe: [-8.7, -2.4, -3.6], canal: null, edge: [-7.6, 2.5, -1.9] });
    const e = estimateEars(s);
    expect(e.rightSource).toBe('lobe');
    expect(e.leftSource).toBe('mirrored');
    expect(e.left).toEqual([8.7, -2.4, -3.6]);
  });

  it('no ear seen (hair over both): the lobe follows this face width from the mesh edge', () => {
    const s = createEarState();
    observeEars(s, 1000, { lobe: null, canal: null, edge: [7.1, 2.4, -1.3] }, { lobe: null, canal: null, edge: [-7.3, 2.4, -1.5] });
    const e = estimateEars(s);
    expect(e.leftSource).toBe('edge');
    expect(e.left[0]).toBeCloseTo(7.1 + EDGE_TO_LOBE_X, 9);
    expect(e.right[0]).toBeCloseTo(-(7.3 + EDGE_TO_LOBE_X), 9);
    expect(e.left[1]).toBe(EAR_LOBE_DEFAULT[1]);
    expect(e.left[2]).toBe(EAR_LOBE_DEFAULT[2]);
  });

  it('rejects a mis-detection: the zero point 8th Wall reports for a lost ear, a wrong-side point, NaN', () => {
    const s = createEarState();
    observeEars(s, 1000, { lobe: [0, 0, 0], canal: [-8, 0, -4], edge: null }, { lobe: [NaN, 0, 0], canal: [8, 0, -4], edge: null });
    const e = estimateEars(s);
    expect(e.leftSource).toBe('default');
    expect(e.rightSource).toBe('default');
  });

  it('a face gone longer than the forget window is a new guest: the ears start over', () => {
    const s = createEarState();
    observeEars(s, 1000, { lobe: [9.5, -1, -4], canal: null, edge: null }, none);
    observeEars(s, 1000 + EAR_FORGET_AFTER_MS + 1, none, none);
    expect(estimateEars(s).leftSource).toBe('default');
    observeEars(s, 5000, { lobe: [8, -2, -4], canal: null, edge: null }, none);
    resetEarState(s);
    expect(estimateEars(s).leftSource).toBe('default');
  });
});
