/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StageCard — the ONE card both the setup wizard and the keepsake editor are
 * built from, so the two cannot drift (owner, 2026-11-22: "have the rest of
 * the setup wizard look exactly like this … one large component with the
 * stages and their icons at the top … the preview nicely embedded").
 *
 *   desktop (≥1024px)  one glass card: a stage bar across the top, the options
 *                      on the left (only they scroll), the live preview on the
 *                      right inside the same card, Back / Next under the
 *                      options. The preview column is sized from the card's
 *                      own height, wider for the heavy previews (the live
 *                      wall, the 3D try-on stage).
 *   phone              `sheet`: the preview pinned on top, the options in the
 *                      drag-up drawer (PreviewSheet) · `stack`: the card, then
 *                      the preview · `pinned`: one viewport-tall card with a
 *                      short preview on top (the keepsake editor on Share &
 *                      Print, as it always was).
 *
 * One tree at a time (useIsDesktop), so a costly preview (the live wall
 * iframe) never mounts twice.
 *
 * The stage bar comes from the `stages` prop or, inside the wizard, from
 * StageBarContext — that is how the keepsake editor mounted in the wizard
 * wears the wizard's stages on top and its own steps underneath.
 */
import { createContext, useContext, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Check, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import PreviewSheet, { useIsDesktop } from './PreviewSheet';

/** The wizard's stage bar, provided by the wizard shell to every card inside it. */
export const StageBarContext = createContext<ReactNode>(null);

export type PreviewKind = 'phone' | 'stage' | 'wide' | 'album';

export interface StageCardProps {
  /** A row above everything (the keepsake editor's save bar on Share & Print). */
  top?: ReactNode;
  /** The stage bar. Defaults to the wizard's (StageBarContext). */
  stages?: ReactNode;
  /** The options column's head: a title row. */
  head?: ReactNode;
  /** A second bar under the head: sub-steps or tabs. */
  bar?: ReactNode;
  /** Back / Next under the options. */
  nav?: ReactNode;
  /** The options. On desktop only this scrolls. */
  children: ReactNode;
  preview: ReactNode;
  previewKind?: PreviewKind;
  /** 'scale' shrinks a fixed-size preview to fit; 'fill' gives it the whole cell (it sizes itself). */
  previewFit?: 'scale' | 'fill';
  phone?: 'sheet' | 'stack' | 'pinned';
  /** The phone drawer's title (sheet). */
  sheetLabel?: string;
  /** Fixed viewport height (a card on a normal page). Inside the wizard the frame gives the height. */
  standalone?: boolean;
  /** The card's accessible name. */
  label?: string;
  labelledBy?: string;
  className?: string;
}

/** Scales its child DOWN (never up) to fit the box, centred. */
export function FitToBox({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (o === null || i === null) return;
    const measure = () => {
      const h = i.offsetHeight;
      setScale(h > 0 ? Math.min(1, o.clientHeight / h) : 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="sc-fit">
      <div ref={inner} className="sc-fit-inner" style={{ transform: scale < 1 ? `scale(${scale})` : undefined }}>{children}</div>
    </div>
  );
}

export default function StageCard({
  top, stages, head, bar, nav, children, preview, previewKind = 'phone', previewFit = 'scale', phone = 'sheet',
  sheetLabel = '', standalone = false, label, labelledBy, className = '',
}: StageCardProps) {
  const desktop = useIsDesktop();
  const contextStages = useContext(StageBarContext);
  const stageBar = stages ?? contextStages;
  const previewNode = previewFit === 'fill' ? <div className="sc-fill">{preview}</div> : <FitToBox>{preview}</FitToBox>;

  if (!desktop && phone === 'sheet') {
    // The phone rail above already says where the host is; the drawer holds
    // the step's own controls.
    return (
      <PreviewSheet label={sheetLabel} preview={preview} fit={previewFit === 'scale'}>
        <div className="sc-sheet">
          {head}
          {bar && <div className="sc-bar-row">{bar}</div>}
          <div className="sc-body">{children}</div>
          {nav && <div className="sc-nav-row">{nav}</div>}
        </div>
      </PreviewSheet>
    );
  }

  if (!desktop && phone === 'stack') {
    return (
      <div className="grid grid-cols-1 gap-6">
        <section className={`sc liquid-glass wz-enter ${className}`} aria-label={label} aria-labelledby={labelledBy}>
          {top && <div className="sc-top">{top}</div>}
          <div className="sc-main">
            {head}
            {bar && <div className="sc-bar-row">{bar}</div>}
            <div className="sc-body">{children}</div>
            {nav && <div className="sc-nav-row">{nav}</div>}
          </div>
        </section>
        <div className="wz-enter flex flex-col items-center gap-3" style={{ animationDelay: '80ms' }}>{preview}</div>
      </div>
    );
  }

  if (!desktop) {
    // pinned: one viewport-tall card, a short preview on top.
    return (
      <section className={`sc sc-pinned liquid-glass ${className}`} aria-label={label} aria-labelledby={labelledBy}>
        {top && <div className="sc-top">{top}</div>}
        <aside className="sc-pinned-preview" aria-label="Live preview">{previewNode}</aside>
        {stageBar && <div className="sc-stages">{stageBar}</div>}
        <div className="sc-main">
          {head}
          {bar && <div className="sc-bar-row">{bar}</div>}
          <div className="sc-body">{children}</div>
          {nav && <div className="sc-nav-row">{nav}</div>}
        </div>
      </section>
    );
  }

  return (
    <section
      className={`sc liquid-glass wz-enter ${standalone ? 'sc-standalone' : ''} ${className}`}
      aria-label={label}
      aria-labelledby={labelledBy}
    >
      {top && <div className="sc-top">{top}</div>}
      {stageBar && <div className="sc-stages">{stageBar}</div>}
      {/* The frame is the size container the grid's preview column is computed from. */}
      <div className="sc-frame">
        <div className="sc-grid" data-preview={previewKind}>
          <div className="sc-main">
            {head}
            {bar && <div className="sc-bar-row">{bar}</div>}
            <div className="sc-body">{children}</div>
            {nav && <div className="sc-nav-row">{nav}</div>}
          </div>
          <aside className="sc-preview" aria-label="Live preview">{previewNode}</aside>
        </div>
      </div>
    </section>
  );
}

/** Move focus to a sub-step's options without the browser scrolling the bar
 *  out of view: the options' scroller (or the phone drawer) goes back to the top. */
export function focusStepPanel(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el === null) return;
    el.closest('.wz-sheet-body, .sc-body')?.scrollTo({ top: 0 });
    el.focus({ preventScroll: true });
  });
}

/* ── The bar: numbered stages with ticks, or free tabs ─────────────── */

export interface StepBarItem<T extends string> {
  id: T;
  label: string;
  Icon?: LucideIcon;
  /** Shows a tick instead of the number (never on the current item). */
  done?: boolean;
  /** Clickable? (guided: only steps already reached). Defaults to true. */
  reachable?: boolean;
  /** An unsaved-changes dot. */
  dirty?: boolean;
  /** Replaces the number in the circle (the keepsake's Review icon). */
  glyph?: ReactNode;
  /** Extra words for screen readers after the label (", optional"). */
  note?: string;
}

/**
 * The one bar. `steps` = a numbered list (nav > ol, aria-current="step"):
 * ticks on what is done, the current one lit, steps not reached shown but not
 * clickable. `tabs` = a WAI-ARIA tablist (arrow keys, Home / End) over the
 * same look, for once every step is free.
 *
 * Ids are `${idBase}-tab-${id}`; tabs control `${idBase}-panel-${id}`.
 */
export function StepBar<T extends string>({
  idBase, label, items, current, mode, onPick, keyFor, refs, doneText = ', done', showIcons = 'tabs', className = '',
}: {
  idBase: string;
  label: string;
  items: readonly StepBarItem<T>[];
  current: T;
  mode: 'steps' | 'tabs';
  onPick: (id: T, via: 'click' | 'key') => void;
  /** Keyboard movement in tabs mode. */
  keyFor?: (current: T, key: string) => T | null;
  refs?: RefObject<Partial<Record<string, HTMLButtonElement | null>>>;
  /** Screen-reader suffix on a done item. */
  doneText?: string;
  /** Where the item icons show: in tabs mode only, or always (the wizard's stages). */
  showIcons?: 'tabs' | 'always';
  className?: string;
}) {
  const setRef = (id: string) => (el: HTMLButtonElement | null) => { if (refs?.current) refs.current[id] = el; };
  const dot = (it: StepBarItem<T>) => it.dirty ? (<><span className="sc-dot" aria-hidden /><span className="sr-only">, unsaved changes</span></>) : null;

  if (mode === 'tabs') {
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const next = keyFor?.(current, e.key) ?? null;
      if (next === null) return;
      e.preventDefault();
      onPick(next, 'key');
      requestAnimationFrame(() => refs?.current?.[next]?.focus());
    };
    return (
      <div className={`wz-tabs sc-bar ${className}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((it) => {
          const selected = it.id === current;
          const Icon = it.Icon;
          return (
            <button
              key={it.id}
              ref={setRef(it.id)}
              id={`${idBase}-tab-${it.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${idBase}-panel-${it.id}`}
              tabIndex={selected ? 0 : -1}
              className="wz-tab"
              onClick={() => onPick(it.id, 'click')}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
              <span className="max-w-full truncate">{it.label}</span>
              {dot(it)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <nav aria-label={label} className={className}>
      <ol className="wz-tabs sc-bar sc-steps">
        {items.map((it, i) => {
          const isCurrent = it.id === current;
          const reachable = it.reachable ?? true;
          const done = !isCurrent && it.done === true;
          const Icon = it.Icon;
          return (
            <li key={it.id}>
              <button
                ref={setRef(it.id)}
                id={`${idBase}-tab-${it.id}`}
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                aria-disabled={reachable ? undefined : true}
                className="wz-tab"
                onClick={() => { if (reachable) onPick(it.id, 'click'); }}
              >
                <span className={`sc-num ${done ? 'is-done' : ''}`} aria-hidden>
                  {done ? <Check className="h-3 w-3" strokeWidth={3} /> : it.glyph ?? i + 1}
                </span>
                {showIcons === 'always' && Icon && <Icon className="sc-step-icon h-4 w-4 shrink-0" aria-hidden />}
                <span className="max-w-full truncate">{it.glyph ? null : <span className="sr-only">Step {i + 1}: </span>}{it.label}</span>
                {it.note && <span className="sr-only">{it.note}</span>}
                <span className="sr-only">{done ? doneText : reachable ? '' : ', not reached yet'}</span>
                {dot(it)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Back · "Step 2 of 3" · Next: … — the row under the options. */
export function StepNav({ onBack, next, position, onNext }: {
  onBack: (() => void) | null;
  /** The next sub-step's label, or null on the last one. */
  next: string | null;
  position: string;
  onNext: () => void;
}) {
  return (
    <nav className="flex items-center gap-2" aria-label="Step navigation">
      <button
        type="button"
        onClick={() => onBack?.()}
        disabled={onBack === null}
        className="flex min-h-11 shrink-0 items-center gap-1 rounded-full glass px-4 font-sans text-sm text-brand-fg transition hover:text-accent-2 disabled:opacity-35"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back
      </button>
      <p className="min-w-0 flex-1 text-center font-sans text-xs leading-tight text-brand-muted/70" aria-live="polite">{position}</p>
      {next !== null ? (
        <button
          type="button"
          onClick={onNext}
          className="flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-white/90 px-4 font-sans text-sm font-semibold text-[color:var(--bw-on-accent,#1A1740)] transition active:scale-[0.98]"
        >
          Next: {next} <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <span aria-hidden className="w-[5.5rem] shrink-0" />
      )}
    </nav>
  );
}
