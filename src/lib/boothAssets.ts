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

/**
 * Which scene may a Model draw right now?
 *
 * A Model keeps the scene it last loaded until the next one is parsed. When the
 * guest swaps sunglasses for a beanie, the rig around it already holds the
 * beanie's anchor and offset, so drawing the kept scene put the sunglasses on
 * top of the head for as long as the beanie took to load. With `hideStale`, a
 * scene is drawn only for the url it was loaded from: nothing shows until the
 * new model is ready. Without it the kept scene is drawn, as before.
 */
export function drawableScene<T>(
  loaded: { url: string; scene: T } | null,
  url: string,
  hideStale: boolean,
): T | null {
  if (loaded === null) return null;
  if (hideStale && loaded.url !== url) return null;
  return loaded.scene;
}

/** Most models the booth parses ahead of a tap. Parsed models stay in memory
 *  for the session, and one can be 0.5-6 MB, so this is kept small. */
export const MAX_PRELOADED_MODELS = 6;

/**
 * The 3D model files worth parsing before the guest taps them: every GLB a
 * 3D or composite experience in the catalogue wears, in catalogue order, minus
 * the ones already parsed, capped at `max`. 2D layers and procedural pieces
 * have no GLB and are skipped.
 */
export function glbPreloadQueue(
  catalog: readonly Experience[],
  isCached: (url: string) => boolean,
  max: number = MAX_PRELOADED_MODELS,
): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    if (out.length >= max) return;
    if (typeof u !== 'string' || u.length === 0) return;
    if (out.includes(u) || isCached(u)) return;
    out.push(u);
  };
  for (const exp of catalog) {
    if (exp.kind === '3d_attachment') push(exp.asset_url);
    if (exp.kind === '3d_attachment' || exp.kind === 'composite') {
      for (const l of exp.config?.layers ?? []) {
        if (l.kind === '3d_attachment') push(l.asset_url);
      }
    }
  }
  return out;
}

/**
 * Does this selection engrave the GUEST's own name on a 3D piece?
 *
 * The booth only asked for a name when a 2D frame wanted one, so a cap whose
 * label is `token: 'guestName'` rendered with an empty front: nothing ever
 * collected the name it was waiting for. Hidden layers count too — a reveal
 * target shows the name the moment its trigger fires.
 */
export function layersWantGuestName(
  layers: readonly { kind?: string; customization?: unknown }[] | null | undefined,
): boolean {
  if (!layers) return false;
  return layers.some((l) => {
    if (l.kind !== '3d_attachment') return false;
    const c = l.customization;
    if (!c || typeof c !== 'object') return false;
    const label = (c as { label?: unknown }).label;
    if (!label || typeof label !== 'object') return false;
    const token = (label as { token?: unknown }).token;
    return token === 'guestName' || token === 'guestInitials';
  });
}

/**
 * True when a selected 3D piece engraves the guest's INITIALS (a masquerade
 * mask's crest plate) rather than their whole name — the booth then asks for
 * initials and words its chip for them.
 */
export function layersWantGuestInitials(
  layers: readonly { kind?: string; customization?: unknown }[] | null | undefined,
): boolean {
  if (!layers) return false;
  return layers.some((l) => {
    if (l.kind !== '3d_attachment') return false;
    const c = l.customization;
    if (!c || typeof c !== 'object') return false;
    const label = (c as { label?: unknown }).label;
    return !!label && typeof label === 'object' && (label as { token?: unknown }).token === 'guestInitials';
  });
}
