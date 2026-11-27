/**
 * Pure camera-health state machine for booth telemetry. It OBSERVES — it never
 * restarts or touches the camera (useCameraStream owns that). Feed it signals
 * from the stream, its video track and the <video> element; it returns the
 * events worth recording.
 *
 * What it is built to catch (Dapo, Nov 25 2026):
 *   - the feed going dark after a tab switch and never coming back
 *     (`camera_stuck`: lost for STUCK_AFTER_MS while the page is visible);
 *   - the feed flashing in and out while switching looks
 *     (`camera_flapping`: FLAP_STARTS camera (re)starts within FLAP_WINDOW_MS,
 *     not counting starts the guest asked for, like a camera flip).
 * Every loss and recovery is also emitted (`camera_lost` / `camera_regained`)
 * so a session's timeline shows exactly how long each outage lasted.
 */

export type LostReason = 'track_ended' | 'track_muted' | 'frozen' | 'no_picture';

export type CameraSignal =
  | { type: 'stream_start'; expected?: boolean; info?: Record<string, string | number | boolean | null> }
  | { type: 'stream_stop' }
  | { type: 'track_ended' }
  | { type: 'track_muted' }
  | { type: 'track_unmuted' }
  | { type: 'frames_stalled' }
  | { type: 'frames_flowing' }
  | { type: 'no_picture' }
  | { type: 'hidden' }
  | { type: 'visible' }
  | { type: 'tick' };

export type CameraEmitName =
  | 'camera_started' | 'camera_lost' | 'camera_regained'
  | 'camera_flapping' | 'camera_stuck' | 'camera_page_visible';

export interface CameraEmit {
  name: CameraEmitName;
  props: Record<string, string | number | boolean | null>;
  /** Worth a client_errors row (the Supabase copy), not just an analytics event. */
  incident: boolean;
}

export interface CameraWatchState {
  status: 'idle' | 'live' | 'lost';
  hidden: boolean;
  lostAt: number | null;
  lostReason: LostReason | null;
  lostWhileHidden: boolean;
  /** Unrequested (re)starts inside the flap window (ms timestamps). */
  starts: number[];
  totalStarts: number;
  totalLosses: number;
  stuckReported: boolean;
  lastFlapAt: number | null;
}

export const FLAP_WINDOW_MS = 20_000;
export const FLAP_STARTS = 3;
export const FLAP_COOLDOWN_MS = 60_000;
export const STUCK_AFTER_MS = 5_000;

export function initialCameraWatch(): CameraWatchState {
  return {
    status: 'idle', hidden: false, lostAt: null, lostReason: null, lostWhileHidden: false,
    starts: [], totalStarts: 0, totalLosses: 0, stuckReported: false, lastFlapAt: null,
  };
}

export function stepCameraWatch(
  s: CameraWatchState, sig: CameraSignal, now: number,
): { state: CameraWatchState; emits: CameraEmit[] } {
  const emits: CameraEmit[] = [];
  let st: CameraWatchState = s;

  const lose = (reason: LostReason) => {
    if (st.status !== 'live') return;
    st = {
      ...st, status: 'lost', lostAt: now, lostReason: reason, lostWhileHidden: st.hidden,
      totalLosses: st.totalLosses + 1, stuckReported: false,
    };
    emits.push({
      name: 'camera_lost',
      props: { reason, hidden: st.hidden, losses: st.totalLosses },
      incident: false,
    });
  };
  const regain = (how: string) => {
    if (st.status !== 'lost') return;
    const outageMs = st.lostAt !== null ? now - st.lostAt : null;
    emits.push({
      name: 'camera_regained',
      props: { how, reason: st.lostReason, outage_ms: outageMs, while_hidden: st.lostWhileHidden },
      incident: false,
    });
    st = { ...st, status: 'live', lostAt: null, lostReason: null, lostWhileHidden: false, stuckReported: false };
  };

  switch (sig.type) {
    case 'stream_start': {
      const starts = sig.expected
        ? st.starts.filter((t) => now - t < FLAP_WINDOW_MS)
        : [...st.starts.filter((t) => now - t < FLAP_WINDOW_MS), now];
      st = { ...st, starts, totalStarts: st.totalStarts + 1 };
      emits.push({
        name: 'camera_started',
        props: { n: st.totalStarts, expected: sig.expected === true, ...(sig.info ?? {}) },
        incident: false,
      });
      if (st.status === 'lost') regain('restart');
      st = { ...st, status: 'live' };
      if (
        starts.length >= FLAP_STARTS &&
        (st.lastFlapAt === null || now - st.lastFlapAt >= FLAP_COOLDOWN_MS)
      ) {
        st = { ...st, lastFlapAt: now };
        emits.push({
          name: 'camera_flapping',
          props: { starts_in_window: starts.length, window_ms: FLAP_WINDOW_MS },
          incident: true,
        });
      }
      break;
    }
    case 'stream_stop':
      // A stop on its own is not a loss: a flip, a mode change and unmount all
      // stop the stream on purpose. Losses come from the track and the picture.
      if (st.status === 'live') st = { ...st, status: 'idle' };
      break;
    case 'track_ended': lose('track_ended'); break;
    case 'track_muted':
      // iOS mutes the camera of a backgrounded tab; that is expected. It only
      // counts when the page is in front of the guest.
      if (!st.hidden) lose('track_muted');
      break;
    case 'frames_stalled': if (!st.hidden) lose('frozen'); break;
    case 'no_picture': if (!st.hidden) lose('no_picture'); break;
    case 'track_unmuted': regain('unmuted'); break;
    case 'frames_flowing': regain('frames'); break;
    case 'hidden': st = { ...st, hidden: true }; break;
    case 'visible':
      st = { ...st, hidden: false };
      emits.push({ name: 'camera_page_visible', props: { status: st.status }, incident: false });
      break;
    case 'tick':
      if (
        st.status === 'lost' && !st.hidden && !st.stuckReported &&
        st.lostAt !== null && now - st.lostAt >= STUCK_AFTER_MS
      ) {
        st = { ...st, stuckReported: true };
        emits.push({
          name: 'camera_stuck',
          props: {
            reason: st.lostReason, lost_ms: now - st.lostAt,
            while_hidden: st.lostWhileHidden, losses: st.totalLosses, starts: st.totalStarts,
          },
          incident: true,
        });
      }
      break;
  }
  return { state: st, emits };
}

/**
 * Has the picture moved since the last check? Pure.
 *
 * The decoded-frame counter (getVideoPlaybackQuality) is the better signal
 * where it works: on Chrome a frozen MediaStream can keep advancing
 * currentTime. But it is only trusted once it has been SEEN to advance on this
 * stream (`counterProven`). Chrome on iOS reports a counter that never moves
 * for a live camera, so trusting it from the start flagged every iOS Chrome
 * booth as "frozen" 2 s after the camera opened (#144). Until the counter proves itself, currentTime decides.
 */
export function framesAdvanced(
  prev: { frames: number | null; time: number } | null,
  cur: { frames: number | null; time: number },
  counterProven = false,
): boolean {
  if (prev === null) return true;
  if (cur.frames !== null && prev.frames !== null) {
    if (cur.frames > prev.frames) return true;
    if (counterProven) return false;
  }
  return cur.time !== prev.time;
}
