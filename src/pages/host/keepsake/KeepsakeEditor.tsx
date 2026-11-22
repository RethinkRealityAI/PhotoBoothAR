/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KeepsakeEditor — how the morning-after keepsake looks, reads and sounds.
 *
 * STANDS ALONE: it loads and saves its own settings (events.config.keepsakes,
 * src/lib/keepsakeSettings.ts) so the same component mounts on Share & Print
 * (variant 'panel') and inside the host setup wizard (variant 'wizard', no
 * outer card chrome). Every rule a host can trip over lives in the pure,
 * tested src/lib/keepsakeEditor.ts; this file only wires it.
 *
 * ONE GROUP AT A TIME (owner, 2026-11-21: "not … super long stuff"): tabs
 * Look · Greeting · Take-home · Music · Sending, with a pinned live preview
 * that follows the active tab — beside the options on desktop (≥1024px), on
 * top of them on a phone. The whole editor is one viewport tall; only the
 * options column scrolls.
 *
 * GUIDED ON FIRST USE (owner, 2026-11-21: "they may not click on the tabs"):
 * the bar is a numbered step list (the five tabs, then Review), a tick on each
 * step seen, steps not yet reached shown but not clickable, Back / "Next: …"
 * at the bottom, and Review summarising every choice with a Change link. Once
 * every step has been seen (remembered per event on this device) the same bar
 * becomes free tabs that still nudge forward. The wizard is always guided.
 * Save is in the header on every step; nobody is forced to the end to save.
 *
 * SAVE IS EXPLICIT. No autosave: a host tries themes and words freely, sees
 * "Unsaved changes" (and a dot on each tab that has them), and only Save
 * writes. The save bar is the editor's own header row, so it never floats
 * over a field. A failed READ never shows defaults with a Save button —
 * saving those would overwrite a real configuration.
 *
 * HANDLED FAILURES: settings read fails (retry card, nothing saveable) · org
 * read fails (signer stays as stored) · plan read fails (no film note, never a
 * guess) · save fails or writes zero rows (stays dirty, says so, toast) ·
 * a music file missing, not audio, or refusing to play (that preview button is
 * disabled with a note; nothing throws) · no ToastProvider above (inline status
 * only).
 */
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Download, ListChecks, Loader2, Mail, MessageCircleHeart, Music, Palette, RotateCcw, Wand2, type LucideIcon } from 'lucide-react';
import { fetchMyOrg } from '../../../lib/host';
import { fetchKeepsakeFilmIncluded, fetchKeepsakeSettings, saveKeepsakeSettings } from '../../../lib/keepsakeContacts';
import type { KeepsakeSettings } from '../../../lib/keepsakeSettings';
import {
  KEEPSAKE_REVIEW_STEP,
  KEEPSAKE_SEEN_ALL,
  KEEPSAKE_STEPS,
  KEEPSAKE_TABS,
  dirtyKeepsakeTabs,
  keepsakeAllStepsSeen,
  keepsakeEditorMode,
  keepsakeReviewRows,
  keepsakeSeenFromStorage,
  keepsakeSeenStorageKey,
  keepsakeSettingsEqual,
  keepsakeStep,
  keepsakeStepForKey,
  keepsakeStepLabel,
  keepsakeStepNav,
  keepsakeStepReachable,
  markKeepsakeStepSeen,
  prefillHostName,
  resetKeepsakeLook,
  sampleCopyContext,
  type KeepsakeStepId,
  type KeepsakeTabId,
} from '../../../lib/keepsakeEditor';
import { TabHint, useOptionalToast } from './controls';
import { useTrackPreview } from './useTrackPreview';
import { KEEPSAKE_EDITOR_CSS, KeepsakePreview } from './KeepsakePreview';
import { LookPanel } from './LookPanel';
import { GreetingPanel } from './GreetingPanel';
import { MusicPanel, SendingPanel, TakeHomePanel } from './ChoicePanels';
import StageCard, { StageBarContext, StepBar, StepNav, focusStepPanel } from '../wizard/StageCard';

export interface KeepsakeEditorProps {
  eventUuid: string;
  eventName: string;
  /** 'panel' = its own card (Share & Print). 'wizard' = the setup wizard's
   *  Keepsake step: the same card wears the wizard's stages on top and these
   *  steps under its head, always guided. */
  variant?: 'panel' | 'wizard';
  /** Wizard only: hands the wizard a "save if there are changes" to run when
   *  the host presses Continue (false = stay; the editor says why). */
  onRegisterSave?: (fn: (() => Promise<boolean>) | null) => void;
}

