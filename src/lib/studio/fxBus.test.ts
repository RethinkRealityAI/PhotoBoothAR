import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearFxEmitters,
  clearFxSubscribers,
  emitFx,
  getFxEmitter,
  registerFxEmitter,
  subscribeFx,
  unregisterFxEmitter,
  type FxEvent,
} from './fxBus';
import { makeBeamSpec } from './beam';

const event = (): FxEvent => ({
  kind: 'beam',
  spec: makeBeamSpec({ type: 'beam', style: 'optic' }, null, false, 0),
});

afterEach(() => {
  clearFxSubscribers();
  clearFxEmitters();
});

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

describe('fx emitter registry', () => {
  it('resolves the registered object, null when nothing is registered', () => {
    const obj = {};
    const off = registerFxEmitter('obj-1', obj);
    expect(getFxEmitter('obj-1')).toBe(obj);
    expect(getFxEmitter('obj-2')).toBeNull();
    off();
    expect(getFxEmitter('obj-1')).toBeNull();
  });

  it('stacks per key: the most recent registrant wins, unregistering restores', () => {
    // The Power-Ups modal mounting over a live preview registers the same
    // conceptual key; closing the modal must hand the key back.
    const stage = {};
    const modal = {};
    registerFxEmitter('k', stage);
    const offModal = registerFxEmitter('k', modal);
    expect(getFxEmitter('k')).toBe(modal);
    offModal();
    expect(getFxEmitter('k')).toBe(stage);
    unregisterFxEmitter('k', stage);
    expect(getFxEmitter('k')).toBeNull();
  });

  it('unregistering an unknown object or key is a no-op', () => {
    const obj = {};
    registerFxEmitter('k', obj);
    unregisterFxEmitter('k', {});
    unregisterFxEmitter('other', obj);
    expect(getFxEmitter('k')).toBe(obj);
  });
});
