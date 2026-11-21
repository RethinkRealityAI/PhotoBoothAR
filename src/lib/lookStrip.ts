/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The platform booth's look switcher, as pure functions.
 *
 * The deck that legacy events keep (BoothControlDeck) asks the guest to pick a
 * category tab before they can see a single look, and its "All" escape hatch
 * is the LAST orb of a horizontally-scrolling row — at 390px it is the 14th
 * item and sits off-screen, so nothing tells a guest there are more looks.
 *
 * Platform events get one flat strip instead: every look in one swipeable row
 * (frames first — they are what the host designed — then 3D pieces, then the
 * built-in effects), plus a labelled "More looks" sheet with category chips.
 * Looks stay COMBINABLE exactly as before: one frame + one 3D piece + one
 * effect, because a tile toggles only its own category. Which tile is lit,
 * what a tap does, what the name pill announces and which chips the sheet
 * offers are all decided here so they can be tested without a camera.
 */
import type { Experience } from '../types';
import type { DeckCategory, DeckOption, DeckSection, DeckSelection } from './boothDeck';

/** Strip order: the host's own frames lead, generic effects come last. */
export const LOOK_ORDER: readonly DeckCategory[] = ['frame', 'prop', 'effect'];

/** Category names as a guest reads them (chips, headings, tile badges). */
export const LOOK_CATEGORY_LABEL: Record<DeckCategory, string> = {
  frame: 'Frames',
  prop: '3D',
  effect: 'Effects',
};

export interface LookItem extends DeckOption {
  category: DeckCategory;
}

/** Every look in strip order. Empty sections contribute nothing. */
export function buildLookStrip(sections: readonly DeckSection[]): LookItem[] {
  const out: LookItem[] = [];
  for (const key of LOOK_ORDER) {
    const section = sections.find((s) => s.key === key);
    if (!section) continue;
    for (const o of section.options) out.push({ ...o, category: key });
  }
  return out;
}

/**
 * Experience ids of the tiles that are currently applied.
 *
 * Effects match on the SHADER id (the booth stores the active shader, not the
 * row), and only the FIRST tile carrying that shader lights — two catalog
 * rows can share a shader, and lighting both would claim two looks are on.
 * Same rule as boothDeck.activeOptionId.
 */
export function activeLookIds(strip: readonly LookItem[], sel: DeckSelection): Set<string> {
  const ids = new Set<string>();
  if (sel.frameId !== null && strip.some((i) => i.category === 'frame' && i.exp.id === sel.frameId)) ids.add(sel.frameId);
  if (sel.attachmentId !== null && strip.some((i) => i.category === 'prop' && i.exp.id === sel.attachmentId)) ids.add(sel.attachmentId);
  if (sel.effectId !== 'none') {
    const fx = strip.find((i) => i.category === 'effect' && i.shaderId === sel.effectId);
    if (fx) ids.add(fx.exp.id);
  }
  return ids;
}

export type LookAction =
  | { category: 'effect'; shaderId: string; exp: Experience | null }
  | { category: 'frame'; exp: Experience | null }
  | { category: 'prop'; exp: Experience | null };

/**
 * What tapping a tile does: apply it, or — when it is already on — take its
 * category back off. Identical to the legacy orb's toggle, so the two decks
 * can never disagree about what a tap means.
 */
export function lookTapAction(item: LookItem, active: boolean): LookAction {
  if (item.category === 'effect') {
    return active
      ? { category: 'effect', shaderId: 'none', exp: null }
      : { category: 'effect', shaderId: item.shaderId ?? 'none', exp: item.exp };
  }
  return { category: item.category, exp: active ? null : item.exp };
}

function idFor(category: DeckCategory, strip: readonly LookItem[], sel: DeckSelection): string | null {
  if (category === 'frame') return sel.frameId;
  if (category === 'prop') return sel.attachmentId;
  if (sel.effectId === 'none') return null;
  return strip.find((i) => i.category === 'effect' && i.shaderId === sel.effectId)?.exp.id ?? null;
}

function nameOf(strip: readonly LookItem[], id: string): string | null {
  return strip.find((i) => i.exp.id === id)?.exp.name ?? null;
}

/**
 * The look the name pill should announce after a selection change, or null.
 *
 * Driven by the SELECTION rather than by the tap, so every route into a new
 * look — a tile, the sheet, a stage swipe, the event default arriving — is
 * announced the same way. When several categories change at once (a combined
 * scene applies its frame, piece and effect together) the one that turned ON
 * first in strip order wins, so a combined look is named by its frame. A
 * change that only turned things off names what was removed.
 */
export function changedLook(
  strip: readonly LookItem[],
  prev: DeckSelection | null,
  next: DeckSelection,
): { id: string; name: string; on: boolean } | null {
  if (prev === null) return null;
  let removed: { id: string; name: string } | null = null;
  for (const c of LOOK_ORDER) {
    const before = idFor(c, strip, prev);
    const after = idFor(c, strip, next);
    if (before === after) continue;
    if (after !== null) {
      const name = nameOf(strip, after);
      if (name !== null) return { id: after, name, on: true };
    } else if (before !== null && removed === null) {
      const name = nameOf(strip, before);
      if (name !== null) removed = { id: before, name };
    }
  }
  return removed !== null ? { ...removed, on: false } : null;
}

/** The booth's three apply callbacks, in the shape both look surfaces share. */
export interface LookHandlers {
  onSelectEffect: (shaderId: string, exp: Experience | null) => void;
  onSelectFrame: (exp: Experience | null) => void;
  onSelectAttachment: (exp: Experience | null) => void;
}

