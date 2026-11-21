/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LooksSheet — "More looks", the platform booth's full catalogue.
 *
 * A bottom sheet on a phone (thumb-reachable, the camera still visible above
 * it) and a side panel from `sm` up, where a bottom sheet would cover the very
 * stage the guest is dressing. Category chips narrow it; "All" keeps one
 * heading per category. Tapping a look applies it in place and the sheet stays
 * open, because looks combine (a frame + a 3D piece + an effect) — "Done"
 * closes it.
 *
 * Replaces PickerDrawer on platform events only; legacy events keep it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import LookThumb, { CATEGORY_ICON } from './LookThumb';
import { useStore } from '../../store';
import { isPristine, type DeckSection, type DeckSelection } from '../../lib/boothDeck';
import {
  activeLookIds,
  buildLookStrip,
  lookChips,
  looksForChip,
  lookTapAction,
  runLookAction,
  type LookChip,
  type LookHandlers,
} from '../../lib/lookStrip';
import { haptic } from '../../lib/haptics';

export interface LooksSheetProps extends LookHandlers {
  open: boolean;
  onClose: () => void;
  sections: DeckSection[];
  selection: DeckSelection;
  sparkles: boolean;
  onToggleSparkles: (v: boolean) => void;
  onClearAll: () => void;
  pendingIds?: ReadonlySet<string>;
}

