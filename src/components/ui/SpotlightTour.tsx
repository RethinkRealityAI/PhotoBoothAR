/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A small in-house spotlight tour: dims the page, cuts a lit hole around one
 * `[data-tour="<target>"]` element at a time and explains it in a glass
 * popover. Policy (which stops, when to show, placement maths) is pure and
 * tested in lib/onboardingTour.ts; this file only measures and renders.
 *
 * - Stops whose target is not in the DOM when the tour opens are skipped
 *   (the assistant button mounts lazily and can be absent).
 * - Esc = skip. Focus moves into the popover and returns afterwards
 *   (useDialog). Repositions on resize and on any scroll, including the host
 *   layout's own scrolling <main>.
 * - Reduced motion: no transitions, instant scroll.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { useDialog } from '../../lib/useDialog';
import {
  availableSteps,
  clampStep,
  isLastStep,
  nextStep,
  placePopover,
  prevStep,
  stepLabel,
  type Rect,
  type TourOutcome,
  type TourStep,
} from '../../lib/onboardingTour';

const PAD = 8;
const POP_WIDTH = 340;

function findTarget(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
}

export default function SpotlightTour({ steps, onFinish }: {
  steps: readonly TourStep[];
  /** 'done' after the last stop, 'skipped' on Skip/Esc, null when no stop's
   *  target was on the page (nothing was shown, so nothing should be saved). */
  onFinish: (outcome: TourOutcome | null) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  // Resolved once, when the tour opens.
  const live = useMemo(() => availableSteps(steps, (t) => findTarget(t) !== null), [steps]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [popH, setPopH] = useState(180);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  const count = live.length;
  const i = clampStep(index, count);
  const step = live[i] as TourStep | undefined;

  useEffect(() => {
    if (count === 0) onFinish(null);
  }, [count, onFinish]);

  const skip = useCallback(() => onFinish('skipped'), [onFinish]);
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(skip, undefined, count > 0);

  const measure = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.target);
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [step]);

  // New stop: bring it into view, then measure.
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step.target);
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    measure();
    primaryRef.current?.focus();
  }, [step, measure, reduceMotion]);

  // Follow the target through resizes and scrolling (capture catches the
  // host layout's scrolling <main>, not just the window).
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [step, measure]);

  // The popover's real height decides above/below.
  useLayoutEffect(() => {
    const h = panelRef.current?.offsetHeight;
    if (h !== undefined && h > 0 && h !== popH) setPopH(h);
  });

  if (!step) return null;

  const target: Rect = rect ?? { top: viewport.height / 2, left: viewport.width / 2, width: 0, height: 0 };
  const pos = placePopover(target, { width: POP_WIDTH, height: popH }, viewport);
  const last = isLastStep(i, count);
  const motionCls = reduceMotion ? '' : 'transition-all duration-300 ease-out';
  const btn = 'pressable inline-flex min-h-11 items-center justify-center rounded-full px-4 text-[14px] font-medium';

  return createPortal(
    <div data-platform className="fixed inset-0 z-[85]">
      {/* Click-catcher: the page behind stays inert while the tour is up. */}
      <div className="absolute inset-0" aria-hidden />
      {rect ? (
        <div
          aria-hidden
          className={`pointer-events-none fixed rounded-[22px] ring-2 ring-[color:var(--color-accent)] ${motionCls}`}
          style={{
            top: rect.top, left: rect.left, width: rect.width, height: rect.height,
            boxShadow: '0 0 0 9999px rgba(6,5,24,0.68), 0 0 24px 4px rgba(var(--accent-rgb),0.45)',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[rgba(6,5,24,0.68)]" />
      )}
      <div
        ref={panelRef}
        {...dialogProps}
        aria-label={undefined}
        aria-labelledby="spotlight-tour-title"
        aria-describedby="spotlight-tour-body"
        className={`fixed liquid-glass rounded-2xl p-5 text-brand-fg shadow-[0_24px_60px_rgba(0,0,0,0.55)] outline-none ${motionCls}`}
        style={{ top: pos.top, left: pos.left, width: pos.width }}
      >
        <p className="text-[12px] font-medium text-brand-muted">{stepLabel(i, count)}</p>
        <h2 id="spotlight-tour-title" className="mt-1 font-serif text-[22px] leading-tight">{step.title}</h2>
        <p id="spotlight-tour-body" className="mt-2 text-[15px] leading-relaxed text-brand-fg/90">{step.body}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={skip} className={`${btn} -ml-2 text-brand-muted hover:text-brand-fg`}>
            Skip tour
          </button>
          <span className="ml-auto flex items-center gap-2">
            {i > 0 && (
              <button type="button" onClick={() => setIndex(prevStep(i, count))} className={`${btn} glass text-brand-fg`}>
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              onClick={() => (last ? onFinish('done') : setIndex(nextStep(i, count)))}
              className={`${btn} bg-foil px-5 font-semibold`}
            >
              {last ? 'Done' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
