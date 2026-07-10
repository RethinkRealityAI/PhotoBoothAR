import { describe, it, expect } from 'vitest';
import {
  createTriggerEngine,
  parseTriggers,
  sourceSignal,
  type TriggerConfig,
} from './triggers';

const smile = (over: Partial<TriggerConfig> = {}): TriggerConfig => ({
  id: 't-smile',
  source: 'smile',
  action: { type: 'burst', style: 'confetti' },
  ...over,
});

/** Feed one score map repeatedly, advancing the clock, collecting all events. */
function run(
  engine: ReturnType<typeof createTriggerEngine>,
  frames: Array<{ scores: Record<string, number> | null; t: number }>,
) {
  const fired: string[] = [];
  for (const f of frames) for (const e of engine.step(f.scores, f.t)) fired.push(e.configId);
  return fired;
}

const smileScore = (v: number) => ({ mouthSmileLeft: v, mouthSmileRight: v });

/** N frames of a constant smile score, starting at t0 on a 33ms cadence.
 *  4+ high frames are needed for the α=0.35 EMA to cross the enter threshold. */
const hold = (v: number, t0: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ scores: smileScore(v), t: t0 + i * 33 }));

describe('sourceSignal', () => {
  it('smile averages the two smile blendshapes', () => {
    expect(sourceSignal('smile', { mouthSmileLeft: 0.8, mouthSmileRight: 0.4 })).toBeCloseTo(0.6, 5);
  });
  it('mouthOpen reads jawOpen; missing keys are 0', () => {
    expect(sourceSignal('mouthOpen', { jawOpen: 0.7 })).toBe(0.7);
    expect(sourceSignal('mouthOpen', {})).toBe(0);
  });
  it('browRaise uses browInnerUp alone, or averages with outer when present', () => {
    expect(sourceSignal('browRaise', { browInnerUp: 0.6 })).toBeCloseTo(0.6, 5);
    expect(
      sourceSignal('browRaise', { browInnerUp: 0.6, browOuterUpLeft: 0.8, browOuterUpRight: 0.8 }),
    ).toBeCloseTo(0.7, 5);
  });
});

describe('enter-crossing fires exactly once', () => {
  it('a smile that rises past enter fires once, and not again while held', () => {
    const engine = createTriggerEngine([smile()]);
    const fired = run(engine, [
      { scores: smileScore(0.0), t: 0 },     // prime low
      { scores: smileScore(0.9), t: 33 },
      { scores: smileScore(0.9), t: 66 },
      { scores: smileScore(0.9), t: 99 },
      { scores: smileScore(0.9), t: 132 },
      { scores: smileScore(0.9), t: 165 },   // EMA well past enter — still one fire
    ]);
    expect(fired).toEqual(['t-smile']);
  });

  it('a face already smiling at engine start does NOT fire on the first sample', () => {
    const engine = createTriggerEngine([smile()]);
    // First sample is already high → primed as engaged, no crossing → no fire.
    const fired = run(engine, [
      { scores: smileScore(0.95), t: 0 },
      { scores: smileScore(0.95), t: 33 },
      { scores: smileScore(0.95), t: 66 },
    ]);
    expect(fired).toEqual([]);
  });
});

describe('hysteresis prevents boundary flicker', () => {
  it('noise around the enter threshold (never dropping to exit) fires only once', () => {
    const engine = createTriggerEngine([smile()]);
    // Rise firmly past enter to fire once, then jitter in [0.46, 0.6] — always
    // above exit(0.35), oscillating around enter(0.55). Once engaged, the signal
    // must fall to exit to re-arm; it never does, so there is exactly one fire.
    const frames = [{ scores: smileScore(0.0), t: 0 }, ...hold(0.9, 33, 4)];
    const noise = [0.5, 0.6, 0.48, 0.58, 0.46, 0.6, 0.5, 0.57];
    noise.forEach((v, i) => frames.push({ scores: smileScore(v), t: 200 + i * 33 }));
    expect(run(engine, frames)).toEqual(['t-smile']);
  });
});

describe('cooldown re-arm', () => {
  it('after dropping to exit, a re-entry inside the cooldown is blocked; outside it fires', () => {
    const engine = createTriggerEngine([smile({ cooldownMs: 2500 })]);
    const frames = [
      { scores: smileScore(0), t: 0 },   // prime low
      ...hold(0.95, 33, 5),              // fire #1 (crosses ~t=99)
      ...hold(0, 200, 6),               // decay below exit → re-arm
      ...hold(0.95, 400, 5),            // re-enter ~t=466 — within 2500 of fire#1 → BLOCKED
      ...hold(0, 600, 6),               // decay → re-arm again
      ...hold(0.95, 3200, 5),           // re-enter ~t=3266 — past cooldown → fire #2
    ];
    // Exactly two fires: the blocked re-entry in the middle produces none.
    expect(run(engine, frames)).toEqual(['t-smile', 't-smile']);
  });
});

