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
