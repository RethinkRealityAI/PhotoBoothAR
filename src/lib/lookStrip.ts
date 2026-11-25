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
 * Platform events get four tabs over one row of circles — Frames · Props ·
 * Paint · Effects (lib/lookTerms; Dapo, 2026-11-23: one long strip gave no
 * sense of which kind you were in). The deck opens on the tab holding the
 * applied look, so a guest never has to pick a tab before seeing one. A
 * labelled "More looks" sheet keeps the full catalogue with the same chips.
 * Looks stay COMBINABLE: one frame + one prop + one face paint + one effect,
 * because a tile toggles only its own slot (Paint got its own slot on Dapo's
 * OK, 2026-11-25 — before that a paint and a prop shared one). Which tile is lit,
 * what a tap does, what the name pill announces and which chips the sheet
 * offers are all decided here so they can be tested without a camera.
 */
import type { Experience } from '../types';
import type { DeckCategory, DeckOption, DeckSection, DeckSelection } from './boothDeck';
import { LOOK_TABS, type LookTab } from './lookTerms';
import { guestLookTitles } from './lookLabels';

/** Strip order: the host's own frames lead, generic effects come last. */
export const LOOK_ORDER: readonly DeckCategory[] = ['frame', 'prop', 'effect'];

/**
 * The booth SLOTS a look can fill. Face paint arrives in the deck's 3D section
 * (it is a 3d_attachment row) but fills its OWN slot, so a guest can wear a
 * prop and a paint at once.
 */
export type LookSlot = DeckCategory | 'paint';

/** Slot order for announcing a change: same as the strip. */
export const LOOK_SLOTS: readonly LookSlot[] = ['frame', 'prop', 'paint', 'effect'];

export interface LookItem extends DeckOption {
  /** The booth SLOT it fills (one frame + one prop + one paint + one effect). */
  category: LookSlot;
  /** The TAB a guest finds it under (lib/lookTerms). */
  tab: LookTab;
  /**
   * What a GUEST is shown: the look's name, or "Frame" / "Prop 2" for one the
   * host never named (lib/lookLabels). `exp.name` stays untouched — it is what
   * the booth applies and records.
   */
  title: string;
}

/** The slot a deck-section look fills. */
export function lookSlotOf(category: DeckCategory, exp: Experience): LookSlot {
  return category === 'prop' && isPaintLook(exp) ? 'paint' : category;
}

/**
 * A 3D-slot look is face paint when every visible layer is a face-paint layer
 * (the wizard and Studio save a design as one such layer). A scene that mixes
 * paint with a worn prop is led by the prop, so it lives under Props.
 */
export function isPaintLook(exp: Experience): boolean {
  const layers = (exp.config?.layers ?? []).filter((l) => l.hidden !== true);
  return layers.length > 0 && layers.every((l) => l.facePaint !== undefined);
}

/** Which tab a look belongs under. Combined scenes stay with their frame. */
export function lookTabOf(category: DeckCategory, exp: Experience): LookTab {
  if (category === 'frame') return 'frames';
  if (category === 'effect') return 'effects';
  return isPaintLook(exp) ? 'paint' : 'props';
}

const TAB_INDEX: Record<LookTab, number> = Object.fromEntries(LOOK_TABS.map((t, i) => [t.id, i])) as Record<LookTab, number>;

/** Every look in tab order (Frames · Props · Paint · Effects). Empty sections contribute nothing. */
export function buildLookStrip(sections: readonly DeckSection[]): LookItem[] {
  const out: LookItem[] = [];
  for (const key of LOOK_ORDER) {
    const section = sections.find((s) => s.key === key);
    if (!section) continue;
    for (const o of section.options) out.push({ ...o, category: lookSlotOf(key, o.exp), tab: lookTabOf(key, o.exp), title: o.exp.name });
  }
  // Stable: paint moves after props, everything else keeps its catalog order.
  const sorted = out
    .map((item, i) => ({ item, i }))
    .sort((a, b) => TAB_INDEX[a.item.tab] - TAB_INDEX[b.item.tab] || a.i - b.i)
    .map((x) => x.item);
  const titles = guestLookTitles(sorted.map((i) => ({ name: i.exp.name, tab: i.tab })));
  return sorted.map((item, i) => ({ ...item, title: titles[i] }));
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
  const paintId = sel.paintId ?? null;
  if (paintId !== null && strip.some((i) => i.category === 'paint' && i.exp.id === paintId)) ids.add(paintId);
  if (sel.effectId !== 'none') {
    const fx = strip.find((i) => i.category === 'effect' && i.shaderId === sel.effectId);
    if (fx) ids.add(fx.exp.id);
  }
  return ids;
}

export type LookAction =
  | { category: 'effect'; shaderId: string; exp: Experience | null }
  | { category: 'frame'; exp: Experience | null }
  | { category: 'prop'; exp: Experience | null }
  | { category: 'paint'; exp: Experience | null };

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

function idFor(category: LookSlot, strip: readonly LookItem[], sel: DeckSelection): string | null {
  if (category === 'frame') return sel.frameId;
  if (category === 'prop') return sel.attachmentId;
  if (category === 'paint') return sel.paintId ?? null;
  if (sel.effectId === 'none') return null;
  return strip.find((i) => i.category === 'effect' && i.shaderId === sel.effectId)?.exp.id ?? null;
}