describe('wink asymmetry', () => {
  const winkCfg: TriggerConfig = { id: 't-wink', source: 'wink', action: { type: 'burst', style: 'hearts' } };

  it('a one-eyed wink fires; both eyes closed (a blink) never fires', () => {
    const blink = createTriggerEngine([winkCfg]);
    const blinkFrames = [
      { scores: { eyeBlinkLeft: 0, eyeBlinkRight: 0 }, t: 0 },
      // Both high == blink → signal 0 → never crosses enter.
      ...[33, 66, 99, 132, 165].map((t) => ({ scores: { eyeBlinkLeft: 0.95, eyeBlinkRight: 0.95 }, t })),
    ];
    expect(run(blink, blinkFrames)).toEqual([]);

    const wink = createTriggerEngine([winkCfg]);
    const winkFrames = [
      { scores: { eyeBlinkLeft: 0, eyeBlinkRight: 0 }, t: 0 },
      // Left eye closed, right open → asymmetric wink → fires.
      ...[33, 66, 99, 132, 165].map((t) => ({ scores: { eyeBlinkLeft: 0.95, eyeBlinkRight: 0.05 }, t })),
    ];
    expect(run(wink, winkFrames)).toEqual(['t-wink']);
  });
});

describe('null / missing score robustness', () => {
  it('null scores never crash and decay the signal (no fire)', () => {
    const engine = createTriggerEngine([smile()]);
    expect(() => run(engine, [
      { scores: null, t: 0 },
      { scores: null, t: 33 },
      { scores: {}, t: 66 },
      { scores: { unrelated: 0.9 }, t: 99 },
    ])).not.toThrow();
    // A held smile still fires after a stretch of null frames (decayed, then rises).
    const fired = run(engine, [
      { scores: smileScore(0.9), t: 132 },
      { scores: smileScore(0.9), t: 165 },
      { scores: smileScore(0.9), t: 198 },
      { scores: smileScore(0.9), t: 231 },
    ]);
    expect(fired).toEqual(['t-smile']);
  });

  it('a lost face (null) after a fire decays the signal so it can re-arm', () => {
    const engine = createTriggerEngine([smile({ cooldownMs: 0 })]);
    // Fire once.
    const first = run(engine, [{ scores: smileScore(0), t: 0 }, ...hold(0.95, 33, 5)]);
    expect(first).toEqual(['t-smile']);
    // Long stretch of null (face gone) → decays below exit → re-armed.
    const nulls = [200, 233, 266, 299, 332].map((t) => ({ scores: null as Record<string, number> | null, t }));
    run(engine, nulls);
    // Face returns and smiles again → fires again (cooldown 0).
    expect(run(engine, hold(0.95, 400, 5))).toEqual(['t-smile']);
  });
});

describe('parseTriggers — garbage in', () => {
  it('non-array or empty/garbage input → []', () => {
    for (const g of [null, undefined, 42, 'x', {}, true, NaN]) {
      expect(parseTriggers(g as unknown)).toEqual([]);
    }
    expect(parseTriggers([null, 1, 'nope', {}, { id: '' }, { id: 'a', source: 'nope' }])).toEqual([]);
  });

  it('drops malformed items but keeps the valid ones', () => {
    const parsed = parseTriggers([
      { id: 'a', source: 'smile', action: { type: 'burst', style: 'confetti' }, cooldownMs: 1000 },
      { id: 'b', source: 'smile', action: { type: 'burst', style: 'not-a-style' } }, // bad style
      { id: 'c', source: 'wink', action: { type: 'reveal', objectId: 'obj-3' } },
      { id: 'd', source: 'browRaise', action: { type: 'filterPulse' } },
      { id: 'e', source: 'mouthOpen', action: { type: 'reveal' } }, // missing objectId
      { source: 'smile', action: { type: 'burst', style: 'hearts' } }, // missing id
    ]);
    expect(parsed.map((t) => t.id)).toEqual(['a', 'c', 'd']);
    expect(parsed[0].cooldownMs).toBe(1000);
    expect(parsed[1].action).toEqual({ type: 'reveal', objectId: 'obj-3' });
    expect(parsed[2].action).toEqual({ type: 'filterPulse' });
  });

  it('filterPulse keeps optional shaderId/durationMs only when valid', () => {
    const [a, b] = parseTriggers([
      { id: 'a', source: 'smile', action: { type: 'filterPulse', shaderId: 'vhs', durationMs: 1200 } },
      { id: 'b', source: 'smile', action: { type: 'filterPulse', shaderId: '', durationMs: -5 } },
    ]);
    expect(a.action).toEqual({ type: 'filterPulse', shaderId: 'vhs', durationMs: 1200 });
    expect(b.action).toEqual({ type: 'filterPulse' });
  });
});
