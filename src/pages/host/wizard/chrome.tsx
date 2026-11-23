/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The wizard's chrome: header, step rail, step heading and the sticky footer.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CloudOff, Loader2, X, type LucideIcon } from 'lucide-react';
import { WIZARD_STEPS, setupPercent, stepDef, stepIndex, type WizardProgress, type WizardStepId } from '../../../lib/wizard/wizardModel';
import { tabIndexForKey } from '../../../lib/wizard/tabKeys';
import type { SaveState } from './wizardContext';
import PreviewSheet, { useIsDesktop } from './PreviewSheet';

/* ── Chrome shared by create mode and setup mode ───────────────────── */

function SaveChip({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map = {
    saving: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />, text: 'Saving…' },
    saved: { icon: <Check className="h-3.5 w-3.5" aria-hidden />, text: 'Saved' },
    error: { icon: <CloudOff className="h-3.5 w-3.5" aria-hidden />, text: 'Couldn’t save. Check your connection.' },
  } as const;
  const m = map[state];
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] ${state === 'error' ? 'bg-[rgba(255,120,140,0.2)] text-white' : 'text-white/80'}`}
    >
      {m.icon}
      {m.text}
    </span>
  );
}

export function Rail({ current, progress, canVisit, onPick }: {
  current: WizardStepId;
  progress: WizardProgress | null;
  canVisit: boolean;
  onPick: (id: WizardStepId) => void;
}) {
  // Starts ahead: the account is shown as the first step already done.
  const pct = setupPercent(progress);
  return (
    <>
      {/* Desktop: the whole journey, always visible. */}
      <nav aria-label="Setup steps" className="hidden lg:block">
        <div className="sticky top-[76px]"><div className="liquid-glass rounded-[24px] p-2">
          <div className="px-2.5 pt-2 pb-2.5">
            <div className="flex items-baseline justify-between">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/60">Your setup</p>
              <p className="text-[11.5px] text-white/60">{pct}%</p>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-white/15 overflow-hidden" aria-hidden>
              <div className="h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <ol className="flex flex-col gap-0.5">
            <li>
              <div className="wz-rail-step wz-rail-static">
                <span className="wz-rail-dot is-done" aria-hidden><Check className="h-4 w-4" strokeWidth={3} /></span>
                <span className="flex-1 min-w-0 truncate">Account created</span>
                <span className="sr-only"> (done)</span>
              </div>
            </li>
            {WIZARD_STEPS.map((s, i) => {
              const done = progress?.done.includes(s.id) ?? false;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="wz-rail-step"
                    aria-current={s.id === current ? 'step' : undefined}
                    disabled={!canVisit && s.id !== current}
                    onClick={() => onPick(s.id)}
                  >
                    <span className={`wz-rail-dot ${done && s.id !== current ? 'is-done' : ''}`} aria-hidden>
                      {done && s.id !== current ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{s.label}</span>
                    {s.optional && <span className="text-[10.5px] text-white/45">Optional</span>}
                    <span className="sr-only">{done ? ' (done)' : ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div></div>
      </nav>
      {/* Phone: where am I, and how far to go. */}
      <div className="lg:hidden">
        <div className="flex items-center gap-1.5" aria-hidden>
          {/* The account: a step already done, so the bar never starts empty. */}
          <span className="h-1.5 flex-1 rounded-full bg-[#5FD9A8]" />
          {WIZARD_STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              tabIndex={-1}
              disabled={!canVisit}
              onClick={() => onPick(s.id)}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s.id === current ? 'bg-white' : progress?.done.includes(s.id) ? 'bg-[#5FD9A8]' : 'bg-white/18'
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-white/70">
          Step {stepIndex(current) + 1} of {WIZARD_STEPS.length} · {stepDef(current).label}
          {stepDef(current).optional ? ' · optional' : ''}
        </p>
      </div>
    </>
  );
}

export function WizardFrame({ eventName, saveState, rail, footer, children }: {
  eventName: string | null;
  saveState: SaveState;
  rail: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    // Its own scroll box: the app shell around every route is h-screen +
    // overflow-hidden, so the window never scrolls.
    <div id="wz-scroll" data-platform className="wz-root app-bg flex flex-col h-[100dvh] overflow-y-auto overscroll-contain">
      <header className="wz-header sticky top-0 z-40 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3">
        <div className="mx-auto max-w-[1560px] lg:px-2 flex items-center gap-3">
          <Link to="/host" className="wz-display text-[20px] text-white shrink-0 min-h-11 flex items-center">Beamwall</Link>
          <span className="hidden sm:block h-5 w-px bg-white/25" aria-hidden />
          <p className="hidden sm:block min-w-0 truncate text-[14px] text-white/80">
            {eventName ? <>Setting up <span className="text-white font-semibold">{eventName}</span></> : 'New event'}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <SaveChip state={saveState} />
            <Link
              to="/host"
              className="pressable liquid-glass-raised inline-flex items-center gap-1.5 rounded-full px-4 min-h-11 text-[14px] font-medium"
            >
              <X className="h-4 w-4" aria-hidden />
              <span>{eventName ? 'Save & exit' : 'Exit'}</span>
            </Link>
          </div>
        </div>
      </header>
      {/* Desktop: one row that fills the screen, so a step's panel and
          preview take the whole height between the header and the footer. */}
      <div className="flex-1 mx-auto w-full max-w-[1560px] px-4 lg:px-6 lg:grid lg:grid-cols-[196px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6 xl:gap-7 pb-6 lg:pb-4 lg:pt-1">
        {rail}
        <main className="min-w-0 mt-4 lg:mt-0">{children}</main>
      </div>
      {footer}
    </div>
  );
}

export function WizardFooter({ onBack, onSkip, onContinue, continueLabel, busy, blocked, continueTone = 'primary' }: {
  onBack: (() => void) | null;
  onSkip: (() => void) | null;
  onContinue: () => void;
  continueLabel: string;
  busy: boolean;
  blocked: string | null;
  /** 'secondary' steps the button back when the step has its own primary
   *  action (Launch's "Go live") so the two do not compete. */
  continueTone?: 'primary' | 'secondary';
}) {
  return (
    <div className="wz-footer">
      <div className="mx-auto max-w-[1560px] lg:px-2 flex items-center gap-2">
        {onBack ? (
          <button type="button" onClick={onBack} className="pressable liquid-glass-raised inline-flex items-center gap-1.5 rounded-full px-4 min-h-12 text-[15px] font-medium">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
        ) : <span />}
        <div className="ml-auto flex items-center gap-2">
          {blocked && <p className="hidden sm:block text-[13px] text-white/75 mr-1">{blocked}</p>}
          {onSkip && (
            <button type="button" onClick={onSkip} disabled={busy} className="pressable whitespace-nowrap rounded-full px-3 sm:px-4 min-h-12 text-[15px] font-medium text-white/85 hover:text-white">
              Skip for now
            </button>
          )}
          <button
            type="button"
            onClick={onContinue}
            disabled={busy || blocked !== null}
            aria-describedby={blocked ? 'wz-blocked' : undefined}
            className={`pressable inline-flex items-center gap-2 rounded-full px-6 min-h-12 text-[15px] disabled:opacity-55 ${
              continueTone === 'primary' ? 'bg-foil font-semibold' : 'liquid-glass-raised font-medium'
            }`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {continueLabel}
            {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>
      {blocked && <p id="wz-blocked" className="sm:hidden mx-auto max-w-[1560px] mt-2 text-right text-[12.5px] text-white/75">{blocked}</p>}
    </div>
  );
}

/**
 * The step's title, INSIDE its panel (no page-level heading: the rail, the
 * panel and the preview all start on the same line). `aside` sits on the
 * right of the title row (a count…); `hint` replaces the step's own blurb.
 */
export function StepHeading({ step, children, aside, hint }: { step: WizardStepId; children?: ReactNode; aside?: ReactNode; hint?: ReactNode }) {
  const d = stepDef(step);
  return (
    <div className="wz-step-heading">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 id={`wz-h-${step}`} className="wz-display text-[22px] leading-tight text-white">{d.title}</h1>
          <p className="mt-0.5 text-[13.5px] text-white/70">{hint ?? d.blurb}</p>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────── */

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
  /** A shorter label for phones. */
  short?: ReactNode;
  Icon?: LucideIcon;
  count?: number;
  /** The tab's accessible name when the visible label is not enough. */
  ariaLabel?: string;
}

/**
 * The wizard's one segmented control: a WAI-ARIA tablist over the `wz-tabs`
 * look (arrow keys move and select, Home / End jump, one tab stop). Pair it
 * with <TabPanel> using the same `idBase`.
 */
export function WizardTabs<T extends string>({ idBase, label, tabs, value, onChange, className = '' }: {
  idBase: string;
  label: string;
  tabs: readonly TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = tabs.findIndex((t) => t.id === value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = tabIndexForKey(e.key, at, tabs.length);
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className={`wz-tabs ${className}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => {
        const on = t.id === value;
        const Icon = t.Icon;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.id}`}
            aria-controls={`${idBase}-panel`}
            aria-selected={on}
            aria-label={t.ariaLabel}
            tabIndex={on || (at < 0 && i === 0) ? 0 : -1}
            className="wz-tab"
            onClick={() => onChange(t.id)}
          >
            {Icon && <Icon className="hidden xl:block h-4 w-4 shrink-0" aria-hidden />}
            {t.short !== undefined ? <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></> : t.label}
            {t.count !== undefined && <span className="wz-count" aria-hidden>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel<T extends string>({ idBase, value, className, children }: { idBase: string; value: T; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${value}`} className={className}>
      {children}
    </div>
  );
}

