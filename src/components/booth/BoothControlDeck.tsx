/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BoothControlDeck — the booth's camera-app control deck.
 *
 * Replaces the old FilterOrbs rail, which showed Quick · Effects · Frames · 3D
 * all at once in one scrolling row with dividers and group labels: everything
 * present, nothing findable. This is the landing demo's shape instead
 * (CameraExperience.tsx): category tabs → one orb row → shutter. One decision
 * at a time.
 *
 * Deliberately token-driven — the selected ring, glow and shutter all derive
 * from `--color-accent` / `--accent-rgb`, so the three legacy event sites
 * render these shapes in their own gold-and-champagne palette rather than the
 * platform's blue. The per-option identity comes from each experience's REAL
 * thumbnail, which is better than the demo's invented hues.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Ban, Camera as CameraIcon, Clock, Crown, Film, Sparkles, Video } from 'lucide-react';
import FilterThumb from './FilterThumb';
import type { Experience } from '../../types';
import {
  activeOptionId,
  isPristine,
  sectionHasSelection,
  type DeckCategory,
  type DeckSection,
  type DeckSelection,
} from '../../lib/boothDeck';
import { haptic } from '../../lib/haptics';
import type { GuestColorSlot } from '../../lib/guestPalette';

const EFFECT_GRADIENT: Record<string, string> = {
  'champagne-sparkle': 'from-yellow-200 to-amber-400',
  'golden-hour-bloom': 'from-amber-300 to-orange-500',
  'prismatic-holo': 'from-violet-400 to-cyan-400',
  'aureate-god-rays': 'from-yellow-400 to-amber-700',
  'velvet-film': 'from-stone-400 to-stone-700',
  'crystalline-kaleidoscope': 'from-cyan-300 to-blue-600',
  'celestial-lens-flare': 'from-amber-200 to-yellow-600',
  'aurora-lumina': 'from-yellow-200 to-amber-500',
};

/* ── Orb ──────────────────────────────────────────────────────────────── */

function Orb({
  active, label, onClick, pending = false, children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  /** The asset this orb applies is still downloading. Shows a sweeping ring so
   *  "I tapped it and nothing happened" becomes "it's coming" — on venue wifi a
   *  frame or GLB can take seconds, and the orb used to look done instantly. */
  pending?: boolean;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-busy={pending || undefined}
      className="group flex w-[52px] shrink-0 flex-col items-center gap-1.5"
    >
      <motion.span
        // The selected orb pops once on selection — the distinct "it landed"
        // moment. Under reduced motion it simply appears selected.
        animate={reduced ? { scale: active ? 1.06 : 1 } : { scale: active ? 1.09 : 1 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 18 }}
        className="pressable relative flex h-[46px] w-[46px] items-center justify-center overflow-hidden rounded-full"
        style={{
          background: 'rgba(9, 11, 20, 0.6)',
          border: active
            ? '1.5px solid var(--color-accent)'
            : '1.5px solid rgba(255,255,255,0.16)',
          boxShadow: active
            ? '0 0 20px -2px rgba(var(--accent-rgb), 0.85), inset 0 1px 0 rgba(255,255,255,0.28)'
            : 'inset 0 1px 0 rgba(255,255,255,0.14), 0 2px 6px -2px rgba(0,0,0,0.6)',
        }}
      >
        {children}
        {pending && (
          <span
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background: 'rgba(5,6,11,0.55)',
              // Two-stop conic sweep = a spinner with no extra DOM. Reduced
              // motion keeps the dimming and the ring but drops the rotation.
              WebkitMaskImage: 'radial-gradient(circle, transparent 58%, #000 60%)',
              maskImage: 'radial-gradient(circle, transparent 58%, #000 60%)',
            }}
          />
        )}
        {pending && (
          <span
            className={reduced ? '' : 'animate-spin'}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '9999px',
              border: '2px solid transparent',
              borderTopColor: 'var(--color-accent)',
              borderRightColor: 'rgba(var(--accent-rgb),0.35)',
            }}
          />
        )}
      </motion.span>
      <span
        className="max-w-[56px] truncate text-center font-label text-[10px] uppercase tracking-wide leading-none transition-colors"
        style={{ color: active ? 'var(--color-accent)' : 'rgba(169,180,204,0.75)' }}
      >
        {label}
      </span>
    </button>
  );
}

