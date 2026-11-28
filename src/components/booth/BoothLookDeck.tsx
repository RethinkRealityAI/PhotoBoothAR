/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BoothLookDeck — the platform booth's camera deck.
 *
 * What it answers (measured on the legacy deck at 390px): a guest had to pick
 * a category tab before seeing a single look, two of the three tabs rendered
 * at 55% alpha, and the only way to the full catalogue was an "All" orb at the
 * END of a scrolling row — the 14th item, off-screen. Nothing said there were
 * more looks.
 *
 * Now, one decision at a time and nothing hidden that matters:
 *   · four tabs over the circles — Frames · Props · Paint · Effects
 *     (lib/lookTerms) — that open on the tab holding the applied look, so
 *     there is always a row of looks on screen and the guest always knows
 *     which kind they are in (Dapo, 2026-11-23). Empty tabs are hidden; a dot
 *     marks a tab whose look is on;
 *   · one swipeable row of that tab's looks, snapping, with the next tile
 *     peeking past a faded edge so it reads as "there's more";
 *   · the look that just went on is named in a small glass pill that fades;
 *   · a labelled "More looks" pill beside the shutter opens the full sheet with
 *     category chips (LooksSheet);
 *   · a one-time "Swipe for more looks" hint with a single nudge, remembered
 *     per device.
 * The shutter stays the hero. Looks stay combinable — a tile toggles only its
 * own category, exactly like the legacy orbs (lib/lookStrip.lookTapAction).
 *
 * Platform events only. Legacy events keep BoothControlDeck untouched.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeftRight, Ban, Circle, Dices, EyeOff, Film, LayoutGrid, Sparkles } from 'lucide-react';
import LookThumb from './LookThumb';
import type { DeckSection, DeckSelection } from '../../lib/boothDeck';
import {
  activeLookIds,
  buildLookStrip,
  centeredScrollLeft,
  deckNoneTile,
  defaultLookTab,
  isSwipeUp,
  changedLook,
  lookHintSeen,
  lookTabs,
  lookTapAction,
  markLookHintSeen,
  runLookAction,
  shouldShowLookHint,
  tabOfLook,
  tabsInUse,
  LOOK_HINT_DELAY_MS,
  LOOK_HINT_MS,
  LOOK_NAME_MS,
  LOOK_NONE_LABEL,
  type LookHandlers,
} from '../../lib/lookStrip';
import { LOOK_TAB_SHORT, type LookTab } from '../../lib/lookTerms';
import { deckLabels } from '../../lib/lookLabels';
import { canSurprise, pickSurprise, surpriseAnnouncement } from '../../lib/lookSurprise';
import { haptic } from '../../lib/haptics';
import type { GuestColorSlot } from '../../lib/guestPalette';

