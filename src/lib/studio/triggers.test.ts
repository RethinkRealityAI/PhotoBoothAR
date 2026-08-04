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
