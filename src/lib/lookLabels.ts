/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What the PLATFORM booth calls each look — pure, so it is tested in node.
 *
 * Two problems this answers, both measured on cap-test-event:
 *
 *  1. The deck's tiles used boothDeck.shortLabel, which keeps only the FIRST
 *     word. An event whose frames are "Gold Confetti", "Gold Border" and
 *     "Gold Corners" read "Gold · Gold · Gold" — three tiles a guest cannot
 *     tell apart. `deckLabels` drops a leading word that siblings share and
 *     keeps the rest (the tile allows two lines), so they read "Confetti ·
 *     Border · Corners".
 *
 *  2. A look the host never named reaches guests as "Untitled Experience"
 *     (the Studio / db.ts default). Those are relabelled by kind — "Frame",
 *     "Frame 2", "Prop" — rather than hidden: hiding would make a host's real
 *     (possibly default) frame silently vanish from the booth, and the event
 *     default would then light a look that is not in the strip.
 *
 * The legacy deck (BoothControlDeck) never calls this — it keeps shortLabel.
 */
import type { LookTab } from './lookTerms';

/** Studio's and db.ts's default names ("Untitled Experience", "Untitled 3D
 *  Experience", "Untitled experience") and their world-look twins. */
export function isUntitledName(name: string): boolean {
  return /^untitled\b/i.test(name.trim()) || name.trim() === '';
}

/** What an unnamed look is called, by the tab it lives under. */
const UNTITLED_TITLE: Record<LookTab, string> = {
  frames: 'Frame',
  props: 'Prop',
  paint: 'Paint',
  effects: 'Effect',
};

/**
 * Guest-facing titles for a list of looks, in order. Named looks keep their
 * name. Unnamed ones become "Frame", "Frame 2"… counted per tab, so two
 * unnamed frames never read the same.
 */
export function guestLookTitles(items: readonly { name: string; tab: LookTab }[]): string[] {
  const untitledPerTab = new Map<LookTab, number>();
  const totalUntitled = new Map<LookTab, number>();
  for (const i of items) {
    if (isUntitledName(i.name)) totalUntitled.set(i.tab, (totalUntitled.get(i.tab) ?? 0) + 1);
  }
  return items.map((i) => {
    if (!isUntitledName(i.name)) return i.name.trim();
    const n = (untitledPerTab.get(i.tab) ?? 0) + 1;
    untitledPerTab.set(i.tab, n);
    const base = UNTITLED_TITLE[i.tab];
    return n === 1 && (totalUntitled.get(i.tab) ?? 0) === 1 ? base : `${base} ${n}`;
  });
}

/** Longest a single word may run before it is cut (the tile is 68px wide). */
export const DECK_WORD_MAX = 11;
/** Longest a whole tile label may run (two lines of ~11 characters). */
export const DECK_LABEL_MAX = 22;

/** Grapheme-safe characters, so an emoji is never cut in half. */
function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  return Array.from(s);
}

function cut(s: string, max: number): string {
  const g = graphemes(s);
  return g.length > max ? `${g.slice(0, max - 1).join('').trimEnd()}…` : s;
}

function words(name: string): string[] {
  return name.trim().split(/\s+/).filter((w) => w !== '');
}

/**
 * Tile labels for one row of sibling looks (one tab's worth), in order.
 *
 * A shared trailing phrase of two or more words ("… Face Paint") is dropped
 * first. Then a leading word shared with at least one sibling is dropped,
 * along with any further words the WHOLE sharing group has in common. Every
 * label keeps at least one word. A label that would then collide with
 * another sibling's keeps its full name instead. Long words and long labels
 * are cut with an ellipsis so the two-line clamp never has to hide a word.
 */
export function deckLabels(names: readonly string[]): string[] {
  const split = names.map(words);
  const key = (w: string | undefined) => (w ?? '').toLocaleLowerCase();

  // 1. A shared TRAILING phrase of two or more words ("Gameday Face Paint",
  // "Skull Face Paint" in the Paint tab) says nothing a guest can choose by.
  // One shared last word ("Kabuki Mask", "Racer Mask") is kept: it is often
  // the only word that says what the thing is.
  const tail = split.map(() => 0);
  const tails = new Map<string, number[]>();
  split.forEach((ws, i) => {
    if (ws.length < 3) return; // needs ≥1 word left after a 2-word cut
    const k = ws.slice(-2).map(key).join(' ');
    tails.set(k, [...(tails.get(k) ?? []), i]);
  });
  for (const members of tails.values()) {
    if (members.length < 2) continue;
    let drop = 2;
    const room = Math.min(...members.map((i) => split[i].length));
    const fromEnd = (i: number, n: number) => key(split[i][split[i].length - 1 - n]);
    while (drop < room - 1 && members.every((i) => fromEnd(i, drop) === fromEnd(members[0], drop))) drop += 1;
    for (const i of members) tail[i] = drop;
  }
  const trimmed = split.map((ws, i) => ws.slice(0, ws.length - tail[i]));

  // 2. A shared LEADING word ("Gold Confetti", "Gold Border").
  const head = split.map(() => 0);
  const groups = new Map<string, number[]>();
  trimmed.forEach((ws, i) => {
    if (ws.length < 2) return; // a one-word name has nothing to drop
    const k = key(ws[0]);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // How many leading words the whole group shares, leaving ≥1 word each.
    let drop = 1;
    const shortest = Math.min(...members.map((i) => trimmed[i].length));
    while (
      drop < shortest - 1 &&
      members.every((i) => key(trimmed[i][drop]) === key(trimmed[members[0]][drop]))
    ) drop += 1;
    for (const i of members) head[i] = drop;
  }

  const out = trimmed.map((ws, i) => ws.slice(head[i]).join(' '));

  // A dropped word must never make two different looks read the same.
  const seen = new Map<string, number[]>();
  out.forEach((l, i) => seen.set(key(l), [...(seen.get(key(l)) ?? []), i]));
  for (const idx of seen.values()) {
    if (idx.length < 2) continue;
    const originals = new Set(idx.map((i) => key(split[i].join(' '))));
    if (originals.size > 1) for (const i of idx) out[i] = split[i].join(' ');
  }

  return out.map((l) => cut(words(l).map((w) => cut(w, DECK_WORD_MAX)).join(' '), DECK_LABEL_MAX));
}