function nameOf(strip: readonly LookItem[], id: string): string | null {
  return strip.find((i) => i.exp.id === id)?.title ?? null;
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
  for (const c of LOOK_SLOTS) {
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

/** The booth's four apply callbacks, in the shape both look surfaces share. */
export interface LookHandlers {
  onSelectEffect: (shaderId: string, exp: Experience | null) => void;
  onSelectFrame: (exp: Experience | null) => void;
  onSelectAttachment: (exp: Experience | null) => void;
  onSelectPaint: (exp: Experience | null) => void;
}

/** Route a LookAction to the booth's matching setter. */
export function runLookAction(action: LookAction, h: LookHandlers): void {
  if (action.category === 'effect') h.onSelectEffect(action.shaderId, action.exp);
  else if (action.category === 'frame') h.onSelectFrame(action.exp);
  else if (action.category === 'paint') h.onSelectPaint(action.exp);
  else h.onSelectAttachment(action.exp);
}

export type LookChip = 'all' | LookTab;

/** The sheet's tab chips. "All" only when there is more than one tab. */
export function lookChips(strip: readonly LookItem[]): { key: LookChip; label: string; count: number }[] {
  const chips: { key: LookChip; label: string; count: number }[] = [];
  for (const t of LOOK_TABS) {
    const count = strip.filter((i) => i.tab === t.id).length;
    if (count > 0) chips.push({ key: t.id, label: t.short, count });
  }
  if (chips.length > 1) chips.unshift({ key: 'all', label: 'All', count: strip.length });
  return chips;
}

/** The sheet's groups for a chip — "All" keeps one heading per tab. */
export function looksForChip(
  strip: readonly LookItem[],
  chip: LookChip,
): { tab: LookTab; label: string; items: LookItem[] }[] {
  const tabs = chip === 'all' ? LOOK_TABS : LOOK_TABS.filter((t) => t.id === chip);
  return tabs
    .map((t) => ({ tab: t.id, label: t.short, items: strip.filter((i) => i.tab === t.id) }))
    .filter((g) => g.items.length > 0);
}

/* ── The deck's tabs ──────────────────────────────────────────────────── */

/**
 * The tabs the deck shows above its circles, in order, each with its count.
 * An empty tab is hidden — except Effects, which always holds Sparkle.
 */
export function lookTabs(strip: readonly LookItem[]): { id: LookTab; label: string; count: number }[] {
  return LOOK_TABS
    .map((t) => ({ id: t.id, label: t.short, count: strip.filter((i) => i.tab === t.id).length }))
    .filter((t) => t.count > 0 || t.id === 'effects');
}

/** The tabs holding something that is on right now — each gets a dot. */
export function tabsInUse(strip: readonly LookItem[], sel: DeckSelection, sparkles: boolean): Set<LookTab> {
  const ids = activeLookIds(strip, sel);
  const out = new Set<LookTab>();
  for (const i of strip) if (ids.has(i.exp.id)) out.add(i.tab);
  if (sparkles) out.add('effects');
  return out;
}

/**
 * The tab the deck opens on: where the applied look lives (an event default
 * or a shared /experience link lands looking at what is on), else the first
 * tab — the host's frames when there are any.
 */
export function defaultLookTab(strip: readonly LookItem[], sel: DeckSelection): LookTab {
  const ids = activeLookIds(strip, sel);
  const on = strip.find((i) => ids.has(i.exp.id));
  return on?.tab ?? lookTabs(strip)[0]?.id ?? 'effects';
}

/** The tab a look lives under, by experience id; null when it is not in the strip. */
export function tabOfLook(strip: readonly LookItem[], id: string): LookTab | null {
  return strip.find((i) => i.exp.id === id)?.tab ?? null;
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

/** What each tab's "None" tile says in the "More looks" sheet. */
export const LOOK_NONE_LABEL: Record<LookTab, string> = {
  frames: 'No frame',
  props: 'No prop',
  paint: 'No paint',
  effects: 'No effect',
};

/** True when nothing under `tab` is applied (its "None" tile lights). Sparkle
 *  is a separate switch, so it does not count against Effects' None. */
export function tabIsClear(tab: LookTab, strip: readonly LookItem[], sel: DeckSelection): boolean {
  const ids = activeLookIds(strip, sel);
  return !strip.some((i) => i.tab === tab && ids.has(i.exp.id));
}

/**
 * A tab's "None" tile: take THAT tab's look off and leave the others on — the
 * strip's global "None" clears everything. Null when the tab is already clear.
 * Props and Paint are separate slots, so "No paint" never takes a prop off and
 * "No prop" never takes the paint off.
 */
export function clearTabAction(tab: LookTab, strip: readonly LookItem[], sel: DeckSelection): LookAction | null {
  if (tabIsClear(tab, strip, sel)) return null;
  if (tab === 'frames') return { category: 'frame', exp: null };
  if (tab === 'effects') return { category: 'effect', shaderId: 'none', exp: null };
  if (tab === 'paint') return { category: 'paint', exp: null };
  return { category: 'prop', exp: null };
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
