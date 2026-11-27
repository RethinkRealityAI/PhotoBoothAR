/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A small promise cache for the CPU half of a world-mode board (the standee's
 * outline walls and its size), keyed by frame art URL.
 *
 * Building a board reads every pixel of the frame art and traces its outline:
 * tens of milliseconds of main-thread work on a phone. Done in the middle of a
 * clip, that is a visible stutter. The booth works these out ahead of time,
 * while the guest is not recording, so swapping the standing Frame mid-clip
 * only uploads a texture. The cache holds the PROMISE, so a preload and a real
 * build of the same frame share one run; a failed run is dropped so the next
 * ask retries. Oldest entries are evicted past `max` (each holds a few hundred
 * KB of vertex arrays, never the image itself).
 */
export class PromiseLru<V> {
  private readonly map = new Map<string, Promise<V>>();
  constructor(private readonly max: number) {}

  /** The cached promise for `key`, or `make()`'s, cached. */
  get(key: string, make: () => Promise<V>): Promise<V> {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      // Re-insert: most recently used goes last.
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const p = make();
    this.map.set(key, p);
    p.catch(() => { if (this.map.get(key) === p) this.map.delete(key); });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
    return p;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }
}
