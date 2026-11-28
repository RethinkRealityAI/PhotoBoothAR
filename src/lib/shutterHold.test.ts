import { describe, expect, it } from 'vitest';
import { holdStep, type HoldEvent, type HoldContext, type HoldEffect } from './shutterHold';

const video: HoldContext = { videoAllowed: true, recording: false };

/** Runs a sequence of events from idle and returns every effect fired. */
function run(events: HoldEvent[], ctx: HoldContext = video): HoldEffect[] {
  let state = 'idle' as Parameters<typeof holdStep>[0];
  const out: HoldEffect[] = [];
  for (const e of events) {
    const step = holdStep(state, e, ctx);
    state = step.state;
    if (step.effect !== 'none') out.push(step.effect);
  }
  return out;
}

describe('shutter: tap for a photo, hold for a video', () => {
  it('a quick tap takes one photo', () => {
    expect(run(['down', 'up'])).toEqual(['photo']);
  });
  it('holding past the threshold records, and letting go stops', () => {
    expect(run(['down', 'timer', 'up'])).toEqual(['startVideo', 'stopVideo']);
  });
  it('a hold never also takes a photo', () => {
    expect(run(['down', 'timer', 'up'])).not.toContain('photo');
  });
  it('without video on the plan, a long press is still just a photo', () => {
    expect(run(['down', 'timer', 'up'], { videoAllowed: false, recording: false })).toEqual(['photo']);
  });
  it('a press that slides off before the threshold does nothing', () => {
    expect(run(['down', 'cancel'])).toEqual([]);
  });
  it('a cancelled hold still stops its clip', () => {
    expect(run(['down', 'timer', 'cancel'])).toEqual(['startVideo', 'stopVideo']);
  });
  it('a press while a clip is still running stops it, and its release does nothing', () => {
    expect(run(['down', 'up'], { videoAllowed: true, recording: true })).toEqual(['stopVideo']);
  });
  it('a stray timer after release starts nothing', () => {
    expect(run(['down', 'up', 'timer'])).toEqual(['photo']);
  });
});
