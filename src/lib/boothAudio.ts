/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Booth audio cues — synthesized, never a file.
 *
 * A countdown that is only a number is a countdown a guest in a noisy room
 * misses. These are the per-second ticks and the shutter beep, generated with
 * WebAudio oscillators so the booth ships no audio assets and adds no
 * dependency.
 *
 * THREE hard rules, because audio is the easiest thing in a browser to get
 * wrong:
 *   1. NEVER throw. An AudioContext constructed before a user gesture is
 *      `suspended` (Chrome/Safari autoplay policy) and some engines throw
 *      outright; `playCue` swallows every one of those and the countdown just
 *      runs silently. Sound is a garnish, never a mechanism.
 *   2. Opt-out is honoured everywhere — an explicit mute (persisted like
 *      haptics) and `prefers-reduced-motion`, which is also a request for a
 *      calmer experience.
 *   3. One shared AudioContext for the page. Browsers cap live contexts
 *      (Safari ~4), and a booth that minted one per tick would be silent by
 *      the third countdown.
 *
 * The SHAPE of each cue is pure (`cueSpec`) so it is testable without an audio
 * device — the vitest node env has no WebAudio at all.
 */

export type CueKind =
  /** One of the countdown's ordinary seconds. */
  | 'tick'
  /** The final second before the shutter — brighter, so it reads as "now". */
  | 'tickFinal'
  /** The shutter fired. */
  | 'shutter'
  /** The post landed on the wall. */
  | 'success';

export interface CueSpec {
  /** Start frequency in Hz. */
  freq: number;
  /** End frequency in Hz — equal to `freq` for a flat blip. */
  endFreq: number;
  /** Total length in seconds. Deliberately short: anything a guest can
   *  consciously time reads as a malfunction. */
  durationSec: number;
  /** Peak gain, 0..1. Kept low — a booth is usually near a PA. */
  gain: number;
  type: OscillatorType;
}

/**
 * Pure description of a cue. Exported so the sound design is reviewable and
 * testable as data rather than as side effects.
 */
export function cueSpec(kind: CueKind): CueSpec {
  switch (kind) {
    case 'tick':
      return { freq: 660, endFreq: 660, durationSec: 0.07, gain: 0.13, type: 'sine' };
    case 'tickFinal':
      return { freq: 990, endFreq: 1320, durationSec: 0.13, gain: 0.18, type: 'sine' };
    case 'shutter':
      return { freq: 1760, endFreq: 440, durationSec: 0.09, gain: 0.16, type: 'triangle' };
    case 'success':
      return { freq: 880, endFreq: 1760, durationSec: 0.26, gain: 0.14, type: 'sine' };
  }
}

const STORAGE_KEY = 'beamwall:booth-sound';

/** Cached so a countdown tick doesn't hit localStorage; `null` = not yet read. */
let enabledCache: boolean | null = null;

/**
 * Sound is ON by default. A photo booth that beeps as it counts down is the
 * expected behaviour of the object it is imitating; a guest who dislikes it has
 * a visible mute in the countdown itself.
 */
export function soundEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  try {
    enabledCache = localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    enabledCache = true; // storage unavailable (private mode) — default on
  }
  return enabledCache;
}

export function setSoundEnabled(on: boolean): void {
  enabledCache = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // preference is best-effort; the in-memory value still applies this session
  }
}

/** Test seam: drop the memoized preference so a fresh read hits storage. */
export function resetSoundCache(): void {
  enabledCache = null;
}

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** ONE context for the page — see rule 3 above. */
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null; // engine refused to construct one — stay silent forever
  }
  return ctx;
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Nudge the shared AudioContext into the `running` state. Call from inside a
 * real user gesture (the shutter press) — that is the ONLY moment a browser
 * will honour it. Safe to call repeatedly and safe to call when audio is
 * unavailable; the returned promise never rejects.
 */
export function primeAudio(): void {
  if (!soundEnabled() || reducedMotion()) return;
  const c = context();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume().catch(() => { /* policy said no */ });
  } catch {
    // some engines throw on resume() outside a gesture — never fatal
  }
}

/**
 * Play a cue. Silently does nothing when WebAudio is unavailable, the context
 * is still blocked by autoplay policy, sound is muted, or the guest prefers
 * reduced motion. Callers never need to check, and never need to await.
 */
export function playCue(kind: CueKind): void {
  if (!soundEnabled() || reducedMotion()) return;
  const c = context();
  if (!c) return;
  try {
    // A context the browser has not unblocked yet renders nothing audible;
    // bail rather than queue oscillators that will fire in a batch on resume.
    // resume() is async, so `state` cannot have flipped by the time it returns
    // — request the unblock for NEXT time and skip this cue either way.
    if (c.state !== 'running') {
      void c.resume?.().catch(() => { /* still blocked — this cue is skipped */ });
      return;
    }
    const spec = cueSpec(kind);
    const t0 = c.currentTime;
    const t1 = t0 + spec.durationSec;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, t0);
    if (spec.endFreq !== spec.freq) osc.frequency.exponentialRampToValueAtTime(spec.endFreq, t1);
    // Attack fast, decay to (near) zero — a hard stop clicks.
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(spec.gain, t0 + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(amp);
    amp.connect(c.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
    osc.onended = () => {
      try { osc.disconnect(); amp.disconnect(); } catch { /* already torn down */ }
    };
  } catch {
    // WebAudio is a garnish — every failure here is a no-op by design.
  }
}
