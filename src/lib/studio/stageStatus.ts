/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE status line for the studio stage.
 *
 * The stage used to carry three independent things that all reported on the
 * same underlying state: a permanent instructional caption (seven different
 * strings), a trigger-testing chip, and a centred "Loading face tracker…" pill
 * — and the chip and the pill could render that identical string at the same
 * time, in two places, which reads as a bug. Worse, most of the copy was
 * instruction ("Drag to place · scroll to scale") that a host needs once and
 * then has to look past forever, printed over the artwork they are judging.
 *
 * So: this returns AT MOST ONE status, and returns null whenever there is
 * genuinely nothing worth saying — which is the common case, and the point.
 * Nothing here is instruction; it is all live state the host cannot otherwise
 * see (is the camera up, is the tracker loaded, is my face found).
 */

export type StageStatusTone = 'error' | 'warn' | 'ok' | 'info';

export interface StageStatus {
  tone: StageStatusTone;
  text: string;
  /** True when the message reports a live tracking state (drives the pulse dot). */
  live: boolean;
}

export interface StageStatusInput {
  /** Camera error text, if the stream failed. */
  camError: string | null;
  /** Camera stream is running. */
  camReady: boolean;
  /** Does the CURRENT view actually use the face tracker? */
  trackerNeeded: boolean;
  /** MediaPipe landmarker has finished loading. */
  trackerReady: boolean;
  /** A face is currently detected. */
  faceVisible: boolean;
  /** Transient message (e.g. a trigger fired) — outranks steady state. */
  toast: string | null;
  /**
   * The scene actually needs a FACE. Absent = true (every pre-Power-Ups
   * caller). A hand-only scene — a lone wand, no face triggers — passes false
   * so the chip never coaches a face nothing is tracking.
   */
  faceNeeded?: boolean;
  /** The scene needs a HAND (hand-gesture triggers or hand-anchored gear). */
  handNeeded?: boolean;
  /** A hand is currently detected (only meaningful when handNeeded). */
  handVisible?: boolean;
  /**
   * The label of a trigger source that JUST fired (triggers.TRIGGER_SOURCE_LABELS
   * — 'Pinch', 'Hand to temple', …), or null/'' for none. Transient, like
   * `toast`.
   *
   * This is the only confirmation a host gets that a gesture registered when
   * the action has no words of its own: a burst fires confetti and an
   * in-preview beam erupts, but neither says WHICH gesture set it off — so a
   * gesture that never fires and a gesture that fires an invisible effect
   * looked identical.
   */
  gesture?: string | null;
}

/**
 * Highest-priority thing worth telling the host right now, or null for silence.
 *
 * Order is deliberate: a transient event the host just caused outranks steady
 * state, a broken camera outranks everything else, and "all good" is only worth
 * saying while the tracker is the thing being used.
 */
export function stageStatus(i: StageStatusInput): StageStatus | null {
  if (i.toast) return { tone: 'info', text: i.toast, live: false };
  if (i.camError) return { tone: 'error', text: i.camError, live: false };
  // Below camError deliberately: a gesture chip lingers ~1.6s, and a camera that
  // died in that window must not be hidden behind a stale success. Compared to
  // null explicitly — an empty label is "no gesture", not a blank chip.
  if (i.gesture != null && i.gesture !== '') {
    return { tone: 'ok', text: `${i.gesture} detected`, live: false };
  }
  if (!i.camReady) return { tone: 'warn', text: 'Starting camera', live: false };
  if (!i.trackerNeeded) return null;
  // Kept SHORT on purpose: the chip shares one band with the mode switcher, and
  // longer copy truncated to "Loading fa…" at the stage's real width.
  if (!i.trackerReady) return { tone: 'warn', text: 'Loading tracker', live: false };

  // BOTH families can be in play at once (a visor on the face, a wand in the
  // hand). Reporting only the first unmet one left the host fixing their face
  // while the chip said nothing about the hand that was also missing — and then
  // claiming a bare "Tracking" that never said WHICH tracker was up.
  const faceWanted = i.faceNeeded ?? true;
  const handWanted = i.handNeeded === true;
  const faceMissing = faceWanted && !i.faceVisible;
  const handMissing = handWanted && i.handVisible !== true;
  if (faceMissing && handMissing) return { tone: 'info', text: 'No face or hand', live: true };
  if (faceMissing) return { tone: 'info', text: 'No face yet', live: true };
  if (handMissing) return { tone: 'info', text: 'No hand yet', live: true };
  if (faceWanted && handWanted) return { tone: 'ok', text: 'Face + hand', live: true };
  return { tone: 'ok', text: 'Tracking', live: true };
}

/** Tailwind text colour per tone — kept beside the logic so tone and colour
 *  cannot drift apart across files. */
export const STAGE_STATUS_TONE_CLASS: Record<StageStatusTone, string> = {
  error: 'text-rose-300',
  warn: 'text-amber-300',
  ok: 'text-emerald-300',
  info: 'text-brand-muted',
};

/** Dot colour per tone (the small pulse beside the text). */
export const STAGE_STATUS_DOT_CLASS: Record<StageStatusTone, string> = {
  error: 'bg-rose-400',
  warn: 'bg-amber-400',
  ok: 'bg-emerald-400',
  info: 'bg-[color:var(--color-accent)]',
};
