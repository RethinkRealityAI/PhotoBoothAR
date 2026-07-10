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

export type TriggerSource = 'smile' | 'mouthOpen' | 'wink' | 'browRaise';

export type BurstStyle = 'confetti' | 'hearts' | 'sparkles' | 'fireworks';

/** What a fired trigger does. `reveal` targets a scene object by id; `filterPulse`
 *  temporarily applies a shader (defaults to the scene's ambient filter). */
export type TriggerAction =
  | { type: 'burst'; style: BurstStyle }
  | { type: 'reveal'; objectId: string }
  | { type: 'filterPulse'; shaderId?: string; durationMs?: number };

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

export const TRIGGER_SOURCES: readonly TriggerSource[] = ['smile', 'mouthOpen', 'wink', 'browRaise'];
export const BURST_STYLES: readonly BurstStyle[] = ['confetti', 'hearts', 'sparkles', 'fireworks'];

/** Human labels for the studio UI (kept here so they stay in sync with the union). */
export const TRIGGER_SOURCE_LABELS: Record<TriggerSource, string> = {
  smile: 'Smile',
  mouthOpen: 'Open mouth',
  wink: 'Wink',
  browRaise: 'Raise brows',
};
export const BURST_STYLE_LABELS: Record<BurstStyle, string> = {
  confetti: 'Confetti',
  hearts: 'Hearts',
  sparkles: 'Sparkles',
  fireworks: 'Fireworks',
};

/** EMA weight applied per detection step (~30/s). Higher = snappier, noisier. */
const ALPHA = 0.35;
const DEFAULT_COOLDOWN_MS = 2500;
/** The other eye must be at/below this for a wink to count (rejects blinks). */
const WINK_OTHER_MAX = 0.25;

/** Per-source hysteresis band: fire when the smoothed signal crosses `enter`,
 *  re-arm only once it drops back to `exit`. jawOpen sits a touch lower. */
const THRESHOLDS: Record<TriggerSource, { enter: number; exit: number }> = {
  smile: { enter: 0.55, exit: 0.35 },
  mouthOpen: { enter: 0.5, exit: 0.3 },
  wink: { enter: 0.55, exit: 0.35 },
  browRaise: { enter: 0.55, exit: 0.35 },
};

/** Shared empty score map for null/absent frames (drives decay-to-zero). */
const EMPTY: Record<string, number> = {};

/** Raw 0..1 signal for a source from a blendshape score map (missing keys = 0). */
export function sourceSignal(source: TriggerSource, scores: Record<string, number>): number {
  const g = (k: string): number => {
    const v = scores[k];
    return typeof v === 'number' && isFinite(v) ? v : 0;
  };
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
        ch.value += ALPHA * (target - ch.value);
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
