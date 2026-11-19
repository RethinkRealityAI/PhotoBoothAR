import { describe, expect, it } from 'vitest';
import { isStaleChunkError } from './staleChunk';

describe('isStaleChunkError', () => {
  it('recognises each browser’s failed lazy import', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/glbOptimize-BYIPs5Nq.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new TypeError("Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\".")))
      .toBe(true);
    expect(isStaleChunkError('\'text/html\' is not a valid JavaScript MIME type.')).toBe(true);
  });

  it('leaves every other failure alone', () => {
    expect(isStaleChunkError(new Error('draco decoder missing'))).toBe(false);
    expect(isStaleChunkError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError({ message: 'Failed to fetch dynamically imported module' })).toBe(false);
  });
});

import { STALE_RELOAD_COOLDOWN_MS, shouldReloadForStaleChunk } from './staleChunk';

describe('shouldReloadForStaleChunk', () => {
  it('reloads host, admin and marketing pages once', () => {
    expect(shouldReloadForStaleChunk('/admin/library/import', null, 1_000)).toBe(true);
    expect(shouldReloadForStaleChunk('/host/studio', null, 1_000)).toBe(true);
    expect(shouldReloadForStaleChunk('/', null, 1_000)).toBe(true);
  });

  it('never reloads a guest mid-event', () => {
    expect(shouldReloadForStaleChunk('/e/gala/booth', null, 1_000)).toBe(false);
    expect(shouldReloadForStaleChunk('/e/gala', null, 1_000)).toBe(false);
    expect(shouldReloadForStaleChunk('/beam/abc', null, 1_000)).toBe(false);
    expect(shouldReloadForStaleChunk('/c/xyz/contribute', null, 1_000)).toBe(false);
    expect(shouldReloadForStaleChunk('/events', null, 1_000)).toBe(true); // a prefix, not a word match
  });

  it('does not loop: one reload per cooldown', () => {
    expect(shouldReloadForStaleChunk('/admin', 10_000, 10_000 + STALE_RELOAD_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldReloadForStaleChunk('/admin', 10_000, 10_000 + STALE_RELOAD_COOLDOWN_MS)).toBe(true);
    expect(shouldReloadForStaleChunk('/admin', Number.NaN, 5)).toBe(true);
  });
});