function OrbThumb({ category, exp, shaderId }: { category: DeckCategory; exp: Experience; shaderId: string | null }) {
  if (category === 'effect') {
    // The gradient + generic sparkle glyph is now the FALLBACK, drawn
    // underneath. When the shared thumbnail engine is running, the orb shows
    // the guest's own face through this exact shader — which is the only way
    // to tell "Prismatic Holo" from "Aurora Lumina" without applying both.
    return (
      <FilterThumb shaderId={shaderId ?? 'none'}>
        <span
          className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${
            EFFECT_GRADIENT[shaderId ?? ''] ?? 'from-[color:var(--color-accent-3)] to-[color:var(--color-accent)]'
          }`}
        >
          <Sparkles className="h-4 w-4 text-noir-900/45" />
        </span>
      </FilterThumb>
    );
  }
  const src = exp.thumbnail_url ?? (category === 'frame' ? exp.asset_url : null);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={exp.thumbnail_url ? 'h-full w-full object-cover' : 'h-full w-full object-contain p-0.5'}
      />
    );
  }
  if (category === 'frame') {
    return (
      <span
        className="h-6 w-[17px] rounded-[4px]"
        style={{
          border: '2px solid var(--color-accent)',
          boxShadow: 'inset 0 0 6px -2px rgba(var(--accent-rgb),0.9)',
        }}
      />
    );
  }
  return <Crown className="h-5 w-5 text-[color:var(--color-accent)]" />;
}

/* ── Deck ─────────────────────────────────────────────────────────────── */

export interface BoothControlDeckProps<T extends number = number> {
  sections: DeckSection[];
  selection: DeckSelection;
  category: DeckCategory | null;
  onCategory: (c: DeckCategory) => void;
  sparkles: boolean;
  onToggleSparkles: (v: boolean) => void;
  /** The Experience is passed too: a shader carries its own config.triggers,
   *  and dropping it here is what made filter-only trigger scenes inert. */
  onSelectEffect: (shaderId: string, exp: Experience | null) => void;
  onSelectFrame: (exp: Experience | null) => void;
  onSelectAttachment: (exp: Experience | null) => void;
  onClearAll: () => void;
  /** "All filters" escape hatch — the full catalogue sheet. */
  onOpenAll: () => void;
  mediaMode: 'photo' | 'video';
  onMediaMode: (m: 'photo' | 'video') => void;
  videoAllowed: boolean;
  /** The booth's own TimerOption union — kept narrow so a stray value can't
   *  reach setTimerSec. */
  timerSec: T;
  onTimerSec: (s: T) => void;
  timerOptions: readonly T[];
  recording: boolean;
  /** The shutter itself stays in Booth — it owns capture, recording and the
   *  progress ring. The deck just gives it a home. */
  shutter: ReactNode;
  /** Experience ids whose assets are still downloading. Absent ⇒ no orb ever
   *  shows a pending ring, i.e. exactly today's rendering. */
  pendingIds?: ReadonlySet<string>;
  /** Photo-strip mode: 2 or 3 shots composited into one keepsake card.
   *  Optional so the deck stays usable by any surface that doesn't offer it. */
  stripMode?: boolean;
  onStripMode?: (on: boolean) => void;
  /** Shots the armed strip will take — shown as a badge on the strip button. */
  stripShots?: number;
  /** Opens the 2-vs-3 shot picker; the deck never arms strip mode directly. */
  onOpenStripPicker?: () => void;
  /**
   * Guest colour picker (lib/guestPalette.ts) — present only when the active
   * 3D piece carries a guest-pickable region. Absent ⇒ the deck renders
   * byte-identically to today (every legacy surface).
   */
  colorSlot?: GuestColorSlot | null;
  /** The guest's current pick (null = the host's default). */
  guestHex?: string | null;
  onGuestHex?: (hex: string | null) => void;
}

export default function BoothControlDeck<T extends number>({
  sections, selection, category, onCategory,
  sparkles, onToggleSparkles, onSelectEffect, onSelectFrame, onSelectAttachment,
  onClearAll, onOpenAll,
  mediaMode, onMediaMode, videoAllowed, timerSec, onTimerSec, timerOptions,
  recording, shutter, pendingIds, stripMode = false, onStripMode,
  stripShots, onOpenStripPicker,
  colorSlot = null, guestHex = null, onGuestHex,
}: BoothControlDeckProps<T>) {
  const [timerOpen, setTimerOpen] = useState(false);
  /** The open popover sits over the shutter's corner — without light dismissal
   *  it blocked the very control the guest reaches for next. */
  const timerWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!timerOpen) return;
    const onDown = (e: PointerEvent) => {
      if (timerWrapRef.current && e.target instanceof Node && !timerWrapRef.current.contains(e.target)) {
        setTimerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTimerOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [timerOpen]);
  const active = sections.find((s) => s.key === category) ?? sections[0] ?? null;
  const activeId = active ? activeOptionId(active, selection) : null;

  const choose = (fn: () => void) => {
    haptic('select');
    fn();
  };

  return (
    <div
      className="pb-safe-bottom [--safe-bottom:0.9rem] flex flex-col items-center gap-2.5 px-3 pt-8"
      style={{
        // A gradient scrim rather than a panel: the frame stays visible right
        // down to the shutter, which is what makes the demo feel like a camera
        // app instead of a form.
        background:
          'linear-gradient(to top, rgba(5,6,11,0.92) 26%, rgba(5,6,11,0.5) 66%, transparent)',
      }}
    >
      {/* Category tabs — centered over the orbs they switch, with a gradient
          underline + glow so the active tab is unmistakable. The mode/timer
          cluster moved down beside the shutter, camera-app style, so these
          tabs no longer read as left-justified leftovers. */}
      <div className="flex w-full max-w-md items-center justify-center gap-7">
        {sections.map((s) => {
          const on = active?.key === s.key;
          const dotted = sectionHasSelection(s, selection);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => { haptic(on ? 'tap' : 'select'); onCategory(s.key); }}
              aria-pressed={on}
              // min-w-11 as well as min-h-11: "3D" is a two-character label,
              // so the tab was a 44px-tall but 18px-wide target.
              className="relative min-h-11 min-w-11 pb-1.5 font-label text-[11px] uppercase tracking-[0.24em] transition-colors"
              style={{ color: on ? 'var(--color-brand-fg)' : 'rgba(169,180,204,0.55)' }}
            >
              {s.label}
              {dotted && (
                <span
                  className="absolute -right-2.5 top-2 h-1.5 w-1.5 rounded-full"
                  style={{
                    background: 'var(--color-accent)',
                    boxShadow: '0 0 6px rgba(var(--accent-rgb),0.9)',
                  }}
                />
              )}
              {on && (
                <motion.span
                  layoutId="deck-tab-underline"
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foil"
                  style={{ boxShadow: '0 0 10px rgba(var(--accent-rgb),0.85)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Guest colour row — only when the scene's 3D piece invites it. Sits
          above the orbs, in the 3D category, so it reads as "your visor, your
          colour" next to the piece that wears it. */}
      {colorSlot != null && onGuestHex && active?.key === 'prop' && (
        <div className="flex w-full max-w-md items-center gap-2 px-0.5">
          <span className="font-label text-[9px] uppercase tracking-[0.24em] text-brand-muted/60 shrink-0">
            {colorSlot.label}
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
            {colorSlot.swatches.map((hex) => {
              const on = (guestHex ?? colorSlot.currentHex) === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Colour ${hex}`}
                  aria-pressed={on}
                  onClick={() => {
                    haptic('toggle');
                    onGuestHex(hex === colorSlot.currentHex ? null : hex);
                  }}
                  className="h-7 w-7 shrink-0 rounded-full transition-shadow"
                  style={{
                    background: hex,
                    boxShadow: on
                      ? '0 0 0 1.5px var(--color-accent), 0 0 10px rgba(var(--accent-rgb),0.8)'
                      : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Orb row for the active category. */}
      {active && (
        <div className="flex w-full max-w-md items-start justify-start gap-2 overflow-x-auto hide-scrollbar px-0.5">
          <Orb
            active={isPristine(selection, sparkles)}
            label="Clear"
            onClick={() => choose(onClearAll)}
          >
            {/* "Clear" previews the untouched camera, so the guest can see
                what they are going back TO before they tap it. */}
            <FilterThumb shaderId="none">
              <Ban className="h-4 w-4 text-brand-muted/60" />
            </FilterThumb>
          </Orb>
          <Orb
            active={sparkles}
            label="Sparkle"
            onClick={() => choose(() => onToggleSparkles(!sparkles))}
          >
            <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[color:var(--color-accent-2)] to-[color:var(--color-accent)]">
              <Sparkles className="h-4 w-4 text-noir-900/55" />
            </span>
          </Orb>

          {active.options.map((o) => {
            const on = activeId === o.exp.id;
            return (
              <Orb
                key={o.exp.id}
                active={on}
                label={o.label}
                pending={on && (pendingIds?.has(o.exp.id) ?? false)}
                onClick={() =>
                  choose(() => {
                    if (active.key === 'effect') {
                      onSelectEffect(on ? 'none' : o.shaderId ?? 'none', on ? null : o.exp);
                    } else if (active.key === 'frame') {
                      onSelectFrame(on ? null : o.exp);
                    } else {
                      onSelectAttachment(on ? null : o.exp);
                    }
                  })
                }
              >
                <OrbThumb category={active.key} exp={o.exp} shaderId={o.shaderId} />
              </Orb>
            );
          })}

          <Orb active={false} label="All" onClick={() => { haptic('tap'); onOpenAll(); }}>
            <span className="font-label text-[13px] leading-none text-brand-muted/70">···</span>
          </Orb>
        </div>
      )}

      {/* Shutter row — capture-mode pill on the left, shutter centered, timer
          on the right. One contained, symmetric cluster: the timer used to sit
          in the tab row's right corner, where it clipped against the viewport
          edge and its popover escaped the screen. */}
      <div className="relative flex min-h-[76px] w-full max-w-md items-center justify-center">
        {/* Capture mode. The icons stay 32px so the cluster fits a 360px
            phone, but each carries a `-inset-1.5` pseudo-element, so the real
            TOUCH target is 44px — the accessibility minimum — while the
            visual stays compact. */}
        <div className="liquid-glass-inset absolute left-1 flex items-center gap-0.5 rounded-full p-0.5">
          <button
            type="button"
            onClick={() => { if (!recording) { haptic('toggle'); onMediaMode('photo'); onStripMode?.(false); } }}
            disabled={recording}
            aria-label="Photo mode"
            aria-pressed={mediaMode === 'photo' && !stripMode}
            className={`pressable relative flex h-8 w-8 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1.5 after:rounded-full after:content-[''] ${
              mediaMode === 'photo' && !stripMode ? 'bg-foil text-[color:var(--on-accent)]' : 'text-brand-muted/70'
            }`}
          >
            <CameraIcon className="h-3.5 w-3.5" />
          </button>
          {onOpenStripPicker && (
            <button
              type="button"
              onClick={() => { if (!recording) { haptic('tap'); onOpenStripPicker(); } }}
              disabled={recording}
              aria-label="Photo strip — choose 2 or 3 shots"
              aria-pressed={mediaMode === 'photo' && stripMode}
              className={`pressable relative flex h-8 w-8 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1.5 after:rounded-full after:content-[''] ${
                mediaMode === 'photo' && stripMode ? 'bg-foil text-[color:var(--on-accent)]' : 'text-brand-muted/70'
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              {mediaMode === 'photo' && stripMode && stripShots != null && (
                <span
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full font-label text-[8px] font-bold"
                  style={{
                    background: 'var(--color-accent)',
                    color: 'var(--on-accent)',
                    boxShadow: '0 0 6px rgba(var(--accent-rgb),0.8)',
                  }}
                >
                  {stripShots}
                </span>
              )}
            </button>
          )}
          {videoAllowed && (
            <button
              type="button"
              onClick={() => { if (!recording) { haptic('toggle'); onMediaMode('video'); onStripMode?.(false); } }}
              disabled={recording}
              aria-label="Video mode"
              aria-pressed={mediaMode === 'video'}
              className={`pressable relative flex h-8 w-8 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1.5 after:rounded-full after:content-[''] ${
                mediaMode === 'video' ? 'bg-foil text-[color:var(--on-accent)]' : 'text-brand-muted/70'
              }`}
            >
              <Video className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {shutter}

        {/* Timer — anchored to the cluster's right edge; the popover opens
            upward and right-aligned, so both stay inside the viewport. */}
        {mediaMode === 'photo' && !recording && (
          <div ref={timerWrapRef} className="absolute right-1">
            <button
              type="button"
              onClick={() => { haptic('tap'); setTimerOpen((o) => !o); }}
              aria-label="Self-timer"
              aria-expanded={timerOpen}
              className={`pressable liquid-glass-inset flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 font-label text-[9px] uppercase tracking-wide transition-colors ${
                timerSec === 0 ? 'text-brand-muted/70' : 'text-[color:var(--color-accent)]'
              }`}
            >
              <Clock className="h-3 w-3" />
              {timerSec === 0 ? '' : `${timerSec}s`}
            </button>
            <AnimatePresence>
              {timerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="liquid-glass-raised absolute bottom-full right-0 z-30 mb-2 flex gap-1 rounded-2xl p-1.5"
                >
                  {timerOptions.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { haptic('select'); onTimerSec(t); setTimerOpen(false); }}
                      className={`pressable h-11 w-11 rounded-xl font-label text-[10px] transition-colors ${
                        timerSec === t
                          ? 'bg-foil text-[color:var(--on-accent)]'
                          : 'text-brand-muted/70 hover:text-brand-fg'
                      }`}
                    >
                      {t === 0 ? 'Off' : `${t}s`}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
