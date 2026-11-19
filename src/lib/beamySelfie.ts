/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The timeline of Beamy's `Selfie` clip: pure numbers and envelopes, no React,
 * no three.js. BeamySelfie.tsx reads everything here, so the cue a flash or a
 * photo hangs off can never drift from the authored clip.
 *
 * WHERE THE NUMBERS COME FROM. The clip is authored in Blender at 24 fps (the
 * same rate as the nine other clips in public/mascot/beamy.glb) by the mascot
 * source script `selfie.py`, whose `CUE` frames are mirrored in
 * `SELFIE_FRAMES` below. Blender's glTF exporter writes a key on frame f at
 * t = f / 24 (frame 1 lands at 0.0417 s, the last frame is the clip duration),
 * so the cue seconds are frame / 24, NOT (frame - 1) / 24.
 *
 * The beats: shades drop on (shadesOn) · the arm sweeps up with the phone
 * (phoneUp) · lean in, bounce, shades slide down the nose for a cheeky
 * half-squint · held beat · SNAP · recoil + happy hop · the arm lowers and
 * the phone tucks away · he looks up as the photo beams above him (beamStart)
 * · settles into Idle's first pose (end).
 */

export const SELFIE_CLIP = 'Selfie';
export const SELFIE_FPS = 24;

/** Authored cue frames (mascot source selfie.py `CUE`). */
export const SELFIE_FRAMES = {
  shadesOn: 14,
  phoneUp: 30,
  snap: 52,
  beamStart: 84,
  end: 108,
} as const;

export type SelfieCue = keyof typeof SELFIE_FRAMES;

/** Seconds into the clip at which a frame's key plays (exporter: t = f / fps). */
export function frameToSeconds(frame: number): number {
  return frame / SELFIE_FPS;
}

/** Clip duration in seconds (4.5). Matches the GLB animation's max key time. */
export const SELFIE_DURATION = frameToSeconds(SELFIE_FRAMES.end);

export interface SelfieTimeline {
  reducedMotion: boolean;
  /** Cue times in clip seconds. */
  cues: Record<SelfieCue, number>;
  /** Camera flash at the snap. Reduced motion: a slow, dim fade, never a strobe. */
  flash: { start: number; attack: number; decay: number; peak: number };
  /** The photo card. */
  photo: {
    /** Pops out of the phone. */
    appear: number;
    /** Done popping: hovers above the phone. */
    popped: number;
    /** Starts riding the beam (= cues.beamStart). Reduced motion: no flight. */
    flightStart: number;
    /** Reaches the top of the beam. */
    flightEnd: number;
    /** Starts fading. */
    fadeStart: number;
    /** Gone. */
    gone: number;
  };
  /** The column of light above him. Reduced motion: never drawn. */
  beam: { start: number; full: number; fadeStart: number; end: number };
  /** When the whole interaction (clip + photo flight) is over, in clip seconds. */
  total: number;
}

const CUES: Record<SelfieCue, number> = {
  shadesOn: frameToSeconds(SELFIE_FRAMES.shadesOn),
  phoneUp: frameToSeconds(SELFIE_FRAMES.phoneUp),
  snap: frameToSeconds(SELFIE_FRAMES.snap),
  beamStart: frameToSeconds(SELFIE_FRAMES.beamStart),
  end: frameToSeconds(SELFIE_FRAMES.end),
};

/**
 * How long the reduced-motion photo takes to glide to the wall (seconds): a
 * slow ease with no particles, so the content still happens, gently.
 */
export const REDUCED_GLIDE_S = 1.6;

/**
 * The landing page plays the Selfie clip this much faster than authored (the
 * owner: a faster intro). Cue times stay in clip seconds; the stage advances
 * the clip clock by `dt * SELFIE_SPEED`, so every cue keeps its beat.
 */
export const SELFIE_SPEED = 1.3;

/** The full timeline, or its reduced-motion variant (no strobe; the photo glides rather than flies). */
export function selfieTimeline(reducedMotion = false): SelfieTimeline {
  const c = CUES;
  if (reducedMotion) {
    // The card never rises or bounces in place; at flightStart the page hands
    // it to a slow glide to the wall that lasts REDUCED_GLIDE_S.
    const flightEnd = c.beamStart + REDUCED_GLIDE_S;
    return {
      reducedMotion,
      cues: { ...c },
      flash: { start: c.snap, attack: 0.35, decay: 0.6, peak: 0.3 },
      photo: {
        appear: c.snap + 0.2,
        popped: c.snap + 0.8,
        flightStart: c.beamStart,
        flightEnd,
        fadeStart: c.end - 0.2,
        gone: c.end + 0.6,
      },
      beam: { start: c.beamStart, full: c.beamStart, fadeStart: c.beamStart, end: c.beamStart },
      total: Math.max(c.end + 0.6, flightEnd),
    };
  }
  const flightEnd = c.beamStart + 1.25;
  return {
    reducedMotion,
    cues: { ...c },
    flash: { start: c.snap, attack: 0.04, decay: 0.32, peak: 1 },
    photo: {
      appear: c.snap + 0.1,
      popped: c.snap + 0.45,
      flightStart: c.beamStart,
      flightEnd,
      fadeStart: flightEnd - 0.4,
      gone: flightEnd,
    },
    beam: { start: c.beamStart - 0.15, full: c.beamStart + 0.1, fadeStart: flightEnd - 0.2, end: flightEnd + 0.25 },
    total: flightEnd + 0.25,
  };
}

