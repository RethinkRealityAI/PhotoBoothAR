/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CardPreviewModal — the host's full-screen "see it as they will": the real
 * CardExperience (the same component /c/:publicId renders), fed from the
 * host's own rows, so it works for a card that is still collecting and shows
 * exactly the reveal → card the recipient gets.
 *
 * A compact option bar flips Opening / Card style / Colours LIVE. Those picks
 * are unsaved overrides (CardExperience `overrides`) until the host presses
 * "Use these", which hands them to the parent to save.
 *
 * Portalled to <body> inside its own `data-platform` root (the WallDesign
 * idiom), so it wears the platform look and is never clipped by the studio's
 * animated page containers. Dialog behaviour (Escape, focus trap, focus
 * return) is lib/useDialog. The card is rendered with keyboard={false}: inside
 * a dialog the arrow keys belong to the focused control, not to window.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { Check, Loader2, X } from 'lucide-react';
import CardExperience from './CardExperience';
import { PREVIEW_AXES, PresentationChips, type PreviewAxis } from './CardPresentationPicker';
import { listContributionsResult, signContributionUrls, type CardRow } from '../../lib/cards';
import {
  buildCardPreview,
  picksDiffer,
  picksFrom,
  picksToOverrides,
  previewMediaPaths,
  type CardPreviewData,
  type PreviewPicks,
} from '../../lib/cardPreview';
import { useDialog } from '../../lib/useDialog';

type Load =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; data: CardPreviewData };

export interface CardPreviewModalProps {
  card: CardRow;
  eventName: string | null;
  onClose: () => void;
  /** Save the picks. Resolves true when they stuck; the parent reports
   *  failures (toast) and updates `card`, which is how "Use these" settles. */
  onUse: (picks: PreviewPicks) => Promise<boolean>;
}

export default function CardPreviewModal({ card, eventName, onClose, onUse }: CardPreviewModalProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, `Preview of ${card.title}`);
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [picks, setPicks] = useState<PreviewPicks>(() => picksFrom(card));
  const [axis, setAxis] = useState<PreviewAxis>('reveal');
  const [saving, setSaving] = useState(false);
  // The latest card row, read when the contributions load. Keyed on the id
  // only: re-reading media on every presentation save would restart the
  // reveal under the host's eyes.
  const cardRef = useRef(card);
  cardRef.current = card;

  // Contributions are read once per open (or per "Try again").
  useEffect(() => {
    let alive = true;
    setLoad({ phase: 'loading' });
    (async () => {
      const { rows, failed } = await listContributionsResult(card.id);
      if (!alive) return;
      if (failed) {
        setLoad({ phase: 'failed' });
        return;
      }
      const urls = await signContributionUrls(previewMediaPaths(rows));
      if (!alive) return;
      setLoad({ phase: 'ready', data: buildCardPreview({ card: cardRef.current, rows, urls, eventName }) });
    })();
    return () => { alive = false; };
  }, [card.id, attempt, eventName]);

  // Stop the page behind from scrolling while the preview is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const overrides = useMemo(() => picksToOverrides(picks), [picks]);
  const dirty = picksDiffer(card, picks);

  const use = useCallback(async () => {
    setSaving(true);
    await onUse(picks);
    setSaving(false);
  }, [onUse, picks]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-platform>
      <div
        ref={panelRef}
        {...dialogProps}
        className="app-bg fixed inset-0 z-[90] flex flex-col overflow-hidden outline-none motion-safe:animate-rise-in"
      >
        {/* Header */}
        <div className="relative z-30 flex shrink-0 items-center gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="pressable liquid-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-fg"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate font-sans text-[13px] font-semibold text-brand-fg">{card.title}</p>
            <p className="truncate font-sans text-[12px] text-brand-muted/75">
              {dirty ? 'Not saved yet' : 'Exactly what they will see'}
            </p>
          </div>
          <button
            type="button"
            onClick={use}
            disabled={!dirty || saving}
            className="pressable flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-white px-5 font-sans text-[13px] font-semibold text-[#1A1740] transition disabled:bg-white/15 disabled:text-brand-fg/70"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : !dirty ? <Check className="h-4 w-4" aria-hidden /> : null}
            {dirty ? 'Use these' : 'Saved'}
          </button>
        </div>

        {/* Stage — a phone-proportioned frame on wide screens, edge to edge on a phone */}
        <div className="relative min-h-0 flex-1 sm:flex sm:items-center sm:justify-center sm:py-3">
          <div
            className="relative h-full w-full overflow-hidden sm:aspect-[9/19.5] sm:h-full sm:max-h-[860px] sm:w-auto sm:rounded-[36px]"
            style={{ boxShadow: '0 40px 120px -40px rgba(4,3,20,0.9), inset 0 0 0 1px rgba(255,255,255,0.14)' }}
          >
            {load.phase === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center text-brand-muted/70">
                <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading the card" />
              </div>
            )}
            {load.phase === 'failed' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="font-sans text-sm text-brand-fg">We couldn’t load this card’s messages.</p>
                <button
                  type="button"
                  onClick={() => setAttempt((a) => a + 1)}
                  className="pressable liquid-glass min-h-11 rounded-full px-5 font-sans text-[13px] font-semibold text-brand-fg"
                >
                  Try again
                </button>
              </div>
            )}
            {load.phase === 'ready' && (
              load.data.contributions.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                  <p className="font-serif text-xl text-brand-fg">Nothing in it yet</p>
                  <p className="max-w-xs font-sans text-[13px] leading-relaxed text-brand-muted/80">
                    Share the contribute link. The preview fills in as photos, videos and messages arrive.
                  </p>
                </div>
              ) : (
                <CardExperience
                  card={load.data.card}
                  contributions={load.data.contributions}
                  overrides={overrides}
                  reducedMotion={reducedMotion}
                  keyboard={false}
                />
              )
            )}
          </div>
        </div>

        {/* Live option bar */}
        <div className="relative z-30 shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-5">
          <div className="glass-strong mx-auto flex max-w-2xl flex-col gap-2 rounded-3xl p-2">
            <div role="tablist" aria-label="Preview options" className="grid grid-cols-3 gap-1">
              {PREVIEW_AXES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="tab"
                  aria-selected={axis === a.id}
                  onClick={() => setAxis(a.id)}
                  className={`pressable min-h-11 rounded-2xl px-2 font-sans text-[13px] font-semibold transition ${
                    axis === a.id ? 'is-selected text-brand-fg' : 'text-brand-muted hover:text-brand-fg'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <PresentationChips
              axis={axis}
              reveal={picks.reveal}
              template={picks.template}
              look={picks.look}
              onReveal={(reveal) => setPicks((p) => ({ ...p, reveal }))}
              onTemplate={(template) => setPicks((p) => ({ ...p, template }))}
              onLook={(look) => setPicks((p) => ({ ...p, look }))}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
