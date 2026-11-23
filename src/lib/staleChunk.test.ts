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

import { loadWithStaleReload, type StaleReloadDeps } from './staleChunk';

function fakeDeps(lastReloadAt: number | null, now = 100_000) {
  const calls = { reloads: 0, marked: [] as number[] };
  const deps: StaleReloadDeps = {
    now: () => now,
    readLastReload: () => lastReloadAt,
    markReload: (at) => { calls.marked.push(at); },
    reload: () => { calls.reloads += 1; },
  };
  return { deps, calls };
}

/** Resolves to 'pending' when `p` has not settled after a macrotask. */
async function settledOrPending<T>(p: Promise<T>): Promise<'pending' | { ok: T } | { err: unknown }> {
  const tick = new Promise<'pending'>((r) => setTimeout(() => r('pending'), 10));
  return Promise.race([p.then((ok) => ({ ok }), (err) => ({ err })), tick]);
}

describe('loadWithStaleReload (lazy route chunks)', () => {
  const stale = new TypeError('Failed to fetch dynamically imported module: https://beamwall.app/assets/BeamyPage-abc.js');

  it('passes a loaded module straight through', async () => {
    const { deps, calls } = fakeDeps(null);
    const mod = { default: 'Page' };
    expect(await settledOrPending(loadWithStaleReload(async () => mod, deps))).toEqual({ ok: mod });
    expect(calls.reloads).toBe(0);
  });

  it('reloads once on a stale chunk and keeps the route waiting (no error flash)', async () => {
    const { deps, calls } = fakeDeps(null, 123_456);
    expect(await settledOrPending(loadWithStaleReload(() => Promise.reject(stale), deps))).toBe('pending');
    expect(calls.reloads).toBe(1);
    expect(calls.marked).toEqual([123_456]);
  });

  it('does not loop: a second stale failure inside the cooldown reaches the error boundary', async () => {
    const { deps, calls } = fakeDeps(100_000 - 1_000, 100_000);
    expect(await settledOrPending(loadWithStaleReload(() => Promise.reject(stale), deps))).toEqual({ err: stale });
    expect(calls.reloads).toBe(0);
  });

  it('reloads again once the cooldown has passed, and treats unreadable storage as never', async () => {
    const after = fakeDeps(100_000 - STALE_RELOAD_COOLDOWN_MS, 100_000);
    expect(await settledOrPending(loadWithStaleReload(() => Promise.reject(stale), after.deps))).toBe('pending');
    expect(after.calls.reloads).toBe(1);
    const nan = fakeDeps(Number.NaN);
    expect(await settledOrPending(loadWithStaleReload(() => Promise.reject(stale), nan.deps))).toBe('pending');
    expect(nan.calls.reloads).toBe(1);
  });

  it('never reloads for an ordinary bug', async () => {
    const { deps, calls } = fakeDeps(null);
    const bug = new Error('boom');
    expect(await settledOrPending(loadWithStaleReload(() => Promise.reject(bug), deps))).toEqual({ err: bug });
    expect(calls.reloads).toBe(0);
  });

  it('waits when the window listener already cancelled the error and is reloading', async () => {
    const { deps, calls } = fakeDeps(null);
    expect(await settledOrPending(loadWithStaleReload(async () => undefined, deps))).toBe('pending');
    expect(calls.reloads).toBe(0);
  });
});
