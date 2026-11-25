/**
 * Booth camera health: when a live camera must be re-opened (pure, tested).
 *
 * A phone takes the camera away in more ways than `track.onended`:
 *  - Leaving the tab: Android/iOS MUTE the track (no frames) and normally
 *    unmute it on return. When another tab or app kept the camera, the track
 *    stays muted forever: the picture freezes or goes dark until a refresh.
 *  - The OS ends the track while the tab is hidden. Re-opening it right away
 *    (getUserMedia from a hidden page) can hang or be refused, so the reopen
 *    waits until the guest is back.
 *  - The element stops getting frames with nothing reported at all.
 *
 * useCameraStream samples the camera about once a second and asks this module
 * what to do. Nothing here touches the DOM.
 */

/** A muted track that has not come back within this long is re-opened. */
export const MUTE_GRACE_MS = 2_500;
/** No new camera frame for this long: nudge the element with play(). */
export const STALL_PLAY_MS = 1_500;
/** Still no frame this long: re-open the camera. */
export const STALL_REACQUIRE_MS = 4_000;
/** Never re-open more often than this (a camera that will not come back must not loop). */
export const REACQUIRE_MIN_GAP_MS = 5_000;
/** After this many re-opens with no healthy picture in between, stop and leave it to the guest. */
export const MAX_REACQUIRES_IN_A_ROW = 4;

export interface CameraHealthSample {
  /** document.visibilityState === 'visible' */
  visible: boolean;
  /** The video track's readyState, or null when there is no stream/track. */
  track: 'live' | 'ended' | null;
  /** How long the track has been muted (0 = not muted). */
  mutedForMs: number;
  /** How long since the element last showed a new frame. */
  frameStalledMs: number;
  /** Time since the last re-open (Infinity = never). */
  sinceReacquireMs: number;
  /** Re-opens since the picture was last healthy. */
  reacquiresInARow: number;
}

export type CameraHealthAction = 'ok' | 'wait' | 'play' | 'reacquire' | 'give-up';

/** Why a re-open happens (logged with the incident). */
export type CameraReacquireReason = 'ended' | 'muted' | 'stalled';

export interface CameraHealthVerdict {
  action: CameraHealthAction;
  reason?: CameraReacquireReason;
}

export function cameraHealthVerdict(s: CameraHealthSample): CameraHealthVerdict {
  // A hidden page never re-opens (it can hang or be refused there) and a
  // hidden page's camera is expected to be muted/stalled.
  if (!s.visible) return { action: 'wait' };

  let reason: CameraReacquireReason | undefined;
  if (s.track === null || s.track === 'ended') reason = 'ended';
  else if (s.mutedForMs >= MUTE_GRACE_MS) reason = 'muted';
  else if (s.mutedForMs === 0 && s.frameStalledMs >= STALL_REACQUIRE_MS) reason = 'stalled';

  if (reason === undefined) {
    // Muted but within grace: the OS usually hands it back on its own.
    if (s.mutedForMs > 0) return { action: 'wait' };
    return s.frameStalledMs >= STALL_PLAY_MS ? { action: 'play' } : { action: 'ok' };
  }
  if (s.reacquiresInARow >= MAX_REACQUIRES_IN_A_ROW) return { action: 'give-up', reason };
  if (s.sinceReacquireMs < REACQUIRE_MIN_GAP_MS) return { action: 'wait', reason };
  return { action: 'reacquire', reason };
}

/**
 * The watchdog's own clock can be late (a long main-thread task, a throttled
 * tab). A late tick must not read as a frozen camera: the frame callbacks were
 * blocked by the same task. True when this tick came on time.
 */
export function tickIsTrustworthy(sinceLastTickMs: number, periodMs: number): boolean {
  return sinceLastTickMs <= periodMs * 2;
}
