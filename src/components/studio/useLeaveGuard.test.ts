/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The guard's DECISION is pure and therefore testable; the effects that wire it
 * to `beforeunload`/`popstate` are not (no jsdom in this suite — see CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';
import { shouldInterceptPop } from './useLeaveGuard';

describe('shouldInterceptPop', () => {
  it('intercepts a Back press only when there is unsaved work', () => {
    expect(shouldInterceptPop({ dirty: true, bypass: false, armed: true })).toBe(true);
    expect(shouldInterceptPop({ dirty: false, bypass: false, armed: true })).toBe(false);
  });

  it('stands down once the host has CONFIRMED leaving', () => {
    // Otherwise the guard would intercept the very navigation it was told to allow.
    expect(shouldInterceptPop({ dirty: true, bypass: true, armed: true })).toBe(false);
  });

  it('does nothing when the sentinel was never armed (pushState refused)', () => {
    expect(shouldInterceptPop({ dirty: true, bypass: false, armed: false })).toBe(false);
  });

  it('never intercepts when more than one reason to stand down applies', () => {
    for (const dirty of [true, false]) {
      for (const bypass of [true, false]) {
        for (const armed of [true, false]) {
          const expected = dirty && !bypass && armed;
          expect(shouldInterceptPop({ dirty, bypass, armed })).toBe(expected);
        }
      }
    }
  });
});
