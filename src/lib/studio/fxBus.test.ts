import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFxSubscribers, emitFx, subscribeFx, type FxEvent } from './fxBus';
import { makeBeamSpec } from './beam';

const event = (): FxEvent => ({
  kind: 'beam',
  spec: makeBeamSpec({ type: 'beam', style: 'optic' }, null, false, 0),
});

afterEach(() => clearFxSubscribers());

describe('fxBus', () => {
  it('delivers to every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeFx(a);
    subscribeFx(b);
    const e = event();
    emitFx(e);
    expect(a).toHaveBeenCalledWith(e);
    expect(b).toHaveBeenCalledWith(e);
  });

  it('unsubscribe stops delivery, even when called during dispatch', () => {
    const calls: string[] = [];
    const unsubB: { fn: (() => void) | null } = { fn: null };
    subscribeFx(() => {
      calls.push('a');
      unsubB.fn?.();
    });
    unsubB.fn = subscribeFx(() => calls.push('b'));
    emitFx(event()); // snapshot iteration: b still sees THIS event
    emitFx(event()); // but not the next
    expect(calls).toEqual(['a', 'b', 'a']);
  });

  it('a throwing subscriber does not break the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = vi.fn();
    subscribeFx(() => {
      throw new Error('boom');
    });
    subscribeFx(good);
    expect(() => emitFx(event())).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
