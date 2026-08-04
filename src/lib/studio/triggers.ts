/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face-triggered effects engine — PURE logic (no three.js, no DOM), so vitest
 * (node env) exercises every crossing/hysteresis/cooldown path. The booth feeds
 * it MediaPipe FaceLandmarker blendshape scores each detection frame; it emits
 * one-shot events (particle burst / reveal a scene piece / filter pulse).
 *
 * Signals are derived from ARKit-style blendshape category names that
 * FaceLandmarker returns once `outputFaceBlendshapes` is enabled
 * (mouthSmileLeft/Right, jawOpen, eyeBlinkLeft/Right, browInnerUp,
 * browOuterUpLeft/Right). Each source runs through EMA smoothing → hysteresis
 * → fire-once-on-enter → cooldown re-arm, so noisy per-frame scores never
 * flicker the effect and a held expression fires exactly once.
 */

export type FaceTriggerSource = 'smile' | 'mouthOpen' | 'wink' | 'browRaise';
/** Hand-gesture sources, scored by src/lib/handGestures.ts from HandLandmarker
 *  landmarks and fed into the SAME scores map as the face blendshapes (keys are
 *  the source names themselves — ARKit categories are `mouthSmileLeft`-style, so
 *  the namespaces cannot collide). */
export type HandTriggerSource = 'fistClench' | 'palmOpen' | 'pinch' | 'peaceSign' | 'handToTemple';
export type TriggerSource = FaceTriggerSource | HandTriggerSource;

export type BurstStyle = 'confetti' | 'hearts' | 'sparkles' | 'fireworks';

/** Energy-beam looks rendered by BeamFX (src/lib/studio/beam.ts owns timing). */
export type BeamStyle = 'optic' | 'energy' | 'sparkle' | 'lightning';
/** Where a beam erupts from. 'auto' = the firing gesture decides (hand gesture →
 *  hand, face gesture → head). */
export type BeamOrigin = 'auto' | 'head' | 'hand';
/** One-shot piece animations for the `animate` action. */
export type AnimatePreset = 'shake' | 'pulse' | 'spin' | 'pop';

/** What a fired trigger does. `reveal` targets a scene object by id; `filterPulse`
 *  temporarily applies a shader (defaults to the scene's ambient filter); `beam`
 *  fires an energy blast (`color: 'auto'` resolves from the emitting piece's
 *  lens-region hex at fire time); `animate` plays a one-shot preset on a piece. */
export type TriggerAction =
  | { type: 'burst'; style: BurstStyle }
  | { type: 'reveal'; objectId: string }
  | { type: 'filterPulse'; shaderId?: string; durationMs?: number }
  | { type: 'beam'; style: BeamStyle; origin?: BeamOrigin; color?: string; objectId?: string; durationMs?: number }
  | { type: 'animate'; objectId: string; preset: AnimatePreset };

export interface TriggerConfig {
  id: string;
  source: TriggerSource;
  action: TriggerAction;
  /** Minimum ms between fires of THIS trigger (default 2500). */
  cooldownMs?: number;
}

/** Emitted by the engine when a trigger fires on an enter-crossing. */
export interface TriggerEvent {
  configId: string;
  source: TriggerSource;
  action: TriggerAction;
  /** nowMs at which it fired (the value passed to step()). */
  t: number;
}

export const FACE_TRIGGER_SOURCES: readonly FaceTriggerSource[] = ['smile', 'mouthOpen', 'wink', 'browRaise'];
export const HAND_TRIGGER_SOURCES: readonly HandTriggerSource[] = [
  'fistClench',
  'palmOpen',
  'pinch',
  'peaceSign',
  'handToTemple',
];
/** Face first, hands after — order preserved so existing chip UIs don't reshuffle. */
export const TRIGGER_SOURCES: readonly TriggerSource[] = [...FACE_TRIGGER_SOURCES, ...HAND_TRIGGER_SOURCES];
export const BURST_STYLES: readonly BurstStyle[] = ['confetti', 'hearts', 'sparkles', 'fireworks'];
export const BEAM_STYLES: readonly BeamStyle[] = ['optic', 'energy', 'sparkle', 'lightning'];
export const ANIMATE_PRESETS: readonly AnimatePreset[] = ['shake', 'pulse', 'spin', 'pop'];

