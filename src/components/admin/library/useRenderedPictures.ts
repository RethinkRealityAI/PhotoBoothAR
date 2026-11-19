/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pictures for tiles that have none (most models made inside events never got
 * a thumbnail). Each model is rendered in THIS browser with the Studio's own
 * thumbnail renderer, one at a time, and kept as an object URL for the rest of
 * the session so both admin library pages share the work. Nothing is uploaded:
 * a picture becomes permanent when the piece is added to the library, which
 * renders and stores its own (libraryPictureBrowser).
 *
 * Browser-only — never import from a vitest file.
 */
import { useEffect, useState } from 'react';
import { captureGlbThumbnail } from '../../../lib/studio/glbThumb';
import { evictModel, isModelCached } from '../../../lib/glbCache';

const SIZE = 256;
/** model url → object URL, or null when it could not be drawn. */
const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();
const queue: string[] = [];
let running = false;
/** Urls something on screen is showing live (refcounted): never evict these. */
const held = new Map<string, number>();

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const url = queue.shift()!;
      if (cache.has(url)) continue;
      let pic: string | null = null;
      // Only free what this render loaded: a model already in the cache belongs
      // to whoever loaded it, and evicting it would blank their live view.
      const ours = !isModelCached(url);
      try {
        const blob = await captureGlbThumbnail(url, SIZE);
        pic = blob ? URL.createObjectURL(blob) : null;
      } catch {
        pic = null; // a broken model keeps its placeholder tile
      } finally {
        // One-off render: do not keep dozens of parsed meshes in memory.
        if (ours && !held.has(url)) evictModel(url);
      }
      cache.set(url, pic);
      for (const l of listeners) l();
    }
  } finally {
    running = false;
  }
}

/** Keep `url` out of eviction while a live 3D view of it is mounted. */
export function useHeldModel(url: string | null): void {
  useEffect(() => {
    if (url === null) return;
    held.set(url, (held.get(url) ?? 0) + 1);
    return () => {
      const n = (held.get(url) ?? 1) - 1;
      if (n <= 0) held.delete(url); else held.set(url, n);
    };
  }, [url]);
}

/**
 * `wanted`: model urls that need a picture. Returns url → picture for those
 * drawn so far (absent = still waiting or could not be drawn).
 */
export function useRenderedPictures(wanted: readonly string[]): ReadonlyMap<string, string> {
  const [, bump] = useState(0);
  const key = wanted.join('\n');

  useEffect(() => {
    const onDone = () => bump((n) => n + 1);
    listeners.add(onDone);
    for (const url of wanted) if (!cache.has(url) && !queue.includes(url)) queue.push(url);
    void pump();
    return () => { listeners.delete(onDone); };
    // `key` stands in for the array's contents (a new array each render).
  }, [key]);

  const out = new Map<string, string>();
  for (const url of wanted) {
    const pic = cache.get(url);
    if (pic) out.set(url, pic);
  }
  return out;
}
