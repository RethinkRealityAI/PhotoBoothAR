import { describe, it, expect } from 'vitest';
import {
  createTriggerEngine,
  parseTriggers,
  sourceSignal,
  type TriggerConfig,
  type TriggerEvent,
  type TriggerSource,
  revealTargetIdsOf,
  isLayerVisible,
  resolvePulseShader,
  pulseRestoreValue,
  triggerHintText,
  shouldRunTriggers,
  collectTriggers,
  isHandSource,
  hasHandSource,
  mergeDetectionScores,
  HAND_STALE_MS,
  HAND_SOURCE_SET,
  HAND_TRIGGER_SOURCES,
  FACE_TRIGGER_SOURCES,
  type HandTriggerSource,
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

/* — scene visibility + effect resolution ---------------------------------- */

describe('revealTargetIdsOf', () => {
  it('collects only reveal targets', () => {
    const ids = revealTargetIdsOf([
      { id: 'a', source: 'smile', action: { type: 'reveal', objectId: 'obj-1' } },
      { id: 'b', source: 'wink', action: { type: 'burst', style: 'hearts' } },
      { id: 'c', source: 'browRaise', action: { type: 'reveal', objectId: 'obj-2' } },
    ]);
    expect([...ids].sort()).toEqual(['obj-1', 'obj-2']);
  });

  it('is empty for a scene with no reveals', () => {
    expect(revealTargetIdsOf([{ id: 'a', source: 'smile', action: { type: 'burst', style: 'confetti' } }]).size).toBe(0);
  });
});

describe('isLayerVisible', () => {
  const targets = new Set(['hero']);

  it('shows an ordinary layer unless it is eye-hidden', () => {
    expect(isLayerVisible({ id: 'x' }, targets, new Set())).toBe(true);
    expect(isLayerVisible({ id: 'x', hidden: true }, targets, new Set())).toBe(false);
  });

  it('hides a reveal target until its trigger fires', () => {
    expect(isLayerVisible({ id: 'hero' }, targets, new Set())).toBe(false);
    expect(isLayerVisible({ id: 'hero' }, targets, new Set(['hero']))).toBe(true);
  });

  it('lets a fired reveal override the editor eye toggle', () => {
    // The divergence this replaces: StudioPreview ANDed the two conditions, so
    // an eye-hidden reveal target could never appear however often it fired.
    expect(isLayerVisible({ id: 'hero', hidden: true }, targets, new Set(['hero']))).toBe(true);
  });
});

describe('resolvePulseShader', () => {
  it('returns null when the pulse would be invisible', () => {
    expect(resolvePulseShader(undefined, 'velvet')).toBeNull();   // the shipped default
    expect(resolvePulseShader('none', 'velvet')).toBeNull();
    expect(resolvePulseShader('velvet', 'velvet')).toBeNull();    // same as ambient
  });

  it('returns the requested shader when it is genuinely distinct', () => {
    expect(resolvePulseShader('bloom', 'velvet')).toBe('bloom');
    expect(resolvePulseShader('bloom', 'none')).toBe('bloom');
  });
});

describe('pulseRestoreValue', () => {
  it('restores the prior filter when the pulse is still showing', () => {
    expect(pulseRestoreValue('pulse', 'pulse', 'velvet')).toBe('velvet');
  });

  it('leaves a filter the guest picked mid-pulse alone', () => {
    expect(pulseRestoreValue('guest-pick', 'pulse', 'velvet')).toBe('guest-pick');
  });
});

describe('triggerHintText', () => {
  it('is null with no triggers', () => {
    expect(triggerHintText([])).toBeNull();
  });

  it('names the actual source rather than always saying smile', () => {
    expect(triggerHintText([{ id: 'a', source: 'wink', action: { type: 'burst', style: 'hearts' } }]))
      .toBe('Wink for a surprise');
    expect(triggerHintText([{ id: 'a', source: 'mouthOpen', action: { type: 'burst', style: 'hearts' } }]))
      .toBe('Open your mouth for a surprise');
  });

  it('groups by distinct SOURCE, not by trigger count', () => {
    const twoSmiles = triggerHintText([
      { id: 'a', source: 'smile', action: { type: 'burst', style: 'hearts' } },
      { id: 'b', source: 'smile', action: { type: 'burst', style: 'confetti' } },
    ]);
    expect(twoSmiles).toBe('Smile for a surprise');
    const mixed = triggerHintText([
      { id: 'a', source: 'smile', action: { type: 'burst', style: 'hearts' } },
      { id: 'b', source: 'wink', action: { type: 'burst', style: 'confetti' } },
    ]);
    expect(mixed).toBe('Make a face for a surprise');
  });
});

describe('shouldRunTriggers', () => {
  it('runs during the COUNTDOWN — the smile people make for the shutter', () => {
    expect(shouldRunTriggers('db', true, 'countdown', true)).toBe(true);
  });

  it('runs while the camera is live', () => {
    expect(shouldRunTriggers('db', true, 'camera', true)).toBe(true);
  });

  it('stops once the capture is done or being reviewed', () => {
    for (const phase of ['flash', 'review', 'sending', 'sent']) {
      expect(shouldRunTriggers('db', true, phase, true)).toBe(false);
    }
  });

  it('never runs for coded/legacy events, empty scenes, or an unready camera', () => {
    expect(shouldRunTriggers('code', true, 'camera', true)).toBe(false);
    expect(shouldRunTriggers('db', false, 'camera', true)).toBe(false);
    expect(shouldRunTriggers('db', true, 'camera', false)).toBe(false);
  });
});

describe('collectTriggers', () => {
  const t = (id: string) => ({ id, source: 'smile', action: { type: 'burst', style: 'confetti' } });

  it('collects from a FILTER-only scene — the P0 this exists for', () => {
    // A filter is applied as a bare shaderId, so its Experience was dropped and
    // its triggers never reached the engine: authored, previewed, dead at the event.
    const filter = { id: 'exp-shader', config: { triggers: [t('a')] } };
    expect(collectTriggers([null, null, filter]).map((x) => x.id)).toEqual(['a']);
  });

  it('merges across attachment, frame and filter', () => {
    const out = collectTriggers([
      { id: 'e1', config: { triggers: [t('a')] } },
      { id: 'e2', config: { triggers: [t('b')] } },
      { id: 'e3', config: { triggers: [t('c')] } },
    ]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('parses a composite once when it fills two slots', () => {
    const composite = { id: 'same', config: { triggers: [t('a'), t('b')] } };
    expect(collectTriggers([composite, composite, null]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('dedupes by trigger id across different experiences', () => {
    const out = collectTriggers([
      { id: 'e1', config: { triggers: [t('dup')] } },
      { id: 'e2', config: { triggers: [t('dup'), t('other')] } },
    ]);
    expect(out.map((x) => x.id)).toEqual(['dup', 'other']);
  });

  it('ignores empty slots and malformed configs without throwing', () => {
    expect(collectTriggers([null, undefined, {}, { id: 'x', config: null }])).toEqual([]);
    expect(collectTriggers([{ id: 'x', config: { triggers: 'nope' } }])).toEqual([]);
    expect(collectTriggers([])).toEqual([]);
  });

  it('drops individually malformed triggers but keeps the good ones', () => {
    const out = collectTriggers([{ id: 'e', config: { triggers: [t('ok'), { id: 'bad' }] } }]);
    expect(out.map((x) => x.id)).toEqual(['ok']);
  });
});

/* — hand sources + new actions (Power-Ups) ---------------------------------- */

describe('hand-gesture grammar', () => {
  it('legacy jsonb blobs parse byte-identically after the union widened', () => {
    // A config saved BEFORE hand sources / beam actions existed.
    const legacy = [
      { id: 'a', source: 'smile', action: { type: 'burst', style: 'confetti' } },
      { id: 'b', source: 'wink', action: { type: 'reveal', objectId: 'obj-1' }, cooldownMs: 4000 },
      { id: 'c', source: 'browRaise', action: { type: 'filterPulse', shaderId: 'neon-pulse', durationMs: 1200 } },
    ];
    expect(parseTriggers(legacy)).toEqual(legacy);
  });

  it('sourceSignal reads hand scores by their own key', () => {
    expect(sourceSignal('fistClench', { fistClench: 0.8 })).toBe(0.8);
    expect(sourceSignal('handToTemple', {})).toBe(0);
    expect(sourceSignal('palmOpen', { palmOpen: NaN })).toBe(0);
  });

  it('isHandSource / hasHandSource split the families', () => {
    expect(isHandSource('fistClench')).toBe(true);
    expect(isHandSource('smile')).toBe(false);
    const mk = (source: TriggerSource): TriggerConfig => ({
      id: source,
      source,
      action: { type: 'burst', style: 'confetti' },
    });
    expect(hasHandSource([mk('smile'), mk('wink')])).toBe(false);
    expect(hasHandSource([mk('smile'), mk('palmOpen')])).toBe(true);
    expect(hasHandSource([])).toBe(false);
  });

  it('parses beam actions and drops invalid colours without killing the action', () => {
    const parsed = parseTriggers([
      { id: 'z', source: 'fistClench', action: { type: 'beam', style: 'optic', color: 'auto' } },
      { id: 'y', source: 'palmOpen', action: { type: 'beam', style: 'sparkle', color: '#0f0', origin: 'hand', objectId: 'o1', durationMs: 800 } },
      { id: 'x', source: 'smile', action: { type: 'beam', style: 'optic', color: 'javascript:evil' } },
      { id: 'w', source: 'smile', action: { type: 'beam', style: 'nope' } },
    ]);
    expect(parsed.map((p) => p.id)).toEqual(['z', 'y', 'x']);
    expect(parsed[0].action).toEqual({ type: 'beam', style: 'optic', color: 'auto' });
    expect(parsed[1].action).toEqual({ type: 'beam', style: 'sparkle', color: '#0f0', origin: 'hand', objectId: 'o1', durationMs: 800 });
    expect(parsed[2].action).toEqual({ type: 'beam', style: 'optic' }); // bad colour dropped, action kept
  });

  it('parses animate actions and rejects unknown presets or missing targets', () => {
    const parsed = parseTriggers([
      { id: 'a', source: 'pinch', action: { type: 'animate', objectId: 'o1', preset: 'shake' } },
      { id: 'b', source: 'pinch', action: { type: 'animate', objectId: '', preset: 'shake' } },
      { id: 'c', source: 'pinch', action: { type: 'animate', objectId: 'o1', preset: 'wobble' } },
    ]);
    expect(parsed.map((p) => p.id)).toEqual(['a']);
  });

  it('fires a hand-source trigger through the engine with merged scores', () => {
    const engine = createTriggerEngine([
      { id: 'h', source: 'fistClench', action: { type: 'beam', style: 'optic' } },
    ]);
    engine.step({ fistClench: 0 }, 0);
    let fired: TriggerEvent[] = [];
    for (let i = 1; i <= 10 && fired.length === 0; i++) {
      fired = engine.step({ fistClench: 1, mouthSmileLeft: 0.2 }, i * 66);
    }
    expect(fired).toHaveLength(1);
    expect(fired[0].action.type).toBe('beam');
  });

  it('mixed-family hint text names both families', () => {
    const mk = (source: TriggerSource): TriggerConfig => ({
      id: source,
      source,
      action: { type: 'burst', style: 'confetti' },
    });
    expect(triggerHintText([mk('smile'), mk('fistClench')])).toBe('Make a face or a gesture for a surprise');
    expect(triggerHintText([mk('palmOpen'), mk('fistClench')])).toBe('Try a hand gesture for a surprise');
    expect(triggerHintText([mk('fistClench')])).toBe('Make a fist to fire');
  });
});

/* — hand staleness --------------------------------------------------------- *
 * The two detectors run on different clocks: faceRig 33ms, handRig 66ms (150ms
 * once it has lost the hand), and both booth + studio step the engine whenever
 * EITHER produced a frame. Everything below simulates that interleave exactly
 * as the components do — a hand sample must influence the EMA ONCE.
 */

const FACE_TICK = 33; // faceRig DETECT_INTERVAL_MS
const HAND_TICK = 66; // handRig HAND_DETECT_INTERVAL_MS

const handCfg = (source: HandTriggerSource, over: Partial<TriggerConfig> = {}): TriggerConfig => ({
  id: `t-${source}`,
  source,
  action: { type: 'beam', style: 'optic' },
  cooldownMs: 0,
  ...over,
});

/**
 * Run the real rAF-loop shape: a face detection every 33ms, hand detections
 * only at the timestamps given. A hand frame that never arrives leaves the
 * stash frozen — exactly what every early return in detectHandsNow does.
 */
function simulate(
  engine: ReturnType<typeof createTriggerEngine>,
  source: HandTriggerSource,
  handFrames: Array<{ t: number; score: number }>,
  endMs: number,
): number[] {
  const fired: number[] = [];
  let stash: { scores: Record<string, number>; t: number } | null = null;
  let lastHandT = -1;
  let next = 0;
  for (let t = 0; t <= endMs; t += FACE_TICK) {
    while (next < handFrames.length && handFrames[next].t <= t) {
      stash = { scores: { [source]: handFrames[next].score }, t: handFrames[next].t };
      next++;
    }
    const handT = stash?.t ?? -1;
    const handChanged = handT !== lastHandT;
    lastHandT = handT;
    const merged = mergeDetectionScores({ jawOpen: 0 }, stash, handChanged, t);
    for (const e of engine.step(merged.scores, t, merged.stale)) fired.push(e.t);
  }
  return fired;
}

describe('a hand sample is never replayed into the EMA', () => {
  it('ONE 1.0 frame followed by zeros fires nothing', () => {
    // The reported bug: with the stash re-fed on the face-only ticks the single
    // 1.0 sample walked 0.50 → 0.75 by itself and crossed enter (0.62) before
    // the next inference could zero it — a beam with no hand in frame.
    const engine = createTriggerEngine([handCfg('fistClench')]);
    const frames = [
      { t: 0, score: 0 },
      { t: HAND_TICK, score: 1 },
      { t: HAND_TICK * 2, score: 0 },
      { t: HAND_TICK * 3, score: 0 },
      { t: HAND_TICK * 4, score: 0 },
    ];
    expect(simulate(engine, 'fistClench', frames, 600)).toEqual([]);
  });

  it('a genuinely held gesture DOES fire, on the second inference', () => {
    const engine = createTriggerEngine([handCfg('fistClench')]);
    const frames = Array.from({ length: 8 }, (_, i) => ({ t: i * HAND_TICK, score: i === 0 ? 0 : 1 }));
    const fired = simulate(engine, 'fistClench', frames, 600);
    expect(fired).toHaveLength(1);
    // α=0.5: 0 → 0.5 (1st sample) → 0.75 (2nd) ≥ 0.62. The fire lands on the
    // face tick that carries the 2nd hand frame, never before it.
    expect(fired[0]).toBeGreaterThanOrEqual(HAND_TICK * 2);
    expect(fired[0]).toBeLessThan(HAND_TICK * 3);
  });

  it('stale ticks between inferences neither fire NOR decay the channel', () => {
    // 198ms of face-only ticks (6 of them) separate the two hand samples. If a
    // stale tick decayed the channel, the second sample would restart from ~0
    // and could not cross; if it re-fed, the first sample alone would fire.
    const engine = createTriggerEngine([handCfg('palmOpen')]);
    const frames = [
      { t: 0, score: 0 },
      { t: 66, score: 1 },
      { t: 264, score: 1 },
    ];
    const fired = simulate(engine, 'palmOpen', frames, 297);
    expect(fired).toEqual([264]);
  });

  it('a stash older than HAND_STALE_MS decays the channel to zero', () => {
    // Hand detection stops mid-gesture (video not ready / face lockout / gate
    // skip all freeze the stash). The gesture must fall away, not latch — and
    // it must be a real decay: the next burst needs TWO samples to re-cross.
    const engine = createTriggerEngine([handCfg('pinch')]);
    const frames = [
      { t: 0, score: 0 },
      { t: 66, score: 1 },
      { t: 132, score: 1 }, // fires here
      // …detector stops for ~1.2s…
      { t: 1320, score: 1 },
      { t: 1386, score: 1 },
    ];
    const fired = simulate(engine, 'pinch', frames, 1500);
    expect(fired).toHaveLength(2);
    expect(fired[0]).toBe(132);
    expect(fired[1]).toBeGreaterThanOrEqual(1386); // two samples needed ⇒ it decayed
  });

  it('the expiry window is longer than the idle hand cadence', () => {
    // handRig backs off to 150ms when no hand is found; expiring at anything
    // below that would zero a hand that IS being tracked, just slowly.
    expect(HAND_STALE_MS).toBeGreaterThan(150);
  });
});

describe('mergeDetectionScores', () => {
  const face = { jawOpen: 0.4 };
  const hand = { scores: { fistClench: 0.9 }, t: 1000 };

  it('passes the face map straight through when there is no hand frame', () => {
    const m = mergeDetectionScores(face, null, false, 1000);
    expect(m.scores).toBe(face); // same reference: no allocation, no hand keys
    expect(m.stale).toBeUndefined();
    expect(mergeDetectionScores(null, null, false, 0).scores).toBeNull();
  });

  it('merges a NEW hand frame, hand keys last', () => {
    const m = mergeDetectionScores(face, hand, true, 1000);
    expect(m.scores).toEqual({ jawOpen: 0.4, fistClench: 0.9 });
    expect(m.stale).toBeUndefined();
  });

  it('marks the hand sources stale between inferences — and leaks no hand key', () => {
    const m = mergeDetectionScores(face, hand, false, 1000 + 100);
    expect(m.scores).toBe(face);
    expect(m.stale).toBe(HAND_SOURCE_SET);
    for (const k of HAND_TRIGGER_SOURCES) expect(m.scores?.[k]).toBeUndefined();
  });

  it('feeds explicit zeros once the stash is older than HAND_STALE_MS', () => {
    const m = mergeDetectionScores(face, hand, false, 1000 + HAND_STALE_MS + 1);
    expect(m.stale).toBeUndefined();
    expect(m.scores?.jawOpen).toBe(0.4);
    for (const k of HAND_TRIGGER_SOURCES) expect(m.scores?.[k]).toBe(0);
    // exactly AT the boundary it is still merely "between inferences"
    expect(mergeDetectionScores(face, hand, false, 1000 + HAND_STALE_MS).stale).toBe(HAND_SOURCE_SET);
  });

  it('never marks a FACE source stale', () => {
    for (const s of FACE_TRIGGER_SOURCES) expect(HAND_SOURCE_SET.has(s)).toBe(false);
    for (const s of HAND_TRIGGER_SOURCES) expect(HAND_SOURCE_SET.has(s)).toBe(true);
  });
});

describe('step(staleSources) holds a channel', () => {
  it('a stale source is neither primed, advanced, nor fired', () => {
    const engine = createTriggerEngine([handCfg('peaceSign')]);
    const stale = new Set<TriggerSource>(['peaceSign']);
    // 30 ticks of a full-strength score, all stale → nothing happens at all,
    // including the priming first sample.
    for (let i = 0; i < 30; i++) expect(engine.step({ peaceSign: 1 }, i * 33, stale)).toEqual([]);
    // Real samples now: the first PRIMES (at 0, no crossing to fire on), then
    // 0.5, then 0.75 ≥ enter 0.65 → one fire on the third. Had the stale ticks
    // primed the channel at 1.0 it would have started engaged and this whole
    // sequence would fire nothing.
    expect(engine.step({ peaceSign: 0 }, 1000)).toEqual([]);
    expect(engine.step({ peaceSign: 1 }, 1066)).toEqual([]);
    expect(engine.step({ peaceSign: 1 }, 1132)).toHaveLength(1);
  });

  it('face channels are untouched by a hand-only stale set (legacy scenes)', () => {
    // A scene with no hand trigger never passes a stale set at all, but even a
    // hand-anchored scene that does must leave every face channel stepping.
    const engine = createTriggerEngine([smile()]);
    const frames = [{ scores: smileScore(0), t: 0 }, ...hold(0.9, 33, 5)]; // prime low
    const fired = frames.map((f) => engine.step(f.scores, f.t, HAND_SOURCE_SET).length);
    expect(fired.reduce((a, b) => a + b, 0)).toBe(1);
  });
});
