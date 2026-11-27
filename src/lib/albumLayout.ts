/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * albumLayout — the pure geometry behind the live wall's Album layout: photos
 * stamped onto album pages, three or four to a page, each a little tilted,
 * and the book turning one page (or one two-page spread) at a time.
 *
 * Everything is DETERMINISTIC from the post ids (no Math.random): a photo
 * keeps its exact spot and angle on its page all evening, every screen draws
 * the same album, and tests can pin it.
 *
 * Pages fill in the order photos were taken (oldest first), so a new photo
 * only ever lands on the last page or starts a new one: the pages a guest
 * has already seen never reshuffle.
 */

/** How many photos go on page `i`: 4, 4, 3, repeating — the variety reads
 *  like a real album instead of a grid. */
export function photosOnPage(i: number): number {
  return i % 3 === 2 ? 3 : 4;
}

/** Ids (in the wall's newest-first order) → pages of ids, oldest page first. */
export function albumPages(idsNewestFirst: readonly string[]): string[][] {
  const ids = [...idsNewestFirst].reverse();
  const pages: string[][] = [];
  let at = 0;
  while (at < ids.length) {
    const n = photosOnPage(pages.length);
    pages.push(ids.slice(at, at + n));
    at += n;
  }
  return pages;
}

/** Pages → spreads (2 pages side by side on a wide screen, 1 on a narrow one). */
export function albumSpreads(pages: readonly string[][], pagesPerSpread: 1 | 2): string[][][] {
  const out: string[][][] = [];
  for (let i = 0; i < pages.length; i += pagesPerSpread) out.push(pages.slice(i, i + pagesPerSpread));
  return out;
}

/** The spread a post is on, or -1. */
export function spreadOf(spreads: readonly string[][][], id: string): number {
  return spreads.findIndex((s) => s.some((p) => p.includes(id)));
}

/**
 * The spread to turn to next. A newly arrived photo jumps the queue (so the
 * room sees it land), otherwise the album keeps reading forward and starts
 * again from the first page after the last.
 */
export function nextSpread(current: number, count: number, newestSpread = -1): number {
  if (count <= 1) return 0;
  if (newestSpread >= 0 && newestSpread < count && newestSpread !== current) return newestSpread;
  return (current + 1) % count;
}

/** 32-bit FNV-1a of a string: the seed for one photo's placement. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface AlbumSlot {
  /** Centre of the photo, 0..1 across / down the page. */
  cx: number;
  cy: number;
  /** The photo's largest size, as a fraction of the page's width / height. */
  maxW: number;
  maxH: number;
  /** Degrees; never flat (a stamped photo is always a touch off true). */
  tilt: number;
}

/** Where photos sit for each count, before the per-photo nudge. */
const TEMPLATES: Record<number, readonly { cx: number; cy: number }[]> = {
  1: [{ cx: 0.5, cy: 0.5 }],
  2: [{ cx: 0.29, cy: 0.47 }, { cx: 0.71, cy: 0.53 }],
  3: [{ cx: 0.29, cy: 0.27 }, { cx: 0.71, cy: 0.3 }, { cx: 0.5, cy: 0.72 }],
  4: [{ cx: 0.28, cy: 0.27 }, { cx: 0.72, cy: 0.29 }, { cx: 0.29, cy: 0.73 }, { cx: 0.71, cy: 0.71 }],
};
const SIZE: Record<number, { maxW: number; maxH: number }> = {
  1: { maxW: 0.72, maxH: 0.8 },
  2: { maxW: 0.4, maxH: 0.66 },
  3: { maxW: 0.38, maxH: 0.4 },
  4: { maxW: 0.38, maxH: 0.4 },
};

/** Tilt for a photo: 1.5° to 5° either way, alternating sides down the page
 *  so neighbours lean apart, with the hash choosing which way the page starts. */
export function tiltFor(id: string, index: number): number {
  const h = hashId(id);
  const magnitude = 1.5 + ((h >>> 3) % 36) / 10; // 1.5 .. 5.0
  const startLeft = (h & 1) === 0;
  const left = index % 2 === 0 ? startLeft : !startLeft;
  return Math.round((left ? -magnitude : magnitude) * 10) / 10;
}

/** The slots for one page of photos. */
export function pageSlots(ids: readonly string[]): AlbumSlot[] {
  const n = Math.min(4, Math.max(1, ids.length));
  const template = TEMPLATES[n];
  const size = SIZE[n];
  return ids.slice(0, 4).map((id, i) => {
    const h = hashId(id);
    const dx = (((h >>> 8) % 41) - 20) / 1000; // ±0.02
    const dy = (((h >>> 16) % 41) - 20) / 1000;
    return { cx: template[i].cx + dx, cy: template[i].cy + dy, ...size, tilt: tiltFor(id, i) };
  });
}

/** Seconds a spread stays open before the page turns. A busy album turns a
 *  little faster so the room still reaches the new photos. */
export function albumHoldSec(spreadCount: number): number {
  if (spreadCount > 30) return 7;
  if (spreadCount > 10) return 9;
  return 11;
}