type LoadState = 'loading' | 'failed' | 'ready';
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const TAB_ICON: Record<KeepsakeStepId, LucideIcon> = {
  look: Palette,
  greeting: MessageCircleHeart,
  takehome: Download,
  music: Music,
  sending: Mail,
  review: ListChecks,
};

/** "Seen every step" for this event on this device. Storage that throws or is
 *  empty just means guided mode shows again, which is harmless. */
function readSeen(eventUuid: string): readonly KeepsakeStepId[] {
  try {
    return keepsakeSeenFromStorage(window.localStorage.getItem(keepsakeSeenStorageKey(eventUuid)));
  } catch {
    return keepsakeSeenFromStorage(null);
  }
}

function rememberSeenAll(eventUuid: string) {
  try {
    window.localStorage.setItem(keepsakeSeenStorageKey(eventUuid), KEEPSAKE_SEEN_ALL);
  } catch {
    /* Private mode / blocked storage: the editor guides again next time. */
  }
}

export function KeepsakeEditor({ eventUuid, eventName, variant = 'panel', onRegisterSave }: KeepsakeEditorProps) {
  const toast = useOptionalToast();
  const wizard = variant === 'wizard';
  const [load, setLoad] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<KeepsakeSettings | null>(null);
  const [draft, setDraft] = useState<KeepsakeSettings | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [filmIncluded, setFilmIncluded] = useState<boolean | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [step, setStep] = useState<KeepsakeStepId>('look');
  const [seen, setSeen] = useState<readonly KeepsakeStepId[]>(['look']);
  /** What this device had seen when the editor opened. The mode follows it, so
   *  the bar does not turn into tabs under the host the moment they reach
   *  Review; finishing is remembered and the NEXT open is free tabs. */
  const [seenAtOpen, setSeenAtOpen] = useState<readonly KeepsakeStepId[]>(['look']);
  const tabRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  const wizardStages = useContext(StageBarContext);
  const [now] = useState(() => Date.now());
  const music = useTrackPreview();
  const mode = keepsakeEditorMode(variant, seenAtOpen);
  const free = mode === 'free';

  // The wizard is first-time setup: always guided from step one. Share & Print
  // opens as free tabs once this device has seen every step for this event.
  useEffect(() => {
    const initial = wizard ? (['look'] as const) : readSeen(eventUuid);
    setStep('look');
    setSeen(initial);
    setSeenAtOpen(initial);
  }, [eventUuid, wizard]);

  useEffect(() => {
    let alive = true;
    setLoad('loading');
    void Promise.all([
      fetchKeepsakeSettings(eventUuid),
      fetchMyOrg().catch(() => null),
    ]).then(([read, org]) => {
      if (!alive) return;
      if (read === null) { setLoad('failed'); return; }
      const name = org?.name ?? null;
      setOrgName(name);
      setStored(read.settings);
      setDraft(prefillHostName(read.settings, name));
      setLoad('ready');
      void fetchKeepsakeFilmIncluded(read.slug).then((v) => { if (alive) setFilmIncluded(v); });
    });
    return () => { alive = false; };
  }, [eventUuid, attempt]);

  const dirty = stored !== null && draft !== null && !keepsakeSettingsEqual(stored, draft);

  const update = useCallback((fn: (s: KeepsakeSettings) => KeepsakeSettings) => {
    setDraft((d) => (d === null ? d : fn(d)));
    setSaveState((s) => (s === 'saving' ? s : 'idle'));
  }, []);

  async function save(): Promise<boolean> {
    if (draft === null || saveState === 'saving') return false;
    const snapshot = draft;
    setSaveState('saving');
    const ok = await saveKeepsakeSettings(eventUuid, snapshot);
    if (ok) setStored(snapshot);
    setSaveState(ok ? 'saved' : 'failed');
    toast?.(ok ? 'Keepsake saved. Guests will see it in their album.' : 'Couldn’t save your keepsake. Check your connection and try again.', ok ? 'success' : 'error');
    return ok;
  }

  // The wizard's Continue saves unsaved changes first (nothing changes for
  // Share & Print, where Save stays the only way to write).
  const saveIfDirty = useRef<() => Promise<boolean>>(async () => true);
  saveIfDirty.current = async () => (dirty ? save() : true);
  useEffect(() => {
    if (!onRegisterSave) return;
    onRegisterSave(() => saveIfDirty.current());
    return () => onRegisterSave(null);
  }, [onRegisterSave]);

  /** Switch step and mark it seen; a track only plays while the Music step can
   *  show it playing. `focus`: 'tab' = its button in the bar, 'panel' = its
   *  options (for when the pressed button disappears with the step). */
  function goTo(next: KeepsakeStepId, focus: 'tab' | 'panel' | null = null) {
    if (next !== 'music') music.stop();
    setStep(next);
    const nextSeen = markKeepsakeStepSeen(seen, next);
    if (nextSeen !== seen) {
      setSeen(nextSeen);
      if (keepsakeAllStepsSeen(nextSeen)) rememberSeenAll(eventUuid);
    }
    if (focus === 'tab') requestAnimationFrame(() => tabRefs.current[next]?.focus());
    if (focus === 'panel') focusStepPanel(`ks-panel-${next}`);
  }

  const sized = load === 'ready' && draft !== null;
  const shell = (children: ReactNode) =>
    wizard ? (
      <section className="sc liquid-glass flex flex-col gap-4" aria-labelledby="keepsake-editor-title">
        {wizardStages && <div className="sc-stages hidden lg:block">{wizardStages}</div>}
        {children}
      </section>
    ) : (
      <section aria-labelledby="keepsake-editor-title" className="print:hidden liquid-glass rounded-3xl border border-accent/20 p-4 sm:p-6 flex flex-col gap-4">
        {children}
      </section>
    );

  const title = (
    <div className="flex items-center gap-2">
      <Wand2 className="h-4 w-4 shrink-0 text-accent-2" aria-hidden />
      <h2 id="keepsake-editor-title" className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/80">{wizard ? 'Your keepsake' : 'Design your keepsake'}</h2>
    </div>
  );

  if (!sized) {
    return shell(
      <>
        <style>{KEEPSAKE_EDITOR_CSS}</style>
        {title}
        {load === 'failed' ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl glass px-4 py-3">
            <p className="flex-1 min-w-[12rem] font-sans text-sm text-brand-fg">Couldn’t load your keepsake settings. Nothing has been changed.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex min-h-11 items-center gap-2 rounded-xl glass px-4 font-label uppercase tracking-luxe text-[10px] text-brand-muted/80 hover:text-accent-2">
              <RotateCcw className="h-4 w-4" aria-hidden /> Try again
            </button>
          </div>
        ) : (
          <p role="status" className="flex min-h-11 items-center gap-2 font-sans text-sm text-brand-muted/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your keepsake…
          </p>
        )}
      </>,
    );
  }

  const dirtyTabs: KeepsakeStepId[] = stored !== null ? dirtyKeepsakeTabs(stored, draft) : [];
  const nav = keepsakeStepNav(step);
  const position = step === 'review' ? null : keepsakeStep(step);
  const reviewRows = keepsakeReviewRows(draft, sampleCopyContext(eventName, orgName ?? '', now), filmIncluded);
  const status =
    saveState === 'saving' ? 'Saving…'
      : saveState === 'failed' ? 'Couldn’t save. Check your connection and try again.'
        : dirty ? 'Unsaved changes'
          : saveState === 'saved' ? 'All changes saved'
            : 'Nothing changes for guests until you press Save.';

  const panels: Record<KeepsakeTabId, ReactNode> = {
    look: <LookPanel draft={draft} onChange={update} />,
    greeting: <GreetingPanel draft={draft} stored={stored} orgName={orgName} onChange={update} />,
    takehome: <TakeHomePanel draft={draft} filmIncluded={filmIncluded} onChange={update} />,
    music: <MusicPanel draft={draft} music={music} onChange={update} />,
    sending: <SendingPanel draft={draft} onChange={update} />,
  };

  const bar = (
    <StepBar<KeepsakeStepId>
      idBase="ks"
      label={free ? 'Keepsake settings' : 'Keepsake steps'}
      mode={free ? 'tabs' : 'steps'}
      current={step}
      refs={tabRefs}
      doneText=", seen"
      keyFor={keepsakeStepForKey}
      items={KEEPSAKE_STEPS.map((s) => ({
        id: s.id,
        label: s.label,
        Icon: TAB_ICON[s.id],
        done: seen.includes(s.id),
        reachable: keepsakeStepReachable(s.id, seen, mode),
        dirty: dirtyTabs.includes(s.id),
        glyph: s.id === 'review' ? <ListChecks className="h-3 w-3" /> : undefined,
      }))}
      onPick={(id, via) => goTo(id, via === 'key' ? 'tab' : null)}
    />
  );

  const header = (
      <header className="flex items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title}
          <p role="status" aria-live="polite" className={`font-sans text-xs ${saveState === 'failed' ? 'text-amber-300' : dirty ? 'text-brand-fg' : 'text-brand-muted/60'}`}>
            {dirty && saveState !== 'failed' && saveState !== 'saving' && <span aria-hidden className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--bw-core,#FFC56B)] align-middle" />}
            {status}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            aria-label="Reset to defaults"
            title="Reset to defaults"
            onClick={() => { music.stop(); update((s) => resetKeepsakeLook(s, orgName)); }}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 font-sans text-xs text-brand-muted/70 hover:text-accent-2 sm:rounded-none"
          >
            <RotateCcw className="h-4 w-4 sm:hidden" aria-hidden />
            <span className="hidden underline underline-offset-4 sm:inline">Reset to defaults</span>
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saveState === 'saving' || !dirty}
            className="flex min-h-11 items-center gap-2 rounded-full bg-foil px-4 sm:px-6 font-label uppercase tracking-luxe text-[11px] font-bold text-[color:var(--on-accent)] transition active:scale-[0.98] disabled:opacity-45"
          >
            {saveState === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>
  );

  return (
    <>
      <style>{KEEPSAKE_EDITOR_CSS}</style>
      {/* The same card as every wizard step (StageCard). Share & Print: the
          save bar on top, these steps across the card. In the wizard: the
          wizard's stages on top, the save bar and these steps in the options
          column. */}
      <StageCard
        top={wizard ? undefined : header}
        head={wizard ? header : undefined}
        stages={wizard ? undefined : bar}
        bar={wizard ? bar : undefined}
        nav={(
          <StepNav
            onBack={nav.prev !== null ? () => { if (nav.prev !== null) goTo(nav.prev); } : null}
            next={nav.next !== null ? keepsakeStepLabel(nav.next) : null}
            position={position !== null ? `Step ${position.number} of ${position.total}` : 'Review'}
            onNext={() => { if (nav.next !== null) goTo(nav.next, nav.next === 'review' ? 'panel' : null); }}
          />
        )}
        preview={
          /* Review previews the album itself: its cover, in the chosen look. */
          <KeepsakePreview tab={step === 'review' ? 'look' : step} settings={draft} eventName={eventName} orgName={orgName ?? ''} filmIncluded={filmIncluded} music={music} />
        }
        previewKind="album"
        previewFit="fill"
        phone={wizard ? 'sheet' : 'pinned'}
        sheetLabel="Keepsake"
        standalone={!wizard}
        labelledBy="keepsake-editor-title"
        className={wizard ? '' : 'print:hidden rounded-3xl border border-accent/20'}
      >
        {KEEPSAKE_TABS.map((t) => (
          <div
            key={t.id}
            id={`ks-panel-${t.id}`}
            role={free ? 'tabpanel' : 'region'}
            aria-labelledby={`ks-tab-${t.id}`}
            hidden={step !== t.id}
            tabIndex={0}
            className="@container outline-none"
          >
            <div className="flex flex-col gap-4">
              <TabHint>{t.hint}</TabHint>
              {panels[t.id]}
            </div>
          </div>
        ))}

        <div
          id="ks-panel-review"
          role={free ? 'tabpanel' : 'region'}
          aria-labelledby="ks-tab-review"
          hidden={step !== 'review'}
          tabIndex={0}
          className="@container outline-none"
        >
          <div className="flex flex-col gap-3">
            <TabHint>{KEEPSAKE_REVIEW_STEP.hint}</TabHint>
            <ul className="flex flex-col gap-2">
              {reviewRows.map((r) => {
                const Icon = TAB_ICON[r.step];
                const isDirty = dirtyTabs.includes(r.step);
                return (
                  <li key={r.step} className="flex items-center gap-3 rounded-2xl glass py-1.5 pl-4 pr-1.5">
                    <Icon className="h-4 w-4 shrink-0 text-accent-2" aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">
                        {r.label}
                        {isDirty && (
                          <>
                            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--bw-core,#FFC56B)]" />
                            <span className="sr-only">, unsaved changes</span>
                          </>
                        )}
                      </span>
                      <span className="break-words font-sans text-sm leading-snug text-brand-fg">{r.value}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => goTo(r.step, 'tab')}
                      aria-label={`Change ${r.label}`}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-3 font-sans text-xs text-brand-muted/80 underline underline-offset-4 transition hover:text-accent-2"
                    >
                      Change
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-3 rounded-2xl glass-strong px-4 py-3">
              <p className="min-w-[10rem] flex-1 font-sans text-xs leading-relaxed text-brand-muted/70">
                {dirty ? 'Happy with it? Save to put this on your guests’ album.' : 'Nothing to save. This is what your guests will see.'}
              </p>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saveState === 'saving' || !dirty}
                className="flex min-h-11 items-center gap-2 rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[11px] font-bold text-[color:var(--on-accent)] transition active:scale-[0.98] disabled:opacity-45"
              >
                {saveState === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                {saveState === 'saving' ? 'Saving…' : 'Save keepsake'}
              </button>
            </div>
          </div>
        </div>

      </StageCard>
    </>
  );
}

export default KeepsakeEditor;