export type SelfiePhase =
  | 'before' // not started (t < 0)
  | 'shades' // glasses dropping on
  | 'phoneUp' // arm sweeping the phone up
  | 'pose' // lean, bounce, cheeky look, held beat
  | 'snap' // the flash
  | 'celebrate' // recoil + hop, arm lowers
  | 'beam' // looking up while the photo rides the beam
  | 'settle' // clip over, photo finishing
  | 'done';

/** Which beat `t` (clip seconds) falls in. Boundaries belong to the later phase. */
export function selfiePhase(t: number, tl: SelfieTimeline = selfieTimeline()): SelfiePhase {
  const c = tl.cues;
  if (!(t >= 0)) return 'before'; // also catches NaN
  if (t < c.shadesOn) return 'shades';
  if (t < c.phoneUp) return 'phoneUp';
  if (t < c.snap) return 'pose';
  if (t < tl.flash.start + tl.flash.attack + tl.flash.decay) return 'snap';
  if (t < c.beamStart) return 'celebrate';
  if (t < c.end) return 'beam';
  if (t < tl.total) return 'settle';
  return 'done';
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => { const x = clamp01(v); return x * x * (3 - 2 * x); };

/** Flash overlay opacity at `t`, in [0, peak]. */
export function flashOpacity(t: number, tl: SelfieTimeline): number {
  const { start, attack, decay, peak } = tl.flash;
  if (!(t >= start) || t >= start + attack + decay) return 0;
  if (t < start + attack) {
    const k = (t - start) / attack;
    return peak * (tl.reducedMotion ? smooth(k) : k);
  }
  const k = (t - start - attack) / decay;
  // Full motion: a camera-flash exponential tail. Reduced: a symmetric ease.
  return peak * (tl.reducedMotion ? 1 - smooth(k) : (1 - k) * Math.exp(-3 * k));
}

export interface PhotoState {
  visible: boolean;
  opacity: number;
  scale: number;
  /** 0 = at the phone, 1 = hovering above it. */
  pop: number;
  /** 0 = hovering above the phone, 1 = top of the beam. Always 0 in reduced motion. */
  rise: number;
  /** Card tilt in degrees (a little playful wobble while it pops). */
  tiltDeg: number;
}

const easeOutBack = (v: number) => { const x = clamp01(v); const s = 1.6; return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2; };
const easeInOut = (v: number) => { const x = clamp01(v); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };

/** Where the photo card is at `t`. Positions are normalised; the component maps them to pixels. */
export function photoState(t: number, tl: SelfieTimeline): PhotoState {
  const p = tl.photo;
  if (!(t >= p.appear) || t >= p.gone) return { visible: false, opacity: 0, scale: 0, pop: 0, rise: 0, tiltDeg: 0 };
  const popK = clamp01((t - p.appear) / (p.popped - p.appear));
  const fade = t < p.fadeStart ? 1 : 1 - clamp01((t - p.fadeStart) / (p.gone - p.fadeStart));
  if (tl.reducedMotion) {
    // No flight, no bounce: it fades in beside him, rests, fades out.
    return { visible: true, opacity: smooth(popK) * fade, scale: 1, pop: 1, rise: 0, tiltDeg: 0 };
  }
  const rise = p.flightEnd > p.flightStart ? easeInOut((t - p.flightStart) / (p.flightEnd - p.flightStart)) : 0;
  return {
    visible: true,
    opacity: clamp01(popK * 3) * fade,
    scale: Math.max(0, easeOutBack(popK)) * (1 - 0.25 * rise),
    pop: easeOutBack(popK),
    rise,
    tiltDeg: (1 - popK) * -14 + Math.sin(t * 5) * 3 * (1 - rise),
  };
}

/** Opacity of the light column above him. Always 0 in reduced motion. */
export function beamOpacity(t: number, tl: SelfieTimeline): number {
  if (tl.reducedMotion) return 0;
  const b = tl.beam;
  if (!(t >= b.start) || t >= b.end) return 0;
  if (t < b.full) return smooth((t - b.start) / (b.full - b.start));
  if (t < b.fadeStart) return 1;
  return 1 - smooth((t - b.fadeStart) / (b.end - b.fadeStart));
}