/** Route a LookAction to the booth's matching setter. */
export function runLookAction(action: LookAction, h: LookHandlers): void {
  if (action.category === 'effect') h.onSelectEffect(action.shaderId, action.exp);
  else if (action.category === 'frame') h.onSelectFrame(action.exp);
  else h.onSelectAttachment(action.exp);
}

export type LookChip = 'all' | DeckCategory;

/** The sheet's category chips. "All" only when there is more than one category. */
export function lookChips(strip: readonly LookItem[]): { key: LookChip; label: string; count: number }[] {
  const chips: { key: LookChip; label: string; count: number }[] = [];
  for (const c of LOOK_ORDER) {
    const count = strip.filter((i) => i.category === c).length;
    if (count > 0) chips.push({ key: c, label: LOOK_CATEGORY_LABEL[c], count });
  }
  if (chips.length > 1) chips.unshift({ key: 'all', label: 'All', count: strip.length });
  return chips;
}

/** The sheet's groups for a chip — "All" keeps one heading per category. */
export function looksForChip(
  strip: readonly LookItem[],
  chip: LookChip,
): { category: DeckCategory; label: string; items: LookItem[] }[] {
  const cats = chip === 'all' ? LOOK_ORDER : LOOK_ORDER.filter((c) => c === chip);
  return cats
    .map((c) => ({ category: c, label: LOOK_CATEGORY_LABEL[c], items: strip.filter((i) => i.category === c) }))
    .filter((g) => g.items.length > 0);
}

/**
 * The scrollLeft that centres a tile in the strip, clamped to what the strip
 * can actually scroll. Used instead of scrollIntoView, which also scrolls the
 * PAGE vertically when the tile is not fully in view.
 */
export function centeredScrollLeft(itemLeft: number, itemWidth: number, viewportWidth: number, scrollWidth: number): number {
  const max = Math.max(0, scrollWidth - viewportWidth);
  const target = itemLeft + itemWidth / 2 - viewportWidth / 2;
  return Math.min(max, Math.max(0, target));
}

/* ── First-run hint ───────────────────────────────────────────────────── */

/** Versioned so a future hint can be shown again without clearing anything. */
export const LOOK_HINT_KEY = 'beamwall.booth.lookHint.v1';
/** Wait for the camera to settle before pointing at anything. */
export const LOOK_HINT_DELAY_MS = 900;
/** How long the hint stays if the guest does nothing. */
export const LOOK_HINT_MS = 4200;
/** How long the selected look's name stays up. */
export const LOOK_NAME_MS = 1600;
/** Fewer looks than this all fit on a phone — there is nothing to swipe for. */
export const LOOK_HINT_MIN_LOOKS = 4;

/**
 * Has this device already seen the hint? Storage that throws (blocked site
 * data, some embedded webviews) reads as NOT seen: the hint is one quiet pill,
 * and showing it once per page load beats never showing it.
 */
export function lookHintSeen(storage: Pick<Storage, 'getItem'> | null): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(LOOK_HINT_KEY) !== null;
  } catch {
    return false;
  }
}

/** Best effort: a failed write only means the hint may show once more. */
export function markLookHintSeen(storage: Pick<Storage, 'setItem'> | null): void {
  if (storage === null) return;
  try {
    storage.setItem(LOOK_HINT_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

export function shouldShowLookHint(seen: boolean, lookCount: number): boolean {
  return !seen && lookCount >= LOOK_HINT_MIN_LOOKS;
}

/* ── Per-category "None" + strip organisation ─────────────────────────── */

/** What each category's "None" tile says in the "More looks" sheet. */
export const LOOK_NONE_LABEL: Record<DeckCategory, string> = {
  frame: 'No frame',
  prop: 'No 3D',
  effect: 'No effect',
};

/**
 * A category's "None" tile: take THAT category off and leave the others on —
 * the strip's global "None" clears everything, the sheet's are per section.
 */
export function clearCategoryAction(category: DeckCategory): LookAction {
  return category === 'effect'
    ? { category: 'effect', shaderId: 'none', exp: null }
    : { category, exp: null };
}

/** True when nothing of `category` is applied (its "None" tile lights). */
export function categoryIsClear(category: DeckCategory, sel: DeckSelection): boolean {
  if (category === 'frame') return sel.frameId === null;
  if (category === 'prop') return sel.attachmentId === null;
  return sel.effectId === 'none';
}

/**
 * Ids of the strip tiles that START a new category after the first one — the
 * strip draws a quiet divider before each, so frames / 3D / effects read as
 * groups while staying one swipe.
 */
export function categoryBreaks(strip: readonly LookItem[]): Set<string> {
  const out = new Set<string>();
  for (let i = 1; i < strip.length; i++) {
    if (strip[i].category !== strip[i - 1].category) out.add(strip[i].exp.id);
  }
  return out;
}

/** Minimum upward travel (px) for a swipe on the strip to open the sheet. */
export const SWIPE_UP_MIN_PX = 36;

/**
 * Swipe up on the look strip opens "More looks" (the camera-app gesture). It
 * must be clearly vertical, so a sideways browse that drifts up never fires it.
 */
export function isSwipeUp(dx: number, dy: number): boolean {
  return dy <= -SWIPE_UP_MIN_PX && Math.abs(dx) < Math.abs(dy) * 0.6;
}