export function isHandSource(s: TriggerSource): s is HandTriggerSource {
  return (HAND_TRIGGER_SOURCES as readonly string[]).includes(s);
}

/** Does this trigger set need the hand landmarker at all? Drives lazy init —
 *  false for every legacy config, so no stored scene ever pays for hand tracking. */
export function hasHandSource(triggers: readonly TriggerConfig[]): boolean {
  return triggers.some((t) => isHandSource(t.source));
}

/** Human labels for the studio UI (kept here so they stay in sync with the union). */
export const TRIGGER_SOURCE_LABELS: Record<TriggerSource, string> = {
  smile: 'Smile',
  mouthOpen: 'Open mouth',
  wink: 'Wink',
  browRaise: 'Raise brows',
  fistClench: 'Clench fist',
  palmOpen: 'Open palm',
  pinch: 'Pinch',
  peaceSign: 'Peace sign',
  handToTemple: 'Hand to temple',
};
export const BURST_STYLE_LABELS: Record<BurstStyle, string> = {
  confetti: 'Confetti',
  hearts: 'Hearts',
  sparkles: 'Sparkles',
  fireworks: 'Fireworks',
};
export const BEAM_STYLE_LABELS: Record<BeamStyle, string> = {
  optic: 'Optic blast',
  energy: 'Energy blast',
  sparkle: 'Sparkle stream',
  lightning: 'Lightning arc',
};
export const ANIMATE_PRESET_LABELS: Record<AnimatePreset, string> = {
  shake: 'Shake',
  pulse: 'Pulse',
  spin: 'Spin',
  pop: 'Pop',
};

/** EMA weight applied per detection step (~30/s). Higher = snappier, noisier. */
const ALPHA = 0.35;
/** Hand detections arrive at roughly half the face cadence (~15/s), so a shared
 *  0.35 would make a held fist take ~400ms to register — hand sources get a
 *  snappier per-source alpha instead. */
const SOURCE_ALPHA: Partial<Record<TriggerSource, number>> = {
  fistClench: 0.5,
  palmOpen: 0.5,
  pinch: 0.5,
  peaceSign: 0.5,
  handToTemple: 0.5,
};
const DEFAULT_COOLDOWN_MS = 2500;
/** The other eye must be at/below this for a wink to count (rejects blinks). */
const WINK_OTHER_MAX = 0.25;

/** Per-source hysteresis band: fire when the smoothed signal crosses `enter`,
 *  re-arm only once it drops back to `exit`. jawOpen sits a touch lower; hand
 *  gestures are noisier and slower-sampled, so their bands are wider. */
const THRESHOLDS: Record<TriggerSource, { enter: number; exit: number }> = {
  smile: { enter: 0.55, exit: 0.35 },
  mouthOpen: { enter: 0.5, exit: 0.3 },
  wink: { enter: 0.55, exit: 0.35 },
  browRaise: { enter: 0.55, exit: 0.35 },
  fistClench: { enter: 0.62, exit: 0.38 },
  palmOpen: { enter: 0.62, exit: 0.38 },
  pinch: { enter: 0.6, exit: 0.35 },
  peaceSign: { enter: 0.65, exit: 0.4 },
  handToTemple: { enter: 0.6, exit: 0.35 },
};

/** Shared empty score map for null/absent frames (drives decay-to-zero). */
const EMPTY: Record<string, number> = {};

