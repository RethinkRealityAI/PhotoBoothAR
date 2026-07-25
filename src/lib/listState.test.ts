import { describe, it, expect } from 'vitest';
import { listState } from './listState';

describe('listState', () => {
  it('reports loading before the first fetch completes', () => {
    expect(listState({ count: 0, loaded: false, failed: false })).toBe('loading');
  });

  it('reports empty only after a successful zero-row read', () => {
    expect(listState({ count: 0, loaded: true, failed: false })).toBe('empty');
  });

  it('reports failed instead of empty when the fetch failed', () => {
    // The regression this module exists to prevent: a failed fetch rendering
    // the empty state, so the wall claims nobody has posted.
    expect(listState({ count: 0, loaded: true, failed: true })).toBe('failed');
  });

  it('reports failed rather than loading when the very first fetch failed', () => {
    expect(listState({ count: 0, loaded: false, failed: true })).toBe('failed');
  });

  it('keeps showing rows when a later refresh fails', () => {
    expect(listState({ count: 12, loaded: true, failed: true })).toBe('ready');
  });

  it('treats any row count above zero as ready', () => {
    expect(listState({ count: 1, loaded: false, failed: false })).toBe('ready');
  });
});
