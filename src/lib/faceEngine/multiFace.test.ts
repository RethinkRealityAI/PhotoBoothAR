import { describe, it, expect } from 'vitest';
import {
  createFaceSlotState, faceSlotsLost, faceSlotsObserve, parseMaxFaces, readMaxFacesOverride,
  resetFaceSlots, resolveMaxFaces, slotOf, MAX_EXTRA_FACES, MULTI_FACE_DEFAULT,
} from './multiFace';

const f = (id: number, depthCm = 50) => ({ id, depthCm });

describe('multiFace policy', () => {
  it('parses only 1..3 integers', () => {
    expect(parseMaxFaces('1')).toBe(1);
    expect(parseMaxFaces(' 3 ')).toBe(3);
    expect(parseMaxFaces(2)).toBe(2);
    for (const bad of ['0', '4', '2.5', '', 'x', null, undefined, {}, NaN]) expect(parseMaxFaces(bad)).toBeNull();
  });

  it('reads the ?faces= tester switch', () => {
    expect(readMaxFacesOverride('?faces=1')).toBe(1);
    expect(readMaxFacesOverride('?trackdebug&faces=3')).toBe(3);
    expect(readMaxFacesOverride('?faces=9')).toBeNull();
    expect(readMaxFacesOverride('')).toBeNull();
  });

  it('legacy is always single-face, whatever the URL or config says', () => {
    expect(resolveMaxFaces({ legacy: true, url: '3', config: 3 })).toBe(1);
  });

  it('platform: URL beats config beats the default', () => {
    expect(resolveMaxFaces({ legacy: false })).toBe(MULTI_FACE_DEFAULT);
    expect(resolveMaxFaces({ legacy: false, config: 2 })).toBe(2);
    expect(resolveMaxFaces({ legacy: false, url: '1', config: 3 })).toBe(1);
    expect(resolveMaxFaces({ legacy: false, url: 'junk', config: 'junk' })).toBe(MULTI_FACE_DEFAULT);
  });
});

describe('face slots', () => {
  it('the first face found is primary; later faces take extra slots in order', () => {
    const s = createFaceSlotState();
    expect(faceSlotsObserve(s, [f(7)]).primaryChanged).toBe(true);
    expect(faceSlotsObserve(s, [f(7), f(9)]).primaryChanged).toBe(false);
    faceSlotsObserve(s, [f(7), f(9), f(4)]);
    expect([slotOf(s, 7), slotOf(s, 9), slotOf(s, 4)]).toEqual([0, 1, 2]);
  });

  it('several new faces in one tick: the nearest becomes primary', () => {
    const s = createFaceSlotState();
    faceSlotsObserve(s, [f(1, 90), f(2, 40), f(3, 60)]);
    expect(s.primary).toBe(2);
    expect(s.extras).toEqual([3, 1]);
  });

  it('a nearer face arriving later does NOT steal primary (stability)', () => {
    const s = createFaceSlotState();
    faceSlotsObserve(s, [f(1, 80)]);
    const r = faceSlotsObserve(s, [f(1, 80), f(2, 30)]);
    expect(r.primaryChanged).toBe(false);
    expect(s.primary).toBe(1);
    expect(slotOf(s, 2)).toBe(1);
  });

  it('extras keep their slot when another extra leaves', () => {
    const s = createFaceSlotState();
    faceSlotsObserve(s, [f(1), f(2, 60), f(3, 70)]);
    expect(s.extras).toEqual([2, 3]);
    expect(faceSlotsLost(s, [2]).primaryChanged).toBe(false);
    expect(s.extras).toEqual([null, 3]);
    faceSlotsObserve(s, [f(1), f(3), f(8)]);
    expect(s.extras).toEqual([8, 3]);
  });

  it('losing the primary promotes the NEAREST remaining extra and frees its slot', () => {
    const s = createFaceSlotState();
    faceSlotsObserve(s, [f(1, 40), f(2, 90), f(3, 55)]);
    expect(s.extras).toEqual([3, 2]); // seated nearest-first
    const r = faceSlotsLost(s, [1]);
    expect(r.primaryChanged).toBe(true);
    expect(s.primary).toBe(3);
    expect(s.extras).toEqual([null, 2]);
  });

  it('losing the only face leaves no primary; the next face found becomes it', () => {
    const s = createFaceSlotState();
    faceSlotsObserve(s, [f(1)]);
    expect(faceSlotsLost(s, [1]).primaryChanged).toBe(true);
    expect(s.primary).toBeNull();
    expect(faceSlotsObserve(s, [f(5)]).primaryChanged).toBe(true);
    expect(s.primary).toBe(5);
  });

  it('losing everyone at once clears every slot', () => {
    const s = createFaceSlotState();
    faceSlotsObserve(s, [f(1), f(2), f(3)]);
    faceSlotsLost(s, [1, 2, 3]);
    expect(s.primary).toBeNull();
    expect(s.extras).toEqual([null, null]);
    expect(s.depth.size).toBe(0);
  });

  it('a face beyond the slot capacity is ignored', () => {
    const s = createFaceSlotState(1);
    faceSlotsObserve(s, [f(1), f(2), f(3)]);
    expect(s.extras).toEqual([2]);
    expect(slotOf(s, 3)).toBe(-1);
  });

  it('single-face config (0 extra slots) only ever tracks the primary', () => {
    const s = createFaceSlotState(0);
    faceSlotsObserve(s, [f(1), f(2)]);
    expect(s.primary).toBe(1);
    expect(s.extras).toEqual([]);
    expect(faceSlotsLost(s, [1]).primaryChanged).toBe(true);
    expect(s.primary).toBeNull();
  });

  it('non-finite depths never crash promotion and lose to a real depth', () => {
    const s = createFaceSlotState();
    faceSlotsObserve(s, [f(1, 50), f(2, NaN), f(3, 70)]);
    faceSlotsLost(s, [1]);
    expect(s.primary).toBe(3);
  });

  it('reset forgets everything; slot count is capped', () => {
    const s = createFaceSlotState(9);
    expect(s.extras.length).toBe(MAX_EXTRA_FACES);
    faceSlotsObserve(s, [f(1), f(2)]);
    resetFaceSlots(s);
    expect(s.primary).toBeNull();
    expect(s.extras).toEqual([null, null]);
  });
});