/** Raw 0..1 signal for a source from a blendshape score map (missing keys = 0). */
export function sourceSignal(source: TriggerSource, scores: Record<string, number>): number {
  const g = (k: string): number => {
    const v = scores[k];
    return typeof v === 'number' && isFinite(v) ? v : 0;
  };
  // Hand sources are pre-scored by handGestures.ts under their own names.
  if (isHandSource(source)) return g(source);
  switch (source) {
    case 'smile':
      return (g('mouthSmileLeft') + g('mouthSmileRight')) / 2;
    case 'mouthOpen':
      return g('jawOpen');
    case 'wink': {
      // Asymmetry required: the winking eye's blink counts ONLY while the other
      // eye stays open (≤ WINK_OTHER_MAX). A normal blink closes both → 0.
      const left = g('eyeBlinkRight') <= WINK_OTHER_MAX ? g('eyeBlinkLeft') : 0;
      const right = g('eyeBlinkLeft') <= WINK_OTHER_MAX ? g('eyeBlinkRight') : 0;
      return Math.max(left, right);
    }
    case 'browRaise': {
      const inner = g('browInnerUp');
      const hasOuter = 'browOuterUpLeft' in scores || 'browOuterUpRight' in scores;
      if (!hasOuter) return inner;
      const outer = (g('browOuterUpLeft') + g('browOuterUpRight')) / 2;
      return (inner + outer) / 2;
    }
  }
}

interface Channel {
  cfg: TriggerConfig;
  value: number;      // EMA-smoothed signal
  engaged: boolean;   // inside the hysteresis band (past enter, not yet back to exit)
  lastFire: number;   // ms of the last fire (−∞ until first)
  started: boolean;   // seen the first sample (which never fires — no crossing yet)
}

export interface TriggerEngine {
  /**
   * Advance every trigger by one detection frame. `scores` null/absent decays
   * all signals toward 0 (never crashes). Returns the events that fired THIS
   * step (usually empty). `nowMs` drives cooldown — pass a monotonic clock.
   */
  step(scores: Record<string, number> | null, nowMs: number): TriggerEvent[];
}

export function createTriggerEngine(configs: TriggerConfig[]): TriggerEngine {
  const channels: Channel[] = configs.map((cfg) => ({
    cfg,
    value: 0,
    engaged: false,
    lastFire: -Infinity,
    started: false,
  }));

  return {
    step(scores, nowMs) {
      const src = scores ?? EMPTY;
      const events: TriggerEvent[] = [];
      for (const ch of channels) {
        const target = sourceSignal(ch.cfg.source, src);
        const th = THRESHOLDS[ch.cfg.source];
        if (!ch.started) {
          // Prime with the first sample WITHOUT firing: if the guest is already
          // mid-expression at engine start there is no enter-crossing to fire on.
          ch.value = target;
          ch.started = true;
          ch.engaged = target >= th.enter;
          continue;
        }
        ch.value += (SOURCE_ALPHA[ch.cfg.source] ?? ALPHA) * (target - ch.value);
        if (!ch.engaged) {
          if (ch.value >= th.enter) {
            ch.engaged = true; // enter-crossing
            const cd = ch.cfg.cooldownMs ?? DEFAULT_COOLDOWN_MS;
            if (nowMs - ch.lastFire >= cd) {
              ch.lastFire = nowMs;
              events.push({ configId: ch.cfg.id, source: ch.cfg.source, action: ch.cfg.action, t: nowMs });
            }
          }
        } else if (ch.value <= th.exit) {
          ch.engaged = false; // re-arm; the next enter-crossing may fire (cooldown permitting)
        }
      }
      return events;
    },
  };
}

/* — scene-visibility + effect resolution ----------------------------------- *
 * These were previously inline in three places (Booth, StudioStage,
 * StudioPreview) and had DRIFTED: the booth exempts a reveal target from the
 * studio's eye toggle, while StudioPreview ANDed the two conditions, so an
 * eye-hidden reveal target could never appear in Preview no matter how often the
 * trigger fired. One predicate, one behaviour.
 */

/** Ids of every scene object some trigger reveals. */
export function revealTargetIdsOf(triggers: readonly TriggerConfig[]): Set<string> {
  const s = new Set<string>();
  for (const t of triggers) if (t.action.type === 'reveal') s.add(t.action.objectId);
  return s;
}

