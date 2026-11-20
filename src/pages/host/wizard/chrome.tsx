/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The wizard's chrome: header, step rail, step heading and the sticky footer.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CloudOff, Loader2, X } from 'lucide-react';
import { WIZARD_STEPS, stepDef, stepIndex, type WizardProgress, type WizardStepId } from '../../../lib/wizard/wizardModel';
import type { SaveState } from './wizardContext';

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
  const doneCount = progress ? progress.done.filter((d) => d !== 'launch').length : 0;
  const pct = Math.round((doneCount / (WIZARD_STEPS.length - 1)) * 100);
  return (
    <>
      {/* Desktop: the whole journey, always visible. */}
      <nav aria-label="Setup steps" className="hidden lg:block">
        <div className="sticky top-[88px]"><div className="liquid-glass rounded-[28px] p-3">
          <div className="px-3 pt-2 pb-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/60">Your setup</p>
            <div className="mt-2 h-1.5 rounded-full bg-white/15 overflow-hidden" aria-hidden>
              <div className="h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-[12.5px] text-white/70">{pct}% done</p>
          </div>
          <ol className="flex flex-col gap-1">
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
                      {done && s.id !== current ? <Check className="h-4 w-4" /> : i + 1}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{s.label}</span>
                    {s.optional && <span className="text-[11px] text-white/50">Optional</span>}
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
          {WIZARD_STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              tabIndex={-1}
              disabled={!canVisit}
              onClick={() => onPick(s.id)}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s.id === current ? 'bg-white' : progress?.done.includes(s.id) ? 'bg-white/60' : 'bg-white/18'
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
        <div className="mx-auto max-w-[1320px] flex items-center gap-3">
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
      <div className="flex-1 mx-auto w-full max-w-[1320px] px-4 lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-8 pb-6">
        {rail}
        <main className="min-w-0 mt-4 lg:mt-0">{children}</main>
      </div>
      {footer}
    </div>
  );
}

export function WizardFooter({ onBack, onSkip, onContinue, continueLabel, busy, blocked }: {
  onBack: (() => void) | null;
  onSkip: (() => void) | null;
  onContinue: () => void;
  continueLabel: string;
  busy: boolean;
  blocked: string | null;
}) {
  return (
    <div className="wz-footer">
      <div className="mx-auto max-w-[1320px] flex items-center gap-2">
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
            className="pressable bg-foil inline-flex items-center gap-2 rounded-full px-6 min-h-12 text-[15px] font-semibold disabled:opacity-55"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {continueLabel}
            {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>
      {blocked && <p id="wz-blocked" className="sm:hidden mx-auto max-w-[1320px] mt-2 text-right text-[12.5px] text-white/75">{blocked}</p>}
    </div>
  );
}

export function StepHeading({ step, children }: { step: WizardStepId; children?: ReactNode }) {
  const d = stepDef(step);
  return (
    <div className="mb-5 lg:mb-7 wz-enter">
      <h1 className="wz-display text-[30px] leading-[1.08] sm:text-[38px] text-white">{d.title}</h1>
      <p className="mt-2 text-[15.5px] text-white/80 max-w-[60ch]">{d.blurb}</p>
      {children}
    </div>
  );
}

