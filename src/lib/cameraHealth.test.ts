import { describe, expect, it } from 'vitest';
import {
  cameraHealthVerdict, tickIsTrustworthy, MAX_REACQUIRES_IN_A_ROW, MUTE_GRACE_MS,
  REACQUIRE_MIN_GAP_MS, STALL_PLAY_MS, STALL_REACQUIRE_MS, type CameraHealthSample,
} from './cameraHealth';

const healthy: CameraHealthSample = {
  visible: true, track: 'live', mutedForMs: 0, frameStalledMs: 0,
  sinceReacquireMs: Number.POSITIVE_INFINITY, reacquiresInARow: 0,
};
const v = (p: Partial<CameraHealthSample>) => cameraHealthVerdict({ ...healthy, ...p });

describe('cameraHealthVerdict', () => {
  it('a live camera with fresh frames is ok', () => {
    expect(v({})).toEqual({ action: 'ok' });
  });

  it('never re-opens while the page is hidden, whatever the camera is doing', () => {
    expect(v({ visible: false, track: 'ended' }).action).toBe('wait');
    expect(v({ visible: false, mutedForMs: 60_000 }).action).toBe('wait');
    expect(v({ visible: false, frameStalledMs: 60_000 }).action).toBe('wait');
  });

  it('an ended or missing track is re-opened once the guest is back', () => {
    expect(v({ track: 'ended' })).toEqual({ action: 'reacquire', reason: 'ended' });
    expect(v({ track: null })).toEqual({ action: 'reacquire', reason: 'ended' });
  });

  it('a mute the OS hands back is waited out; one that sticks is re-opened', () => {
    expect(v({ mutedForMs: MUTE_GRACE_MS - 1, frameStalledMs: 60_000 }).action).toBe('wait');
    expect(v({ mutedForMs: MUTE_GRACE_MS })).toEqual({ action: 'reacquire', reason: 'muted' });
  });

  it('a frozen picture is nudged with play() first, then re-opened', () => {
    expect(v({ frameStalledMs: STALL_PLAY_MS - 1 }).action).toBe('ok');
    expect(v({ frameStalledMs: STALL_PLAY_MS }).action).toBe('play');
    expect(v({ frameStalledMs: STALL_REACQUIRE_MS })).toEqual({ action: 'reacquire', reason: 'stalled' });
  });

  it('re-opens are spaced out and stop after a run of failures', () => {
    expect(v({ track: 'ended', sinceReacquireMs: REACQUIRE_MIN_GAP_MS - 1 }).action).toBe('wait');
    expect(v({ track: 'ended', sinceReacquireMs: REACQUIRE_MIN_GAP_MS }).action).toBe('reacquire');
    expect(v({ track: 'ended', reacquiresInARow: MAX_REACQUIRES_IN_A_ROW }).action).toBe('give-up');
  });
});

describe('tickIsTrustworthy', () => {
  it('a late watchdog tick (long task) is not trusted', () => {
    expect(tickIsTrustworthy(1000, 1000)).toBe(true);
    expect(tickIsTrustworthy(2000, 1000)).toBe(true);
    expect(tickIsTrustworthy(2001, 1000)).toBe(false);
  });
});