/**
 * Should this layer render right now?
 *
 * A reveal target is governed ONLY by whether its trigger has fired — the eye
 * toggle in the Layers panel is an editor convenience and must not silently
 * disable a guest-facing surprise. Everything else honours `hidden`.
 */
export function isLayerVisible(
  layer: { id: string; hidden?: boolean },
  revealTargets: ReadonlySet<string>,
  revealed: ReadonlySet<string>,
): boolean {
  return revealTargets.has(layer.id) ? revealed.has(layer.id) : layer.hidden !== true;
}

/**
 * Which shader a filterPulse should actually switch to, or null when the pulse
 * would be invisible.
 *
 * A `filterPulse` with no explicit shaderId falls back to the scene's own
 * ambient filter — which IS what is already on screen, so the default trigger
 * the authoring UI offered ("Smile → Filter pulse") was a guaranteed no-op in
 * the booth AND in Preview, with nothing telling the host. Returning null makes
 * that case explicit so callers can skip the work and the editor can warn.
 */
export function resolvePulseShader(requested: string | undefined, current: string): string | null {
  const target = requested && requested !== 'none' ? requested : null;
  if (!target) return null;              // nothing distinct requested
  if (target === current) return null;   // pulsing to what is already showing
  return target;
}

/**
 * What the effect id should be when a pulse ends. Restores `prior` ONLY if the
 * pulse shader is still the one showing — a guest who picks their own filter
 * during the ~1.2s pulse used to have that choice silently reverted.
 */
export function pulseRestoreValue(current: string, target: string, prior: string): string {
  return current === target ? prior : current;
}

/** Guest-facing hint per source. */
export const TRIGGER_HINT_LABELS: Record<TriggerSource, string> = {
  smile: 'Smile for a surprise',
  mouthOpen: 'Open your mouth for a surprise',
  wink: 'Wink for a surprise',
  browRaise: 'Raise your brows for a surprise',
  fistClench: 'Make a fist to fire',
  palmOpen: 'Open your palm to blast',
  pinch: 'Pinch your fingers for magic',
  peaceSign: 'Throw a peace sign',
  handToTemple: 'Touch your temple to fire',
};

/**
 * The booth's one-line hint for a scene's triggers, or null when there are none.
 * The booth used to hard-code "Smile for a surprise" regardless of what the host
 * actually authored, so a wink-triggered scene told every guest to smile.
 */
export function triggerHintText(triggers: readonly TriggerConfig[]): string | null {
  const sources = new Set<TriggerSource>();
  for (const t of triggers) sources.add(t.source);
  if (sources.size === 0) return null;
  if (sources.size === 1) return TRIGGER_HINT_LABELS[[...sources][0]];
  const list = [...sources];
  const hands = list.filter((s) => isHandSource(s)).length;
  if (hands === list.length) return 'Try a hand gesture for a surprise';
  if (hands > 0) return 'Make a face or a gesture for a surprise';
  return 'Make a face for a surprise';
}

/**
 * Should the booth run detection + the trigger engine right now?
 *
 * Includes the COUNTDOWN deliberately: the gate used to be `phase === 'camera'`
 * alone, so from the instant a guest tapped the shutter with a timer until the
 * JPEG was composited, no expression could fire anything — i.e. the smile people
 * actually make for the shutter was the one smile that never worked. Both
 * TriggerEffects and StageCanvas are already mounted during the countdown, so a
 * burst fired at t-1s composites into the capture.
 */
export function shouldRunTriggers(
  source: string,
  hasTriggers: boolean,
  phase: string,
  ready: boolean,
): boolean {
  if (source !== 'db' || !hasTriggers || !ready) return false;
  return phase === 'camera' || phase === 'countdown';
}

