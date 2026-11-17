import { describe, expect, it } from 'vitest';
import {
  analysedFrameAfterPass,
  analysedFrameHandOver,
  analysedFrameMarkHeld,
  analysedFrameNeedsHold,
  createAnalysedFrameSync,
  pickAnalysedFrame,
} from './analysedFrame';

/**
 * The 8th Wall draw canvas is redrawn by EVERY pipeline pass, on the engine's own
 * rAF loop, while the pose reaches the app only through poll(). Without a hold, a
 * pass that runs after poll() but before the compositor draws shows frame N+1
 * under pose N: the drawn frame leads the pose by one sample.
 */
describe('analysed-frame / pose pairing (xr8 frame lock)', () => {
  it('before any handover the live canvas is used (old behaviour)', () => {
    const s = createAnalysedFrameSync();
    expect(pickAnalysedFrame(s)).toBe('live');
    analysedFrameAfterPass(s, 10, true);
    expect(pickAnalysedFrame(s)).toBe('live');
    expect(analysedFrameNeedsHold(s)).toBe(false);
  });

  it('a pass after poll() must not advance the drawn frame past the handed sample', () => {
    const s = createAnalysedFrameSync();
    analysedFrameAfterPass(s, 10, true); // pass emits sample t=10, canvas = its frame
    analysedFrameHandOver(s, 10); // poll() hands t=10 over
    expect(pickAnalysedFrame(s)).toBe('live'); // canvas matches
    // The next pass is about to redraw: hold the handed frame first.
    expect(analysedFrameNeedsHold(s)).toBe(true);
    analysedFrameMarkHeld(s);
    expect(analysedFrameNeedsHold(s)).toBe(false); // once per handed sample
    analysedFrameAfterPass(s, 20, true); // canvas now shows t=20's frame, not yet handed
    expect(pickAnalysedFrame(s)).toBe('held'); // the frame of t=10, the pose the app holds
    analysedFrameHandOver(s, 20);
    expect(pickAnalysedFrame(s)).toBe('live');
  });

  it('a pass that draws a new frame with no face sample also counts as advancing', () => {
    const s = createAnalysedFrameSync();
    analysedFrameAfterPass(s, 10, true);
    analysedFrameHandOver(s, 10);
    analysedFrameMarkHeld(s);
    analysedFrameAfterPass(s, null, true);
    expect(pickAnalysedFrame(s)).toBe('held');
  });

  it('a repeat pass (no new frame, no sample) leaves the live canvas matching', () => {
    const s = createAnalysedFrameSync();
    analysedFrameAfterPass(s, 10, true);
    analysedFrameHandOver(s, 10);
    analysedFrameAfterPass(s, null, false);
    expect(pickAnalysedFrame(s)).toBe('live');
  });

  it('two emissions before one poll hand over the newer, whose frame is live', () => {
    const s = createAnalysedFrameSync();
    analysedFrameAfterPass(s, 10, true);
    analysedFrameAfterPass(s, 20, true);
    analysedFrameHandOver(s, 20);
    expect(pickAnalysedFrame(s)).toBe('live');
  });

  it('a handed sample whose frame was never held falls back to the live canvas', () => {
    const s = createAnalysedFrameSync();
    analysedFrameAfterPass(s, 10, true);
    analysedFrameHandOver(s, 10);
    // the hold copy failed (no 2D context): markHeld never ran
    analysedFrameAfterPass(s, 20, true);
    expect(pickAnalysedFrame(s)).toBe('live');
  });
});
