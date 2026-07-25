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
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Ban, Camera as CameraIcon, Clock, Crown, Sparkles, Video } from 'lucide-react';
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
  active, label, onClick, children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
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
      </motion.span>
      <span
        className="max-w-[52px] truncate text-center font-label text-[8px] uppercase tracking-wide leading-none transition-colors"
        style={{ color: active ? 'var(--color-accent)' : 'rgba(169,180,204,0.6)' }}
      >
        {label}
      </span>
    </button>
  );
}

function OrbThumb({ category, exp, shaderId }: { category: DeckCategory; exp: Experience; shaderId: string | null }) {
  if (category === 'effect') {
    return (
      <span
        className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${
          EFFECT_GRADIENT[shaderId ?? ''] ?? 'from-[color:var(--color-accent-3)] to-[color:var(--color-accent)]'
        }`}
      >
        <Sparkles className="h-4 w-4 text-noir-900/45" />
      </span>
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
  onSelectEffect: (shaderId: string) => void;
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
}

export default function BoothControlDeck<T extends number>({
  sections, selection, category, onCategory,
  sparkles, onToggleSparkles, onSelectEffect, onSelectFrame, onSelectAttachment,
  onClearAll, onOpenAll,
  mediaMode, onMediaMode, videoAllowed, timerSec, onTimerSec, timerOptions,
  recording, shutter,
}: BoothControlDeckProps<T>) {
  const [timerOpen, setTimerOpen] = useState(false);
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
      {/* Category tabs + the mode/timer controls, in ONE row — the old deck
          spent a whole third cluster on these. */}
      <div className="flex w-full max-w-md items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          {sections.map((s) => {
            const on = active?.key === s.key;
            const dotted = sectionHasSelection(s, selection);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => { haptic('tap'); onCategory(s.key); }}
                aria-pressed={on}
                className="relative min-h-11 pb-1 font-label text-[10px] uppercase tracking-[0.24em] transition-colors"
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
                    className="absolute bottom-0 left-1/2 h-px w-6 -translate-x-1/2"
                    style={{ background: 'var(--color-brand-fg)' }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Photo / video */}
          <div className="liquid-glass-inset flex items-center gap-0.5 rounded-full p-0.5">
            <button
              type="button"
              onClick={() => { if (!recording) { haptic('toggle'); onMediaMode('photo'); } }}
              disabled={recording}
              aria-label="Photo mode"
              aria-pressed={mediaMode === 'photo'}
              className={`pressable flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                mediaMode === 'photo' ? 'bg-foil text-[color:var(--on-accent)]' : 'text-brand-muted/70'
              }`}
            >
              <CameraIcon className="h-3.5 w-3.5" />
            </button>
            {videoAllowed && (
              <button
                type="button"
                onClick={() => { if (!recording) { haptic('toggle'); onMediaMode('video'); } }}
                disabled={recording}
                aria-label="Video mode"
                aria-pressed={mediaMode === 'video'}
                className={`pressable flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  mediaMode === 'video' ? 'bg-foil text-[color:var(--on-accent)]' : 'text-brand-muted/70'
                }`}
              >
                <Video className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Timer */}
          {mediaMode === 'photo' && !recording && (
            <div className="relative">
              <button
                type="button"
                onClick={() => { haptic('tap'); setTimerOpen((o) => !o); }}
                aria-label="Self-timer"
                aria-expanded={timerOpen}
                className={`pressable liquid-glass-inset flex h-9 min-w-9 items-center gap-1 rounded-full px-2.5 font-label text-[9px] uppercase tracking-wide transition-colors ${
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
                    className="liquid-glass-raised absolute bottom-11 right-0 z-30 flex gap-1 rounded-2xl p-1.5"
                  >
                    {timerOptions.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { haptic('select'); onTimerSec(t); setTimerOpen(false); }}
                        className={`pressable h-9 w-10 rounded-xl font-label text-[10px] transition-colors ${
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

      {/* Orb row for the active category. */}
      {active && (
        <div className="flex w-full max-w-md items-start justify-start gap-2 overflow-x-auto hide-scrollbar px-0.5">
          <Orb
            active={isPristine(selection, sparkles)}
            label="Clear"
            onClick={() => choose(onClearAll)}
          >
            <Ban className="h-4 w-4 text-brand-muted/60" />
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
                onClick={() =>
                  choose(() => {
                    if (active.key === 'effect') {
                      onSelectEffect(on ? 'none' : o.shaderId ?? 'none');
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

      {shutter}
    </div>
  );
}