export default function LooksSheet({
  open, onClose, sections, selection, sparkles, onToggleSparkles,
  onSelectEffect, onSelectFrame, onSelectAttachment, onClearAll, pendingIds,
}: LooksSheetProps) {
  const reduced = useReducedMotion() ?? false;
  const strip = useMemo(() => buildLookStrip(sections), [sections]);
  const activeIds = useMemo(() => activeLookIds(strip, selection), [strip, selection]);
  const chips = useMemo(() => lookChips(strip), [strip]);
  const [chip, setChip] = useState<LookChip>('all');
  // A chip that no longer exists (catalog changed) falls back to the first.
  const current: LookChip = chips.some((c) => c.key === chip) ? chip : (chips[0]?.key ?? 'all');
  const groups = looksForChip(strip, current);
  const handlers: LookHandlers = { onSelectEffect, onSelectFrame, onSelectAttachment };

  // Honest states for the event's own frames (the catalog alone cannot tell
  // "still loading" from "failed" from "genuinely none") — PickerDrawer's rule.
  const experiencesLoaded = useStore((s) => s.experiencesLoaded);
  const experiencesFailed = useStore((s) => s.experiencesFailed);
  const fetchExperiences = useStore((s) => s.fetchExperiences);
  const hasFrames = strip.some((i) => i.category === 'frame');

  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pristine = isPristine(selection, sparkles);
  const ease = [0.16, 1, 0.3, 1] as const;

  return (
    <AnimatePresence>
      {open && (
        <div key="looks-sheet" className="absolute inset-0 z-40">
          <motion.button
            type="button"
            aria-label="Close looks"
            data-testid="looks-backdrop"
            tabIndex={-1}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
            className="absolute inset-0 h-full w-full cursor-default bg-noir-900/45 backdrop-blur-[2px] sm:bg-noir-900/25"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Looks"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 32 }}
            transition={{ duration: reduced ? 0 : 0.32, ease }}
            // Positioning lives on this wrapper: the glass class below sets
            // `position: relative` for its rim and would un-anchor the sheet.
            className="absolute inset-x-0 bottom-0 flex max-h-[76%] flex-col sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-4 sm:max-h-none sm:w-[380px]"
          >
          <div className="liquid-glass-raised flex min-h-0 flex-1 flex-col rounded-t-[28px] pb-safe-bottom [--safe-bottom:0.75rem] sm:rounded-[28px] sm:pb-3">
            {/* Grab handle — a phone affordance; the side panel has none. */}
            <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/25 sm:hidden" />

            <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-3 sm:pt-5">
              <div className="min-w-0">
                <h2 className="font-serif text-[22px] font-semibold leading-tight text-brand-fg">Looks</h2>
                <p className="mt-0.5 font-sans text-[13px] leading-snug text-brand-muted/80">
                  Mix one of each: a frame, a 3D piece and an effect.
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => { haptic('tap'); onClose(); }}
                aria-label="Close looks"
                className="pressable liquid-glass-inset flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-fg/80"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>

            {chips.length > 1 && (
              <div role="tablist" aria-label="Look categories" className="flex shrink-0 gap-2 overflow-x-auto px-5 pb-3 pt-1 hide-scrollbar">
                {chips.map((c) => {
                  const on = c.key === current;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => { haptic('select'); setChip(c.key); }}
                      className={`pressable flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 font-sans text-[13px] font-medium transition-colors ${
                        on ? 'is-selected text-brand-fg' : 'liquid-glass-inset text-brand-muted/85 hover:text-brand-fg'
                      }`}
                      style={on ? { boxShadow: 'inset 0 0 0 1px rgba(var(--accent-rgb),0.6)' } : undefined}
                    >
                      {c.label}
                      <span className="font-sans text-[12px] tabular-nums text-brand-muted/70">{c.count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-3 hide-scrollbar">
              {(current === 'all' || current === 'effect') && (
                <button
                  type="button"
                  onClick={() => { haptic('toggle'); onToggleSparkles(!sparkles); }}
                  role="switch"
                  aria-checked={sparkles}
                  className="pressable liquid-glass-inset mb-4 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-4 py-2 text-left"
                >
                  <span className="flex items-center gap-3">
                    <Sparkles className="h-4 w-4 shrink-0 text-[color:var(--color-accent)]" />
                    <span className="flex flex-col">
                      <span className="font-sans text-[14px] font-medium text-brand-fg">Sparkle</span>
                      <span className="font-sans text-[12px] text-brand-muted/75">Layers over any look</span>
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="relative h-6 w-10 shrink-0 rounded-full transition-colors"
                    style={{ background: sparkles ? 'var(--color-accent)' : 'rgba(255,255,255,0.14)' }}
                  >
                    <span
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                      style={{ left: sparkles ? 18 : 2 }}
                    />
                  </span>
                </button>
              )}

              {current === 'all' && !hasFrames && (
                <div className="mb-4 font-sans text-[13px] text-brand-muted/80">
                  {!experiencesLoaded && <p>Loading this event’s frames…</p>}
                  {experiencesLoaded && experiencesFailed && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Couldn’t load this event’s frames.</span>
                      <button
                        type="button"
                        onClick={() => void fetchExperiences(true)}
                        className="pressable flex min-h-11 items-center gap-1.5 rounded-full px-3 font-sans text-[13px] font-medium text-[color:var(--color-accent)]"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Retry
                      </button>
                    </div>
                  )}
                  {experiencesLoaded && !experiencesFailed && <p>No frames in this event yet.</p>}
                </div>
              )}

              {groups.map((g) => {
                const Icon = CATEGORY_ICON[g.category];
                return (
                  <section key={g.category} className="mb-5" aria-label={g.label}>
                    {current === 'all' && (
                      <h3 className="mb-2.5 flex items-center gap-2 font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-muted/80">
                        <Icon className="h-3.5 w-3.5" />
                        {g.label}
                      </h3>
                    )}
                    <div className="grid grid-cols-4 gap-x-2.5 gap-y-3.5">
                      {g.items.map((item) => {
                        const on = activeIds.has(item.exp.id);
                        const pending = on && (pendingIds?.has(item.exp.id) ?? false);
                        return (
                          <button
                            key={item.exp.id}
                            type="button"
                            aria-pressed={on}
                            aria-busy={pending || undefined}
                            onClick={() => { haptic('select'); runLookAction(lookTapAction(item, on), handlers); }}
                            className="group flex min-w-0 flex-col items-center gap-1.5 text-center"
                          >
                            <span
                              className={`pressable relative block aspect-square w-full overflow-hidden rounded-2xl ${on ? 'is-selected' : ''}`}
                              style={{
                                background: 'rgba(9, 11, 20, 0.5)',
                                boxShadow: on
                                  ? '0 0 0 2px var(--color-accent), 0 0 20px -4px rgba(var(--accent-rgb),0.85)'
                                  : 'inset 0 0 0 1px rgba(255,255,255,0.14)',
                              }}
                            >
                              <LookThumb item={item} />
                              {pending && (
                                <span
                                  className={`pointer-events-none absolute inset-0 m-auto h-6 w-6 rounded-full ${reduced ? '' : 'animate-spin'}`}
                                  style={{ border: '2px solid rgba(255,255,255,0.25)', borderTopColor: 'var(--color-accent)' }}
                                />
                              )}
                            </span>
                            <span
                              className="line-clamp-2 w-full font-sans text-[12px] leading-tight"
                              style={{ color: on ? 'var(--color-brand-fg)' : 'rgba(205,210,235,0.75)', fontWeight: on ? 600 : 400 }}
                            >
                              {item.exp.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-white/10 px-5 pt-3">
              {!pristine && (
                <button
                  type="button"
                  onClick={() => { haptic('toggle'); onClearAll(); }}
                  className="pressable flex min-h-11 items-center rounded-full px-4 font-sans text-[14px] font-medium text-brand-muted/90 hover:text-brand-fg"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => { haptic('tap'); onClose(); }}
                className="pressable bg-foil ml-auto flex min-h-11 items-center rounded-full px-6 font-sans text-[14px] font-semibold text-[color:var(--on-accent)]"
              >
                Done
              </button>
            </div>
          </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