const HOLD_TIP_KEY = 'bw.booth.holdTip.v1';
const HOLD_TIP_DELAY_MS = 1800;
const HOLD_TIP_MS = 4200;
function holdTipSeen(storage: Storage | null): boolean {
  try { return storage?.getItem(HOLD_TIP_KEY) === '1'; } catch { return false; }
}
function markHoldTipSeen(storage: Storage | null): void {
  try { storage?.setItem(HOLD_TIP_KEY, '1'); } catch { /* private mode: shows again next visit */ }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/* ── Tile ─────────────────────────────────────────────────────────────── */

function Tile({
  active, label, ariaLabel, onClick, pending = false, badge, children, tileRef,
}: {
  active: boolean;
  label: string;
  ariaLabel: string;
  onClick: () => void;
  pending?: boolean;
  badge?: ReactNode;
  children: ReactNode;
  tileRef?: (el: HTMLButtonElement | null) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <button
      ref={tileRef}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      // snap-CENTER, matching `centre()` below: with snap-start a centred
      // selection was immediately re-snapped to the left edge.
      className="group flex w-[68px] shrink-0 snap-center flex-col items-center gap-1.5 rounded-xl"
    >
      <span className="relative h-[60px] w-[60px]">
        <motion.span
          animate={{ scale: active ? 1.1 : 1 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 20 }}
          className={`pressable relative flex h-full w-full items-center justify-center overflow-hidden rounded-full ${active ? 'is-selected' : ''}`}
          style={{
            background: 'rgba(9, 11, 20, 0.55)',
            // A plain accent ring under the glimmering rim, so the selected
            // state still reads on a db event whose look opts out of the
            // platform's `.is-selected` styling.
            // Selected = accent ring + a dark keyline outside it, so it reads
            // over a white wall as well as a dark room. Unselected tiles get a
            // brighter rim + drop shadow for the same reason.
            boxShadow: active
              ? '0 0 0 2.5px var(--color-accent), 0 0 0 5px rgba(5,6,11,0.55), 0 0 24px -4px rgba(var(--accent-rgb), 0.95)'
              : 'inset 0 0 0 1.5px rgba(255,255,255,0.42), inset 0 10px 12px -10px rgba(255,255,255,0.6), 0 3px 10px -3px rgba(0,0,0,0.7)',
          }}
        >
          {children}
          {pending && (
            <span
              className={reduced ? 'pointer-events-none absolute inset-0 rounded-full' : 'pointer-events-none absolute inset-0 animate-spin rounded-full'}
              style={{
                border: '2px solid transparent',
                borderTopColor: 'var(--color-accent)',
                borderRightColor: 'rgba(var(--accent-rgb),0.35)',
                background: 'rgba(5,6,11,0.35)',
              }}
            />
          )}
        </motion.span>
        {badge}
      </span>
      {/* Label on its own scrim, so it stays legible over any camera image.
          Up to two lines: sibling names are shortened by lib/lookLabels, and
          the second line is what keeps a longer name distinguishable. */}
      <span
        className="block max-w-full rounded-[10px] px-1.5 py-[3px] text-center font-sans text-[12px] leading-[1.15] transition-colors [overflow-wrap:anywhere]"
        style={{
          color: active ? 'var(--color-brand-fg)' : 'rgba(232,235,250,0.9)',
          fontWeight: active ? 600 : 500,
          background: active ? 'rgba(var(--accent-rgb),0.34)' : 'rgba(5,6,11,0.55)',
          textShadow: '0 1px 2px rgba(0,0,0,0.65)',
        }}
      >
        {/* The clamp lives on an inner span: on the padded scrim itself a
            third line peeked through the bottom padding. */}
        <span className="line-clamp-2">{label}</span>
      </span>
    </button>
  );
}

/** A quiet rule between the built-in tiles (None, Sparkle) and the tab's own
 *  looks. Centred on the tile row. */
function Divider() {
  return <span aria-hidden className="mt-[18px] h-6 w-px shrink-0 self-start rounded-full bg-white/25" />;
}

/* ── Deck ─────────────────────────────────────────────────────────────── */

export interface BoothLookDeckProps extends LookHandlers {
  sections: DeckSection[];
  selection: DeckSelection;
  sparkles: boolean;
  onToggleSparkles: (v: boolean) => void;
  /** Opens the full "More looks" sheet. */
  onOpenAll: () => void;
  sheetOpen: boolean;
  /** The shutter records while held (the plan allows video): a one-time hint
   *  says so. There is no Photo / Video switch any more (Dapo, Nov 28 2026). */
  holdForVideo: boolean;
  recording: boolean;
  shutter: ReactNode;
  /** Hides the deck and top bar to show the whole frame (bottom-left, beside
   *  the strip button, so it is one tap rather than inside the menu). */
  onHideControls: () => void;
  pendingIds?: ReadonlySet<string>;
  stripMode?: boolean;
  stripShots?: number;
  onOpenStripPicker?: () => void;
  colorSlot?: GuestColorSlot | null;
  guestHex?: string | null;
  onGuestHex?: (hex: string | null) => void;
  /** False while something sits on top of the booth (onboarding) — the
   *  first-run hint waits rather than pointing at a hidden strip. */
  hintEnabled: boolean;
}

export default function BoothLookDeck({
  sections, selection, sparkles, onToggleSparkles,
  onSelectEffect, onSelectFrame, onSelectAttachment, onSelectPaint, onOpenAll, sheetOpen,
  holdForVideo, recording, shutter, onHideControls, pendingIds,
  stripMode = false, stripShots, onOpenStripPicker,
  colorSlot = null, guestHex = null, onGuestHex, hintEnabled,
}: BoothLookDeckProps) {
  const reduced = useReducedMotion() ?? false;
  const strip = useMemo(() => buildLookStrip(sections), [sections]);
  const activeIds = useMemo(() => activeLookIds(strip, selection), [strip, selection]);
  const handlers: LookHandlers = { onSelectEffect, onSelectFrame, onSelectAttachment, onSelectPaint };

  // ── Tabs. Until the guest picks one (or a look goes on elsewhere) the deck
  // follows the applied look, so an event default arriving late still opens
  // on its own tab. A picked tab that vanishes (catalog changed) falls back.
  const tabs = useMemo(() => lookTabs(strip), [strip]);
  const [pickedTab, setPickedTab] = useState<LookTab | null>(null);
  const tab: LookTab = pickedTab !== null && tabs.some((t) => t.id === pickedTab)
    ? pickedTab
    : defaultLookTab(strip, selection);
  const visible = useMemo(() => strip.filter((i) => i.tab === tab), [strip, tab]);
  /** Tile labels for this row: a leading word the siblings share is dropped,
   *  so "Gold Confetti · Gold Border" reads "Confetti · Border". */
  const labels = useMemo(() => {
    const l = deckLabels(visible.map((i) => i.title));
    return new Map(visible.map((i, k) => [i.exp.id, l[k]]));
  }, [visible]);
  const inUse = useMemo(() => tabsInUse(strip, selection, sparkles), [strip, selection, sparkles]);
  /** A look to centre once its tab has rendered (set when a switch is needed). */
  const focusRef = useRef<string | null>(null);

  // Swipe UP on the strip opens "More looks" — the camera-app gesture, on top
  // of the labelled button (which stays the obvious way in).
  const swipeRef = useRef<{ x: number; y: number } | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());

  /** Bring a tile to the middle of the strip without scrolling the page. */
  const centre = (id: string) => {
    const scroller = scrollerRef.current;
    const tile = tileRefs.current.get(id);
    if (!scroller || !tile) return;
    const left = centeredScrollLeft(tile.offsetLeft, tile.offsetWidth, scroller.clientWidth, scroller.scrollWidth);
    scroller.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
  };

  // ── Name pill: announce whatever just went on, from ANY route (a tile, the
  // sheet, a stage swipe, the event default arriving).
  const [named, setNamed] = useState<{ key: number; text: string } | null>(null);
  const prevSelRef = useRef<DeckSelection | null>(null);
  /** Set by "Surprise me" just before it applies, so the pill names the whole
   *  combination ("Confetti + Tiara") rather than only its frame. */
  const surpriseTextRef = useRef<string | null>(null);
  useEffect(() => {
    const change = changedLook(strip, prevSelRef.current, selection);
    prevSelRef.current = selection;
    const surprised = surpriseTextRef.current;
    surpriseTextRef.current = null;
    if (change === null) return;
    setNamed({ key: Date.now(), text: surprised ?? (change.on ? change.name : `${change.name} off`) });
    if (change.on) {
      // A look put on from the sheet (or a default arriving) shows its tab.
      const home = tabOfLook(strip, change.id);
      if (home !== null && home !== tab) {
        focusRef.current = change.id;
        setPickedTab(home);
      } else {
        centre(change.id);
      }
    }
    // centre reads refs only; strip/selection are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip, selection]);

  // A tab switch starts its row at the beginning — or on the look that caused it.
  useEffect(() => {
    const focus = focusRef.current;
    focusRef.current = null;
    if (focus !== null) { centre(focus); return; }
    scrollerRef.current?.scrollTo({ left: 0, behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  useEffect(() => {
    if (named === null) return;
    const t = window.setTimeout(() => setNamed(null), LOOK_NAME_MS);
    return () => window.clearTimeout(t);
  }, [named]);

  // On first paint, show the applied look (an event default) mid-strip.
  const centredOnceRef = useRef(false);
  useEffect(() => {
    if (centredOnceRef.current || activeIds.size === 0) return;
    centredOnceRef.current = true;
    const first = visible.find((i) => activeIds.has(i.exp.id));
    if (first) {
      const scroller = scrollerRef.current;
      const tile = tileRefs.current.get(first.exp.id);
      if (scroller && tile) {
        scroller.scrollLeft = centeredScrollLeft(tile.offsetLeft, tile.offsetWidth, scroller.clientWidth, scroller.scrollWidth);
      }
    }
  }, [activeIds, visible]);

  // ── First-run hint: once per device, one nudge, then never again.
  const [hint, setHint] = useState(false);
  const hintDoneRef = useRef(false);
  useEffect(() => {
    if (!hintEnabled || hintDoneRef.current) return;
    const storage = safeStorage();
    if (!shouldShowLookHint(lookHintSeen(storage), visible.length)) return;
    const t = window.setTimeout(() => {
      hintDoneRef.current = true;
      markLookHintSeen(storage);
      setHint(true);
      // The nudge: slide the strip a tile's width and back, so the peek reads
      // as movable. Skipped under reduced motion — the pill says it in words.
      const scroller = scrollerRef.current;
      if (!reduced && scroller && scroller.scrollLeft === 0) {
        scroller.scrollTo({ left: 70, behavior: 'smooth' });
        window.setTimeout(() => scroller.scrollTo({ left: 0, behavior: 'smooth' }), 650);
      }
    }, LOOK_HINT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [hintEnabled, visible.length, reduced]);
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(false), LOOK_HINT_MS);
    return () => window.clearTimeout(t);
  }, [hint]);
  useEffect(() => { if (sheetOpen) setHint(false); }, [sheetOpen]);

  // ── "Hold for video": once per device, after the swipe hint has had its turn.
  const [holdTip, setHoldTip] = useState(false);
  const holdTipDoneRef = useRef(false);
  useEffect(() => {
    if (!holdForVideo || !hintEnabled || hint || recording || holdTipDoneRef.current) return;
    const storage = safeStorage();
    if (holdTipSeen(storage)) { holdTipDoneRef.current = true; return; }
    const t = window.setTimeout(() => {
      holdTipDoneRef.current = true;
      markHoldTipSeen(storage);
      setHoldTip(true);
    }, HOLD_TIP_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [holdForVideo, hintEnabled, hint, recording]);
  useEffect(() => {
    if (!holdTip) return;
    const t = window.setTimeout(() => setHoldTip(false), HOLD_TIP_MS);
    return () => window.clearTimeout(t);
  }, [holdTip]);
  useEffect(() => { if (recording || sheetOpen) setHoldTip(false); }, [recording, sheetOpen]);

  const none = deckNoneTile(tab, strip, selection, sparkles);

  // ── Surprise me: one tap, a random combination that works together
  // (lib/lookSurprise — same slot rules as the tiles).
  const showSurprise = canSurprise(strip, selection);
  /** Bumped per tap — drives the dice's tumble. */
  const [rolls, setRolls] = useState(0);
  const surprise = () => {
    const s = pickSurprise(strip, Math.random, selection);
    if (s === null) return;
    haptic('select');
    setHint(false);
    setRolls((n) => n + 1);
    surpriseTextRef.current = surpriseAnnouncement(s);
    for (const a of s.actions) runLookAction(a, handlers);
  };

  return (
    <div
      className="pb-safe-bottom [--safe-bottom:0.9rem] flex flex-col items-center gap-2.5 pt-12"
      style={{
        // A fade, not a panel: the frame stays visible right down to the
        // shutter, which is what makes it feel like a camera.
        background: 'linear-gradient(to top, rgba(5,6,11,0.9) 30%, rgba(5,6,11,0.45) 68%, transparent)',
      }}
    >
      {/* Guest colour row — only when the applied 3D piece invites it. */}
      {colorSlot != null && onGuestHex && (
        <div className="flex w-full max-w-md items-center gap-2 px-4">
          <span className="shrink-0 font-sans text-[12px] text-brand-muted/80">{colorSlot.label}</span>
          <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar">
            {colorSlot.swatches.map((hex) => {
              const on = (guestHex ?? colorSlot.currentHex) === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={colorSlot.names?.[hex] ?? `Colour ${hex}`}
                  aria-pressed={on}
                  onClick={() => { haptic('toggle'); onGuestHex(hex === colorSlot.currentHex ? null : hex); }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                >
                  <span
                    className="h-7 w-7 rounded-full transition-shadow"
                    style={{
                      background: colorSlot.fills?.[hex] ?? hex,
                      boxShadow: on
                        ? '0 0 0 2px var(--color-accent), 0 0 10px rgba(var(--accent-rgb),0.8)'
                        // Glass bead: a white rim and a specular lip, so the
                        // swatches match the booth's other glass controls.
                        : 'inset 0 0 0 1.5px rgba(255,255,255,0.5), inset 0 7px 8px -7px rgba(255,255,255,0.75), 0 2px 6px -2px rgba(0,0,0,0.55)',
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* The strip, with its name pill / first-run hint floating above it. */}
      <div className="relative w-full max-w-md">
        <div aria-live="polite" className="pointer-events-none absolute inset-x-0 -top-9 flex justify-center">
          <AnimatePresence mode="wait">
            {named !== null ? (
              <motion.span
                key={named.key}
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: reduced ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="liquid-glass-raised max-w-[80%] truncate rounded-full px-3.5 py-1.5 font-sans text-[13px] font-semibold text-brand-fg"
              >
                {named.text}
              </motion.span>
            ) : hint ? (
              <motion.span
                key="hint"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: reduced ? 0 : 0.3 }}
                className="liquid-glass-raised flex items-center gap-2 rounded-full px-3.5 py-1.5 font-sans text-[13px] text-brand-fg"
              >
                <ArrowLeftRight className="h-3.5 w-3.5 text-[color:var(--color-accent)]" />
                Swipe for more looks
              </motion.span>
            ) : holdTip ? (
              <motion.span
                key="hold"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: reduced ? 0 : 0.3 }}
                className="liquid-glass-raised flex items-center gap-2 rounded-full px-3.5 py-1.5 font-sans text-[13px] text-brand-fg"
              >
                <Circle className="h-3 w-3 fill-red-500 text-red-500" />
                Tap for a photo · hold for video
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Tabs: which KIND of look the row below holds. Hidden when there is
            only one kind (an event with nothing but effects). */}
        {tabs.length > 1 && (
          <div role="tablist" aria-label="Kinds of looks" className="flex items-center justify-center gap-0.5 px-3">
            {tabs.map((t) => {
              const on = t.id === tab;
              const dot = !on && inUse.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`look-tab-${t.id}`}
                  aria-selected={on}
                  aria-controls="look-row"
                  onClick={() => {
                    if (on) return;
                    haptic('select');
                    setHint(false);
                    setPickedTab(t.id);
                  }}
                  className="relative flex min-h-11 items-center px-1 font-sans text-[14px] leading-none"
                >
                  <span
                    className="relative flex h-8 items-center rounded-full px-3.5 transition-colors"
                    style={{
                      color: on ? 'var(--color-brand-fg)' : 'rgba(232,235,250,0.78)',
                      fontWeight: on ? 650 : 500,
                      textShadow: on ? undefined : '0 1px 3px rgba(0,0,0,0.75)',
                    }}
                  >
                    {on && (
                      <motion.span
                        aria-hidden
                        layoutId="look-tab-pill"
                        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38 }}
                        // The shared liquid-glass pill (same glass as every booth
                        // button). `position` is pinned inline: the glass
                        // classes set `position: relative` for their rim.
                        className="liquid-glass-raised is-selected inset-0 rounded-full"
                        style={{ position: 'absolute' }}
                      />
                    )}
                    <span className="relative">{t.label}</span>
                    {dot && (
                      <span
                        aria-hidden
                        className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
                        style={{ background: 'var(--color-accent)', boxShadow: '0 0 0 1.5px rgba(5,6,11,0.7)' }}
                      />
                    )}
                  </span>
                  {dot && <span className="sr-only"> (has a look on)</span>}
                </button>
              );
            })}
          </div>
        )}

        <div
          ref={scrollerRef}
          id="look-row"
          role={tabs.length > 1 ? 'tabpanel' : 'group'}
          aria-labelledby={tabs.length > 1 ? `look-tab-${tab}` : undefined}
          aria-label={tabs.length > 1 ? undefined : 'Looks'}
          onPointerDown={(e) => { setHint(false); swipeRef.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={(e) => {
            const start = swipeRef.current;
            swipeRef.current = null;
            if (start && !recording && isSwipeUp(e.clientX - start.x, e.clientY - start.y)) {
              haptic('tap');
              onOpenAll();
            }
          }}
          onPointerCancel={() => { swipeRef.current = null; }}
          className="flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-0.5 pt-2 hide-scrollbar"
          style={{
            // Sideways is the strip's own scroll; vertical moves stay with us
            // (the swipe-up above) instead of being claimed by the browser.
            touchAction: 'pan-x',
            // Faded edges: the next tile peeks through, which is what says
            // "swipe" before anyone has to read a word.
            WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 30px), transparent 100%)',
            maskImage: 'linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 30px), transparent 100%)',
          }}
        >
          {showSurprise && (
            <Tile
              active={false}
              label="Surprise"
              ariaLabel="Surprise me — try a random look"
              onClick={surprise}
            >
              <span
                className="flex h-full w-full items-center justify-center"
                style={{ background: 'radial-gradient(circle at 35% 30%, rgba(var(--accent-rgb),0.42), rgba(var(--accent-rgb),0.12) 70%)' }}
              >
                {/* A tumble per roll; under reduced motion the dice just sits. */}
                <motion.span
                  aria-hidden
                  className="flex"
                  animate={reduced ? { rotate: 0, scale: 1 } : { rotate: rolls * 360, scale: rolls > 0 ? [1, 1.22, 1] : 1 }}
                  transition={reduced
                    ? { duration: 0 }
                    : { rotate: { type: 'spring', stiffness: 210, damping: 15 }, scale: { duration: 0.42, ease: 'easeOut' } }}
                >
                  <Dices className="h-[22px] w-[22px] text-brand-fg" strokeWidth={1.8} />
                </motion.span>
              </span>
            </Tile>
          )}
          {/* "None" takes off only THIS tab's look; the rest of the combined
              look stays on (lib/lookStrip deckNoneTile). Clearing everything
              lives in the "More looks" sheet. */}
          <Tile
            active={none.lit}
            label="None"
            ariaLabel={`${LOOK_NONE_LABEL[tab]} — keep your other looks`}
            onClick={() => {
              haptic('select');
              setHint(false);
              if (none.action !== null) runLookAction(none.action, handlers);
              if (none.sparklesOff) onToggleSparkles(false);
            }}
          >
            {/* A plain icon: this used to be a live camera preview, which cost
                the booth frame rate (Dapo, Nov 28 2026). */}
            <Ban className="h-4 w-4 text-brand-muted/70" />
          </Tile>
          {tab === 'effects' && (
          <Tile
            active={sparkles}
            label="Sparkle"
            ariaLabel={sparkles ? 'Sparkle on — layers over any look' : 'Sparkle — layers over any look'}
            onClick={() => {
              haptic('select');
              onToggleSparkles(!sparkles);
              setNamed({ key: Date.now(), text: sparkles ? 'Sparkle off' : 'Sparkle' });
            }}
          >
            <span className="flex h-full w-full items-center justify-center" style={{ background: 'rgba(var(--accent-rgb), 0.2)' }}>
              <Sparkles className="h-5 w-5 text-brand-fg/85" />
            </span>
          </Tile>
          )}
          {visible.length > 0 && <Divider />}

          {visible.map((item) => {
            const on = activeIds.has(item.exp.id);
            return (
              <Tile
                key={item.exp.id}
                tileRef={(el) => {
                  if (el) tileRefs.current.set(item.exp.id, el);
                  else tileRefs.current.delete(item.exp.id);
                }}
                active={on}
                label={labels.get(item.exp.id) ?? item.label}
                ariaLabel={`${item.title} (${LOOK_TAB_SHORT[item.tab]})`}
                pending={on && (pendingIds?.has(item.exp.id) ?? false)}
                onClick={() => {
                  haptic('select');
                  setHint(false);
                  runLookAction(lookTapAction(item, on), handlers);
                }}
              >
                <LookThumb item={item} />
              </Tile>
            );
          })}
          {/* Trailing gutter so the last tile can snap clear of the faded edge. */}
          <span aria-hidden className="w-4 shrink-0" />
        </div>
      </div>

      {/* Shutter row: strip + hide controls · SHUTTER (tap = photo, hold =
          video) · More looks. The Photo / Video switch is gone. */}
      <div className="relative flex min-h-[76px] w-full max-w-md items-center justify-center px-3">
        {/* Wrapped like More looks: the glass classes set `position:
            relative`, which would put the pill back in flow. */}
        {!recording && (
          <div className="absolute left-3">
            <div className="liquid-glass-raised flex items-center gap-0.5 rounded-full p-0.5">
              {onOpenStripPicker && (
                <button
                  type="button"
                  onClick={() => { haptic('tap'); onOpenStripPicker(); }}
                  aria-label={stripMode ? `Photo strip on, ${stripShots ?? ''} shots — change or turn off` : 'Photo strip — choose how many shots'}
                  aria-pressed={stripMode}
                  className={`pressable relative flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                    stripMode ? 'is-selected bg-foil text-[color:var(--on-accent)]' : 'text-brand-fg/85'
                  }`}
                >
                  <Film className="h-[18px] w-[18px]" />
                  {stripMode && stripShots != null && (
                    <span
                      className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full font-label text-[10px] font-bold"
                      style={{ background: 'var(--color-accent)', color: 'var(--on-accent)', boxShadow: '0 0 6px rgba(var(--accent-rgb),0.8)' }}
                    >
                      {stripShots}
                    </span>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => { haptic('toggle'); onHideControls(); }}
                aria-label="Hide controls — see the full frame"
                title="Hide controls"
                className="pressable flex h-10 w-10 items-center justify-center rounded-full text-brand-fg/85"
              >
                <EyeOff className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
        )}

        {shutter}

        {/* Wrapped: the glass classes set `position: relative` for their rim,
            which would put the pill back in flow and shove the shutter left. */}
        {!recording && (
          <div className="absolute right-3">
          <button
            type="button"
            onClick={() => { haptic('tap'); setHint(false); onOpenAll(); }}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className="pressable liquid-glass-raised flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full pl-3 pr-3.5 font-sans text-[13px] font-medium text-brand-fg"
          >
            {/* One soft ring, once, when the first-run hint appears. */}
            {hint && !reduced && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0.7, scale: 1 }}
                animate={{ opacity: 0, scale: 1.3 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{ boxShadow: '0 0 0 2px rgba(var(--accent-rgb),0.8)' }}
              />
            )}
            <LayoutGrid className="h-4 w-4 text-[color:var(--color-accent)]" />
            More looks
          </button>
          </div>
        )}
      </div>
    </div>
  );
}
