/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Still pictures for the booth's Effect tiles.
 *
 * The tiles used to show the guest's own face through each effect, live
 * (filterThumbEngine): a second WebGL context reading the camera eight times a
 * second for as long as the strip was on screen. On a phone that is already
 * running the camera, the face tracker, the 3D canvas and the compositor, that
 * cost frame rate the guest could feel (Dapo, Nov 28 2026).
 *
 * Now each effect is drawn ONCE over a sample portrait, kept as a small JPEG
 * data URL for the rest of the visit, and the WebGL context is released the
 * moment the queue is empty. Nothing here ever touches the camera, so it costs
 * the booth nothing after the first couple of frames.
 *
 * If WebGL or the sample image is missing, no still is produced and the tile
 * keeps its icon fallback.
 */
import { ShaderRunner } from '../../lib/shaders';

/** A vendored portrait (public/starters), cropped to the face. */
const SAMPLE_SRC = '/starters/soft-portrait.webp';
/** Face square inside the 540x960 sample, clear of its gold frame lines. */
const SAMPLE_CROP = { x: 120, y: 230, size: 300 } as const;
/** Tile pictures are 60px; 120 keeps them sharp on a 2x screen. */
const STILL_PX = 120;

const stills = new Map<string, string>();
const failed = new Set<string>();
const waiting = new Map<string, Set<(url: string) => void>>();
let sample: Promise<HTMLCanvasElement | null> | null = null;
let scheduled = false;

function loadSample(): Promise<HTMLCanvasElement | null> {
  if (sample) return sample;
  sample = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = STILL_PX;
      c.height = STILL_PX;
      const ctx = c.getContext('2d');
      if (!ctx) { resolve(null); return; }
      const { x, y, size } = SAMPLE_CROP;
      ctx.drawImage(img, x, y, size, size, 0, 0, STILL_PX, STILL_PX);
      resolve(c);
    };
    img.onerror = () => resolve(null);
    img.src = SAMPLE_SRC;
  });
  return sample;
}

async function drainQueue(): Promise<void> {
  scheduled = false;
  const ids = [...waiting.keys()].filter((id) => !stills.has(id) && !failed.has(id));
  if (ids.length === 0) return;
  const src = await loadSample();
  let runner: ShaderRunner | null = null;
  try {
    runner = src ? new ShaderRunner(STILL_PX, STILL_PX) : null;
  } catch {
    runner = null;
  }
  try {
    for (const id of ids) {
      let url: string | null = null;
      if (runner?.available && src) {
        const out = runner.draw(src, id);
        try { url = out ? out.toDataURL('image/jpeg', 0.85) : null; } catch { url = null; }
      }
      if (url === null) { failed.add(id); waiting.delete(id); continue; }
      stills.set(id, url);
      const subs = waiting.get(id);
      waiting.delete(id);
      subs?.forEach((cb) => cb(url));
    }
  } finally {
    // Released straight away: phones cap live WebGL contexts per page.
    runner?.dispose();
  }
  // Tiles that subscribed while this pass ran.
  if ([...waiting.keys()].some((id) => !stills.has(id) && !failed.has(id))) schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  // One pass for every tile that mounts in the same render.
  window.setTimeout(() => { void drainQueue(); }, 0);
}

/** The still for an effect, if it has been drawn already. */
export function effectStill(shaderId: string): string | null {
  return stills.get(shaderId) ?? null;
}

/**
 * Ask for an effect's still. `onReady` runs once it exists (never, if it can't
 * be drawn). Returns the unsubscribe function.
 */
export function requestEffectStill(shaderId: string, onReady: (url: string) => void): () => void {
  const have = stills.get(shaderId);
  if (have) { onReady(have); return () => {}; }
  if (failed.has(shaderId)) return () => {};
  let subs = waiting.get(shaderId);
  if (!subs) { subs = new Set(); waiting.set(shaderId, subs); }
  subs.add(onReady);
  schedule();
  return () => { waiting.get(shaderId)?.delete(onReady); };
}