/**
 * Merge the triggers carried by every experience making up the current scene,
 * de-duplicated by id and preserving order.
 *
 * A scene is up to THREE experiences — a 3D attachment, a 2D frame, and a
 * filter — and any of them may carry triggers. The booth previously merged only
 * the first two, because a filter is applied as a bare shaderId string and its
 * Experience was thrown away at the call site. A filter-only scene therefore
 * saved triggers, previewed them correctly in the studio, and could never fire
 * one at the event.
 *
 * Takes `unknown` config blobs so it can sit in front of parseTriggers without
 * the caller pre-validating anything.
 */
export function collectTriggers(
  sources: readonly ({ id?: string; config?: { triggers?: unknown } | null } | null | undefined)[],
): TriggerConfig[] {
  const seenExp = new Set<string>();
  const seen = new Set<string>();
  const merged: TriggerConfig[] = [];
  for (const exp of sources) {
    if (!exp?.config?.triggers) continue;
    // The same experience can appear in two slots (a composite is both the
    // attachment and the frame); parse it once.
    if (exp.id !== undefined) {
      if (seenExp.has(exp.id)) continue;
      seenExp.add(exp.id);
    }
    for (const t of parseTriggers(exp.config.triggers)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      merged.push(t);
    }
  }
  return merged;
}

/* — (de)serialization guards ---------------------------------------------- */

function parseAction(a: unknown): TriggerAction | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  if (o.type === 'burst') {
    return (BURST_STYLES as readonly string[]).includes(o.style as string)
      ? { type: 'burst', style: o.style as BurstStyle }
      : null;
  }
  if (o.type === 'reveal') {
    return typeof o.objectId === 'string' && o.objectId ? { type: 'reveal', objectId: o.objectId } : null;
  }
  if (o.type === 'filterPulse') {
    const act: Extract<TriggerAction, { type: 'filterPulse' }> = { type: 'filterPulse' };
    if (typeof o.shaderId === 'string' && o.shaderId) act.shaderId = o.shaderId;
    if (typeof o.durationMs === 'number' && isFinite(o.durationMs) && o.durationMs > 0) act.durationMs = o.durationMs;
    return act;
  }
  if (o.type === 'beam') {
    if (!(BEAM_STYLES as readonly string[]).includes(o.style as string)) return null;
    const act: Extract<TriggerAction, { type: 'beam' }> = { type: 'beam', style: o.style as BeamStyle };
    if (o.origin === 'head' || o.origin === 'hand' || o.origin === 'auto') act.origin = o.origin;
    // `color` is 'auto' or a #rgb/#rrggbb hex; anything else is dropped, keeping
    // the action valid (colour then resolves from the emitting piece).
    if (o.color === 'auto' || (typeof o.color === 'string' && /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(o.color))) {
      act.color = o.color;
    }
    if (typeof o.objectId === 'string' && o.objectId) act.objectId = o.objectId;
    if (typeof o.durationMs === 'number' && isFinite(o.durationMs) && o.durationMs > 0) act.durationMs = o.durationMs;
    return act;
  }
  if (o.type === 'animate') {
    if (typeof o.objectId !== 'string' || !o.objectId) return null;
    return (ANIMATE_PRESETS as readonly string[]).includes(o.preset as string)
      ? { type: 'animate', objectId: o.objectId, preset: o.preset as AnimatePreset }
      : null;
  }
  return null;
}

/**
 * Validate untrusted JSON (config jsonb) into TriggerConfig[]. Non-array input,
 * or nothing valid inside, → []. Individual malformed items are dropped, never
 * throwing, so one bad row can't lose the good ones.
 */
export function parseTriggers(input: unknown): TriggerConfig[] {
  if (!Array.isArray(input)) return [];
  const out: TriggerConfig[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    if (!(TRIGGER_SOURCES as readonly string[]).includes(o.source as string)) continue;
    const action = parseAction(o.action);
    if (!action) continue;
    const cfg: TriggerConfig = { id: o.id, source: o.source as TriggerSource, action };
    if (typeof o.cooldownMs === 'number' && isFinite(o.cooldownMs) && o.cooldownMs >= 0) {
      cfg.cooldownMs = o.cooldownMs;
    }
    out.push(cfg);
  }
  return out;
}
