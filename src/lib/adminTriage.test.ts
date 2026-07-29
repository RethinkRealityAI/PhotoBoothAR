/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  overallSeverity,
  triageHeadline,
  triageSignals,
  type TriageInput,
  type TriageSignal,
} from './adminTriage';

const base: TriageInput = {
  support: { open: 0, unread: 0 },
  recentOrders: [],
  ordersWindow: 50,
  liveEvents: 0,
};

const pick = (signals: TriageSignal[], id: string) => signals.find((s) => s.id === id)!;

describe('triageSignals — support', () => {
  it('treats an unread ticket as critical', () => {
    const s = pick(triageSignals({ ...base, support: { open: 3, unread: 2 } }), 'support');
    expect(s.severity).toBe('critical');
    expect(s.value).toBe('2');
    expect(s.detail).toBe('2 unread · 3 open');
  });

  it('treats open-but-read as a warning, not a fire', () => {
    const s = pick(triageSignals({ ...base, support: { open: 3, unread: 0 } }), 'support');
    expect(s.severity).toBe('warning');
    expect(s.value).toBe('3');
  });

  it('is calm only when there is genuinely nothing open', () => {
    expect(pick(triageSignals(base), 'support').severity).toBe('calm');
  });

  it('reports a failed read as unknown, never as all-clear', () => {
    const s = pick(triageSignals({ ...base, support: null }), 'support');
    expect(s.severity).toBe('unknown');
    expect(s.value).toBe('—');
    expect(s.detail).toContain('not "no tickets"');
  });
});

describe('triageSignals — money', () => {
  it('raises a dispute to critical', () => {
    const s = pick(triageSignals({
      ...base,
      recentOrders: [{ status: 'paid' }, { status: 'disputed' }, { status: 'refunded' }],
    }), 'money');
    expect(s.severity).toBe('critical');
    expect(s.value).toBe('1');
    expect(s.label).toBe('Disputes');
  });

  it('falls back to refunds as a warning when there is no dispute', () => {
    const s = pick(triageSignals({
      ...base,
      recentOrders: [{ status: 'paid' }, { status: 'refunded' }, { status: 'refunded' }],
    }), 'money');
    expect(s.severity).toBe('warning');
    expect(s.value).toBe('2');
  });

  it('scopes every claim to the window it actually scanned', () => {
    const s = pick(triageSignals({ ...base, recentOrders: [{ status: 'paid' }], ordersWindow: 50 }), 'money');
    expect(s.severity).toBe('calm');
    expect(s.detail).toBe('No disputes or refunds in the last 50 orders');
  });

  it('singularises a one-order window', () => {
    const s = pick(triageSignals({ ...base, recentOrders: [], ordersWindow: 1 }), 'money');
    expect(s.detail).toBe('No disputes or refunds in the last 1 order');
  });

  it('reports a failed read as unknown, never as no-disputes', () => {
    const s = pick(triageSignals({ ...base, recentOrders: null }), 'money');
    expect(s.severity).toBe('unknown');
    expect(s.detail).toContain('not "no disputes"');
  });
});

describe('triageSignals — live events', () => {
  it('never treats a live event as a fire', () => {
    const s = pick(triageSignals({ ...base, liveEvents: 8 }), 'live');
    expect(s.severity).toBe('calm');
    expect(s.detail).toBe('8 walls running');
  });

  it('singularises one wall', () => {
    expect(pick(triageSignals({ ...base, liveEvents: 1 }), 'live').detail).toBe('1 wall running');
  });

  it('distinguishes zero live events from an unreadable count', () => {
    expect(pick(triageSignals({ ...base, liveEvents: 0 }), 'live').severity).toBe('calm');
    expect(pick(triageSignals({ ...base, liveEvents: null }), 'live').severity).toBe('unknown');
  });
});

describe('triageSignals — shape', () => {
  it('always returns the same three signals in the same order', () => {
    expect(triageSignals(base).map((s) => s.id)).toEqual(['support', 'money', 'live']);
    expect(triageSignals({ support: null, recentOrders: null, ordersWindow: 0, liveEvents: null })
      .map((s) => s.id)).toEqual(['support', 'money', 'live']);
  });

  it('routes every signal to a screen that can act on it', () => {
    for (const s of triageSignals(base)) expect(s.to.startsWith('/admin/')).toBe(true);
  });
});

describe('overallSeverity', () => {
  it('is calm when everything is calm', () => {
    expect(overallSeverity(triageSignals(base))).toBe('calm');
  });

  it('lets a known fire outrank a blind spot', () => {
    const signals = triageSignals({ ...base, support: { open: 1, unread: 1 }, recentOrders: null });
    expect(overallSeverity(signals)).toBe('critical');
  });

  it('lets a blind spot outrank calm', () => {
    expect(overallSeverity(triageSignals({ ...base, recentOrders: null }))).toBe('unknown');
  });

  it('lets a warning outrank a blind spot', () => {
    const signals = triageSignals({ ...base, support: { open: 2, unread: 0 }, liveEvents: null });
    expect(overallSeverity(signals)).toBe('warning');
  });
});

describe('triageHeadline', () => {
  it('names what is on fire', () => {
    expect(triageHeadline(triageSignals({ ...base, support: { open: 1, unread: 1 } })))
      .toBe('Needs attention: support.');
  });

  it('names what is merely worth a look', () => {
    expect(triageHeadline(triageSignals({ ...base, recentOrders: [{ status: 'refunded' }] })))
      .toBe('Worth a look: refunds.');
  });

  it('refuses to call an unreadable strip clear', () => {
    const line = triageHeadline(triageSignals({ ...base, support: null }));
    expect(line).toContain('not clear');
  });

  it('says so plainly when there is nothing to do', () => {
    expect(triageHeadline(triageSignals(base))).toBe('Nothing needs attention.');
  });
});
