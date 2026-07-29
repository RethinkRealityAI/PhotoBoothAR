/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which files does an experience actually have to download before it looks
 * like anything?
 *
 * Tapping a crown on venue wifi produced NOTHING for several seconds: the orb
 * showed as selected, the overlay image was still in flight, the GLB had not
 * resolved — and the booth's "magic reveal" shimmer had already played, so the
 * one moment that was supposed to celebrate the piece arriving fired while the
 * piece was still on the network.
 *
 * Fixing that needs one fact the booth did not have: the list of URLs a
 * selection depends on. That is pure, so it lives here.
 */
import type { Experience } from '../types';

/**
 * Every asset URL a selection needs, deduped and in draw order.
 *
 * Covers all three shapes the catalogue actually produces:
 *   • single-asset experiences (`asset_url` on a border / 2d_filter /
 *     3d_attachment),
 *   • studio multi-layer scenes (`config.layers[].asset_url`),
 *   • composites, which are a multi-layer scene that mixes both families.
 *
 * A procedural head piece (`config.procedural`, geometry generated in-process)
 * has no URL and correctly contributes nothing — it is ready the moment it is
 * selected, and must never be reported as pending.
 */
export function assetUrlsOf(exp: Experience | null | undefined): string[] {
  if (!exp) return [];
  const urls: string[] = [];
  const push = (u: string | null | undefined) => {
    if (typeof u === 'string' && u.length > 0 && !urls.includes(u)) urls.push(u);
  };
  const layers = exp.config?.layers;
  if (layers && layers.length > 0) {
    for (const l of layers) push(l.asset_url);
  }
  // A composite carries its content in layers, but a single-family experience
  // carries it in the singular field — take both, deduped, so a scene that
  // sets each of them once is not counted twice.
  push(exp.asset_url);
  return urls;
}

/**
 * The signature the booth compares to decide "is this a NEW selection?".
 *
 * Returns null when nothing is selected — an explicit null rather than an
 * empty string, because "" is a legitimate id-join for a selection of two
 * unnamed experiences and a truthiness test would confuse the two.
 */
export function selectionSignature(
  frameId: string | null | undefined,
  attachId: string | null | undefined,
): string | null {
  if (!frameId && !attachId) return null;
  return `${frameId ?? ''}|${attachId ?? ''}`;
}

/**
 * Is a selection still waiting on the network?
 *
 * `loaded` is the set of URLs already known-good. An experience with no URLs
 * (procedural, or a bare shader) is never pending — the guest must not see a
 * spinner on something that has nothing to fetch.
 */
export function isPending(urls: readonly string[], loaded: ReadonlySet<string>): boolean {
  if (urls.length === 0) return false;
  return urls.some((u) => !loaded.has(u));
}

/**
 * Merge a finished download into the loaded set, returning the SAME set when
 * nothing changed.
 *
 * Identity-stable on a no-op so a React state setter can bail (`prev === next`
 * skips the re-render) — a booth that re-rendered on every duplicate load
 * event would stutter the viewfinder for no reason.
 */
export function withLoaded(loaded: ReadonlySet<string>, url: string): ReadonlySet<string> {
  if (loaded.has(url)) return loaded;
  const next = new Set(loaded);
  next.add(url);
  return next;
}
