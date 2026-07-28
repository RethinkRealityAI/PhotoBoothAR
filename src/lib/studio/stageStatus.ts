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
  if (!i.camReady) return { tone: 'warn', text: 'Starting camera', live: false };
  if (!i.trackerNeeded) return null;
  // Kept SHORT on purpose: the chip shares one band with the mode switcher, and
  // longer copy truncated to "Loading fa…" at the stage's real width.
  if (!i.trackerReady) return { tone: 'warn', text: 'Loading tracker', live: false };
  if (!i.faceVisible) return { tone: 'info', text: 'No face yet', live: true };
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
