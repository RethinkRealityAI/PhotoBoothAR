/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The platform booth's one capture button: TAP for a photo, PRESS AND HOLD to
 * record a video, let go to stop (Dapo, Nov 28 2026: "hold to record, tap to
 * snap", replacing the Photo / Video switch).
 *
 * Pure, so the rules are tested rather than buried in pointer handlers. The
 * component feeds it pointer events and a hold timer, and carries out the
 * effect it returns.
 */

/** How long a press must last before it becomes a recording. Long enough that
 *  a firm tap is never a video, short enough that a hold feels instant. */
export const HOLD_TO_RECORD_MS = 320;

export type HoldState = 'idle' | 'pressed' | 'held';
export type HoldEvent = 'down' | 'timer' | 'up' | 'cancel';
export type HoldEffect = 'none' | 'photo' | 'startVideo' | 'stopVideo';

export interface HoldContext {
  /** The plan allows video. Without it a hold is just a slow tap. */
  videoAllowed: boolean;
  /** A clip is recording right now (or its microphone is opening). */
  recording: boolean;
}

export interface HoldStep {
  state: HoldState;
  effect: HoldEffect;
}

/**
 * One step of the shutter gesture.
 *
 *   idle    --down-->   pressed            (start the hold timer)
 *   pressed --timer-->  held, startVideo   (only when video is allowed)
 *   pressed --up-->     idle, photo
 *   pressed --cancel--> idle               (the press slid away: nothing)
 *   held    --up/cancel--> idle, stopVideo (letting go ends the clip)
 *
 * A press that lands WHILE a clip records (one that kept going because the
 * finger left before the microphone was ready) stops it, and the release
 * after it does nothing.
 */
export function holdStep(state: HoldState, event: HoldEvent, ctx: HoldContext): HoldStep {
  switch (event) {
    case 'down':
      if (ctx.recording) return { state: 'idle', effect: 'stopVideo' };
      return { state: 'pressed', effect: 'none' };
    case 'timer':
      if (state === 'pressed' && ctx.videoAllowed) return { state: 'held', effect: 'startVideo' };
      return { state, effect: 'none' };
    case 'up':
      if (state === 'pressed') return { state: 'idle', effect: 'photo' };
      if (state === 'held') return { state: 'idle', effect: 'stopVideo' };
      return { state: 'idle', effect: 'none' };
    case 'cancel':
      if (state === 'held') return { state: 'idle', effect: 'stopVideo' };
      return { state: 'idle', effect: 'none' };
  }
}