/* ── The step shell: ONE panel and its preview ─────────────────────── */

/**
 * The step's single glass panel: a compact title row, an optional tab row,
 * then the body. On desktop it fills the room between the header and the
 * footer and only its body scrolls; inside the phone drawer it is plain.
 */
export function StepPanel({ step, hint, aside, headExtra, tabs, notice, children, label }: {
  step: WizardStepId;
  hint?: ReactNode;
  /** A line under the title row (e.g. the assistant link on Basics). */
  headExtra?: ReactNode;
  aside?: ReactNode;
  tabs?: ReactNode;
  /** An alert shown above the body (a failed load…). */
  notice?: ReactNode;
  /** The panel's accessible name when it is not the step title. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="wz-panel liquid-glass rounded-[28px] wz-enter"
      aria-labelledby={label ? undefined : `wz-h-${step}`}
      aria-label={label}
    >
      <div className="wz-panel-head">
        <StepHeading step={step} hint={hint} aside={aside}>{headExtra}</StepHeading>
      </div>
      {tabs && <div className="wz-panel-tabs">{tabs}</div>}
      <div className="wz-panel-body">
        {notice}
        {children}
      </div>
    </section>
  );
}

/**
 * Lays a step out. Desktop: the panel (same size on every step) beside a
 * preview column sized from the height available, so the phone is as big as
 * the screen allows and the page never scrolls. Phone: the drawer over a
 * pinned preview (`sheet`), or the panel then the preview (`stack`).
 *
 *   phone  a portrait preview (phone or try-on stage) in a column fitted to it
 *   wide   a landscape preview (the live wall) that takes the wider half
 */
export function StepShell({ panel, preview, previewKind = 'phone', mobile = 'sheet', sheetLabel }: {
  panel: ReactNode;
  preview: ReactNode;
  previewKind?: 'phone' | 'wide';
  mobile?: 'sheet' | 'stack';
  /** The phone drawer's title. */
  sheetLabel: string;
}) {
  const desktop = useIsDesktop();
  if (!desktop) {
    if (mobile === 'sheet') return <PreviewSheet label={sheetLabel} preview={preview}>{panel}</PreviewSheet>;
    return (
      <div className="grid grid-cols-1 gap-6">
        {panel}
        <div className="wz-enter flex flex-col items-center gap-3" style={{ animationDelay: '80ms' }}>{preview}</div>
      </div>
    );
  }
  return (
    <div className="wz-shell">
      <div className="wz-shell-grid" data-preview={previewKind}>
        <div className="wz-shell-panel">{panel}</div>
        <div className="wz-shell-preview wz-enter" style={{ animationDelay: '80ms' }}>{preview}</div>
      </div>
    </div>
  );
}

