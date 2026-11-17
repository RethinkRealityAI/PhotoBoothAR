/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Serving wall media at the size it is actually displayed at.
 *
 * Every wall tile, mosaic cell and My-Photos thumbnail rendered `post.image_url`
 * — the untouched 1080×1920 capture. A guest opening a wall with fifty moments
 * on it downloaded fifty full-resolution JPEGs onto a phone, over venue wifi,
 * to show them at ~200px wide. That is the single heaviest thing the guest
 * surface does.
 *
 * Supabase Storage can resize on the fly, at
 * `/storage/v1/render/image/public/<bucket>/<path>` instead of
 * `/storage/v1/object/public/<bucket>/<path>`. But image transformation is a
 * PAID plan feature, and this sandbox cannot reach the project to confirm it is
 * enabled — so this is written so that being wrong is free: `transformedUrl`
 * returns null for anything it does not recognise, and the component that uses
 * it falls back to the original on the first error. Nothing here can make a
 * wall show a broken image.
 */

/** Marks a Supabase public object URL and captures what follows the marker. */
const PUBLIC_OBJECT = '/storage/v1/object/public/';
const RENDER_IMAGE = '/storage/v1/render/image/public/';

export interface TransformOptions {
  /** Rendered width in CSS pixels — multiply by the DPR before calling. */
  width: number;
  /** 20-100. 70 is visually indistinguishable at thumbnail size. */
  quality?: number;
  /** 'cover' crops to fill, 'contain' fits inside. Tiles want cover. */
  resize?: 'cover' | 'contain';
}

/**
 * A resizing URL for a Supabase public image, or null when that isn't possible.
 *
 * Returns null for: videos (the transformer only handles images), non-Supabase
 * URLs (an uploaded external link, a data: URI), and URLs already pointing at
 * the render endpoint. Callers treat null as "use the original".
 */
export function transformedUrl(
  url: string | null | undefined,
  opts: TransformOptions,
): string | null {
  if (!url || typeof url !== 'string') return null;
  if (url.includes(RENDER_IMAGE)) return null; // already transformed
  const at = url.indexOf(PUBLIC_OBJECT);
  if (at === -1) return null;
  // Videos are stored in the same bucket and must never be routed through the
  // image transformer — it would 400 on every frame of a keepsake clip.
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return null;
  // A URL that already carries a query string is not one we built; leaving it
  // alone is safer than merging parameters we don't understand.
  if (url.includes('?')) return null;

  const width = Math.max(1, Math.round(opts.width));
  const quality = Math.min(100, Math.max(20, Math.round(opts.quality ?? 70)));
  const resize = opts.resize ?? 'cover';
  const rest = url.slice(at + PUBLIC_OBJECT.length);
  const origin = url.slice(0, at);
  return `${origin}${RENDER_IMAGE}${rest}?width=${width}&quality=${quality}&resize=${resize}`;
}

/**
 * The storage OBJECT KEY inside `bucket` for a Supabase public-object URL, or
 * null when `url` is not a public object of that bucket at that origin.
 *
 * This is the inverse of `getPublicUrl(path)`: given what a `posts` row stores
 * in `image_url`, it recovers the key `storage.remove([key])` needs. Deleting a
 * post row does NOT delete its object (Postgres cascades do not reach Storage),
 * so the delete paths have to reconstruct the key.
 *
 * MIRRORED — `supabase/functions/submit-post/index.ts` (`objectKeyForUrl`) runs
 * the same three rules server-side; Deno cannot import from src/, so this test
 * file is the contract both halves are written against. Change one, change both.
 *
 * Three deliberate rules:
 *  - `origin` is REQUIRED and matched as a literal prefix. An `indexOf` would
 *    accept `https://evil.example/x?u=/storage/v1/object/public/posts/a/b.jpg`
 *    and hand a caller a key it never stored.
 *  - the query/fragment is dropped, so a cache-busted URL still resolves.
 *  - the key is NOT percent-decoded. Every key this app writes is URL-safe
 *    (slug `[a-z0-9-]`, session `[A-Za-z0-9_-]`, uuid hex), so decoding could
 *    only ever turn `%2e%2e` into a traversal; a key that genuinely needed
 *    decoding fails the remove loudly instead of removing the wrong object.
 */
export function publicObjectPath(
  url: string | null | undefined,
  bucket: string,
  origin: string,
): string | null {
  if (!url || typeof url !== 'string' || !bucket || !origin) return null;
  const prefix = `${origin.replace(/\/+$/, '')}${PUBLIC_OBJECT}${bucket}/`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const cut = rest.search(/[?#]/);
  const key = cut === -1 ? rest : rest.slice(0, cut);
  if (!key || key.includes('..') || key.startsWith('/')) return null;
  return key;
}

/**
 * Device-pixel-aware width, capped.
 *
 * Asking for 3× on a modern phone throws away most of the saving, and the
 * transformer is billed per origin image anyway — 2× is the point of diminishing
 * returns for a thumbnail. Capped at the source width so we never ask the
 * transformer to UPSCALE a capture (which costs bytes to gain nothing).
 */
export function pixelWidth(cssWidth: number, dpr: number, maxWidth = 1080): number {
  const scaled = cssWidth * Math.min(Math.max(dpr, 1), 2);
  return Math.max(1, Math.round(Math.min(scaled, maxWidth)));
}
