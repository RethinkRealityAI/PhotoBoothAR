import { describe, it, expect } from 'vitest';
import {
  initialCameraWatch, stepCameraWatch, framesAdvanced,
  FLAP_STARTS, FLAP_WINDOW_MS, STUCK_AFTER_MS, type CameraSignal, type CameraWatchState,
} from './cameraWatch';

function run(signals: Array<[CameraSignal, number]>, from: CameraWatchState = initialCameraWatch()) {
  let s = from;
  const names: string[] = [];
  const all = [];
  for (const [sig, t] of signals) {
    const r = stepCameraWatch(s, sig, t);
    s = r.state;
    for (const e of r.emits) { names.push(e.name); all.push(e); }
  }
  return { s, names, all };
}

describe('cameraWatch', () => {
  it('a normal start is live and emits camera_started only', () => {
    const { s, names } = run([[{ type: 'stream_start' }, 0]]);
    expect(s.status).toBe('live');
    expect(names).toEqual(['camera_started']);
  });

  it('dark after a tab switch: ended while hidden, never back → camera_stuck once visible for 5s', () => {
    const { names, all } = run([
      [{ type: 'stream_start' }, 0],
      [{ type: 'hidden' }, 1000],
      [{ type: 'track_ended' }, 1500],
      [{ type: 'visible' }, 10_000],
      [{ type: 'tick' }, 11_000],
      [{ type: 'tick' }, 10_000 + 1500 + STUCK_AFTER_MS],
      [{ type: 'tick' }, 30_000],
    ]);
    expect(names).toEqual(['camera_started', 'camera_lost', 'camera_page_visible', 'camera_stuck']);
    const stuck = all.find((e) => e.name === 'camera_stuck')!;
    expect(stuck.incident).toBe(true);
    expect(stuck.props.while_hidden).toBe(true);
    expect(stuck.props.reason).toBe('track_ended');
  });

  it('never reports stuck while the page is hidden', () => {
    const { names } = run([
      [{ type: 'stream_start' }, 0],
      [{ type: 'track_ended' }, 100],
      [{ type: 'hidden' }, 200],
      [{ type: 'tick' }, 60_000],
    ]);
    expect(names).not.toContain('camera_stuck');
  });

  it('a recovery reports the outage length', () => {
    const { all, s } = run([
      [{ type: 'stream_start' }, 0],
      [{ type: 'frames_stalled' }, 1000],
      [{ type: 'frames_flowing' }, 3500],
    ]);
    const back = all.find((e) => e.name === 'camera_regained')!;
    expect(back.props.outage_ms).toBe(2500);
    expect(back.props.reason).toBe('frozen');
    expect(s.status).toBe('live');
  });

  it('a re-acquire after a loss counts as regained via restart', () => {
    const { all } = run([
      [{ type: 'stream_start' }, 0],
      [{ type: 'track_ended' }, 1000],
      [{ type: 'stream_stop' }, 1001],
      [{ type: 'stream_start' }, 1800],
    ]);
    expect(all.find((e) => e.name === 'camera_regained')?.props.how).toBe('restart');
  });

  it('mute while hidden is expected (iOS background) and not a loss', () => {
    const { names } = run([
      [{ type: 'stream_start' }, 0],
      [{ type: 'hidden' }, 10],
      [{ type: 'track_muted' }, 20],
    ]);
    expect(names).not.toContain('camera_lost');
  });

  it(`flashing in and out: ${FLAP_STARTS} unrequested starts inside the window → one camera_flapping incident`, () => {
    const sig: Array<[CameraSignal, number]> = [];
    for (let i = 0; i < 6; i++) {
      sig.push([{ type: 'stream_start' }, i * 2000]);
      sig.push([{ type: 'stream_stop' }, i * 2000 + 1000]);
    }
    const { all } = run(sig);
    const flaps = all.filter((e) => e.name === 'camera_flapping');
    expect(flaps).toHaveLength(1); // cooldown keeps it to one report
    expect(flaps[0].incident).toBe(true);
  });

  it('guest-requested restarts (camera flip) never count as flapping', () => {
    const sig: Array<[CameraSignal, number]> = [];
    for (let i = 0; i < 6; i++) sig.push([{ type: 'stream_start', expected: i > 0 }, i * 1000]);
    expect(run(sig).names).not.toContain('camera_flapping');
  });

  it('starts spread wider than the window are not flapping', () => {
    const gap = FLAP_WINDOW_MS / 2 + 1;
    const sig: Array<[CameraSignal, number]> = [0, 1, 2, 3].map((i) => [{ type: 'stream_start' }, i * gap]);
    expect(run(sig).names).not.toContain('camera_flapping');
  });
});

describe('framesAdvanced', () => {
  it('uses the frame counter when both samples have one', () => {
    expect(framesAdvanced({ frames: 10, time: 1 }, { frames: 10, time: 2 })).toBe(false);
    expect(framesAdvanced({ frames: 10, time: 1 }, { frames: 11, time: 1 })).toBe(true);
  });
  it('falls back to currentTime', () => {
    expect(framesAdvanced({ frames: null, time: 1 }, { frames: null, time: 1 })).toBe(false);
    expect(framesAdvanced({ frames: null, time: 1 }, { frames: null, time: 1.03 })).toBe(true);
  });
  it('first sample counts as advancing', () => {
    expect(framesAdvanced(null, { frames: 0, time: 0 })).toBe(true);
  });
});
