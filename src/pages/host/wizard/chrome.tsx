/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The wizard's chrome: header, step rail, step heading and the sticky footer.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CloudOff, Gift, Image as ImageIcon, Loader2, Monitor, Rocket, Smile, Sparkles, Trophy, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import { WIZARD_STEPS, setupPercent, stepDef, stepIndex, type WizardProgress, type WizardStepId } from '../../../lib/wizard/wizardModel';
import { tabIndexForKey } from '../../../lib/wizard/tabKeys';
import type { SaveState } from './wizardContext';
import StageCard, { StepBar, type PreviewKind } from './StageCard';

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

/** Each stage's icon in the card's stage bar. */
export const STEP_ICON: Record<WizardStepId, LucideIcon> = {
  basics: CalendarDays,
  invite: ImageIcon,
  looks: Sparkles,
  powerups: Zap,
  challenges: Trophy,
  booth: Monitor,
  keepsake: Gift,
  intro: Smile,
  launch: Rocket,
};

/**
 * The stage bar across the top of every step's card (desktop): numbered, a
 * tick on each finished stage, the current one lit, and the setup percentage
 * at its end (it starts ahead: the account counts as a step already done).
 * `reachable` false = the map only (before the event exists).
 */
export function StageBar({ current, progress, reachable = true, onPick }: {
  current: WizardStepId;
  progress: WizardProgress | null;
  reachable?: boolean;
  onPick: (id: WizardStepId) => void;
}) {
  const pct = setupPercent(progress);
  return (
    <div className="flex items-center gap-3">
      <StepBar<WizardStepId>
        idBase="wz-stage"
        label="Setup steps"
        className="min-w-0 flex-1"
        mode="steps"
        current={current}
        showIcons="always"
        items={WIZARD_STEPS.map((s) => ({
          id: s.id,
          label: s.label,
          Icon: STEP_ICON[s.id],
          done: progress?.done.includes(s.id) ?? false,
          reachable: reachable || s.id === current,
          note: s.optional ? ', optional' : undefined,
        }))}
        onPick={(id) => onPick(id)}
      />
      <p className="shrink-0 text-[12px] font-medium text-white/70" aria-label={`Your setup is ${pct}% done`}>
        <span aria-hidden>{pct}%</span>
      </p>
    </div>
  );
}

/** Phone: where am I, and how far to go (the card's stage bar is desktop-only). */
export function Rail({ current, progress, canVisit, onPick }: {
  current: WizardStepId;
  progress: WizardProgress | null;
  canVisit: boolean;
  onPick: (id: WizardStepId) => void;
}) {
  return (
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
      {/* Desktop: the step's ONE card fills the screen between the header
          and the footer (its stage bar replaces the old side rail). */}
      <div className="flex-1 mx-auto w-full max-w-[1560px] px-4 lg:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] pb-6 lg:pb-4 lg:pt-1">
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

/* ── The step shell: ONE card, its stages and its preview ─────────── */

/**
 * A wizard step's card (StageCard): the stage bar on top (from the wizard),
 * a compact title row, an optional bar of tabs or sub-steps, the options,
 * an optional Back / Next row, and the live preview embedded beside them.
 * Phones: the preview on top with the options in the drag-up drawer
 * (`sheet`), or the card then the preview (`stack`).
 *
 *   phone  a portrait phone preview      stage  the 3D try-on stage (wider)
 *   wide   the live wall (the larger half)
 */
export function StepShell({
  step, hint, aside, headExtra, tabs, notice, nav, label, children, preview, previewKind = 'phone', mobile = 'sheet', sheetLabel,
}: {
  step: WizardStepId;
  hint?: ReactNode;
  /** A line under the title row (e.g. the assistant link on Basics). */
  headExtra?: ReactNode;
  aside?: ReactNode;
  /** Tabs or the sub-step bar, under the title row. */
  tabs?: ReactNode;
  /** An alert shown above the options (a failed load…). */
  notice?: ReactNode;
  /** Back / Next for guided sub-steps. */
  nav?: ReactNode;
  /** The card's accessible name when it is not the step title. */
  label?: string;
  children: ReactNode;
  preview: ReactNode;
  previewKind?: PreviewKind;
  mobile?: 'sheet' | 'stack';
  /** The phone drawer's title. */
  sheetLabel: string;
}) {
  return (
    <StageCard
      label={label}
      labelledBy={label ? undefined : `wz-h-${step}`}
      head={<StepHeading step={step} hint={hint} aside={aside}>{headExtra}</StepHeading>}
      bar={tabs}
      nav={nav}
      preview={preview}
      previewKind={previewKind}
      phone={mobile}
      sheetLabel={sheetLabel}
    >
      {notice}
      {children}
    </StageCard>
  );
}
