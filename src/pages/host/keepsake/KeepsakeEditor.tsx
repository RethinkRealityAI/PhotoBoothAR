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
 * options column scrolls. In the wizard the same tabs are steps (Back/Next).
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
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, Loader2, Mail, MessageCircleHeart, Music, Palette, RotateCcw, Wand2, type LucideIcon } from 'lucide-react';
import { fetchMyOrg } from '../../../lib/host';
import { fetchKeepsakeFilmIncluded, fetchKeepsakeSettings, saveKeepsakeSettings } from '../../../lib/keepsakeContacts';
import type { KeepsakeSettings } from '../../../lib/keepsakeSettings';
import {
  KEEPSAKE_TABS,
  dirtyKeepsakeTabs,
  keepsakeSettingsEqual,
  keepsakeStep,
  keepsakeTabForKey,
  prefillHostName,
  resetKeepsakeLook,
  type KeepsakeTabId,
} from '../../../lib/keepsakeEditor';
import { TabHint, useOptionalToast } from './controls';
import { useTrackPreview } from './useTrackPreview';
import { KEEPSAKE_EDITOR_CSS, KeepsakePreview } from './KeepsakePreview';
import { LookPanel } from './LookPanel';
import { GreetingPanel } from './GreetingPanel';
import { MusicPanel, SendingPanel, TakeHomePanel } from './ChoicePanels';

export interface KeepsakeEditorProps {
  eventUuid: string;
  eventName: string;
  /** 'panel' = its own card (Share & Print). 'wizard' = no card chrome, tabs become steps. */
  variant?: 'panel' | 'wizard';
}

type LoadState = 'loading' | 'failed' | 'ready';
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const TAB_ICON: Record<KeepsakeTabId, LucideIcon> = {
  look: Palette,
  greeting: MessageCircleHeart,
  takehome: Download,
  music: Music,
  sending: Mail,
};

export function KeepsakeEditor({ eventUuid, eventName, variant = 'panel' }: KeepsakeEditorProps) {
  const toast = useOptionalToast();
  const wizard = variant === 'wizard';
  const [load, setLoad] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<KeepsakeSettings | null>(null);
  const [draft, setDraft] = useState<KeepsakeSettings | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [filmIncluded, setFilmIncluded] = useState<boolean | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [tab, setTab] = useState<KeepsakeTabId>('look');
  const tabRefs = useRef<Partial<Record<KeepsakeTabId, HTMLButtonElement | null>>>({});
  const music = useTrackPreview();

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

  async function save() {
    if (draft === null || saveState === 'saving') return;
    const snapshot = draft;
    setSaveState('saving');
    const ok = await saveKeepsakeSettings(eventUuid, snapshot);
    if (ok) setStored(snapshot);
    setSaveState(ok ? 'saved' : 'failed');
    toast?.(ok ? 'Keepsake saved. Guests will see it in their album.' : 'Couldn’t save your keepsake. Check your connection and try again.', ok ? 'success' : 'error');
  }

  /** Switch tab; a track only plays while the Music tab can show it playing. */
  function goTo(next: KeepsakeTabId, focus = false) {
    if (next !== 'music') music.stop();
    setTab(next);
    if (focus) requestAnimationFrame(() => tabRefs.current[next]?.focus());
  }

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const next = keepsakeTabForKey(tab, e.key);
    if (next === null) return;
    e.preventDefault();
    goTo(next, true);
  }

  const sized = load === 'ready' && draft !== null;
  const shell = (children: ReactNode) =>
    wizard ? (
      <div className={sized ? 'ks-ed' : 'flex flex-col gap-4'}>{children}</div>
    ) : (
      <section aria-labelledby="keepsake-editor-title" className={`print:hidden liquid-glass rounded-3xl border border-accent/20 p-4 sm:p-6 ${sized ? 'ks-ed' : 'flex flex-col gap-4'}`}>
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

  const dirtyTabs = stored !== null ? dirtyKeepsakeTabs(stored, draft) : [];
  const step = keepsakeStep(tab);
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

  return shell(
    <>
      <style>{KEEPSAKE_EDITOR_CSS}</style>

      {/* The save bar: the editor's own header row, never over a field. */}
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

      <div className={`ks-grid ${wizard ? 'ks-steps-on' : ''}`}>
        <div className="ks-area-tabs">
          <div className="wz-tabs ks-tabs" role="tablist" aria-label={wizard ? 'Keepsake steps' : 'Keepsake settings'} onKeyDown={onTabKey}>
            {KEEPSAKE_TABS.map((t, i) => {
              const Icon = TAB_ICON[t.id];
              const selected = tab === t.id;
              const isDirty = dirtyTabs.includes(t.id);
              return (
                <button
                  key={t.id}
                  ref={(el) => { tabRefs.current[t.id] = el; }}
                  id={`ks-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`ks-panel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  className="wz-tab"
                  onClick={() => goTo(t.id)}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="max-w-full truncate">{wizard ? <span className="sr-only">Step {i + 1}: </span> : null}{t.label}</span>
                  {isDirty && (
                    <>
                      <span className="ks-dot" aria-hidden />
                      <span className="sr-only">, unsaved changes</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {KEEPSAKE_TABS.map((t) => (
          <div
            key={t.id}
            id={`ks-panel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`ks-tab-${t.id}`}
            hidden={tab !== t.id}
            tabIndex={0}
            className="ks-area-panel @container"
          >
            <div className="flex flex-col gap-4">
              <TabHint>{t.hint}</TabHint>
              {panels[t.id]}
            </div>
          </div>
        ))}

        <aside className="ks-area-preview" aria-label="Live preview">
          <KeepsakePreview tab={tab} settings={draft} eventName={eventName} orgName={orgName ?? ''} filmIncluded={filmIncluded} music={music} />
        </aside>

        {wizard && (
          <nav className="ks-area-steps flex items-center gap-2" aria-label="Keepsake steps">
            <button
              type="button"
              onClick={() => { if (step.prev !== null) goTo(step.prev); }}
              disabled={step.prev === null}
              className="flex min-h-11 items-center gap-1 rounded-full glass px-4 font-sans text-sm text-brand-fg transition hover:text-accent-2 disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden /> Back
            </button>
            <p className="flex-1 text-center font-sans text-xs text-brand-muted/70" aria-live="polite">
              Step {step.number} of {step.total}
            </p>
            {step.next !== null ? (
              <button
                type="button"
                onClick={() => { if (step.next !== null) goTo(step.next); }}
                className="flex min-h-11 items-center gap-1 rounded-full bg-white/90 px-4 font-sans text-sm font-semibold text-[color:var(--bw-on-accent,#1A1740)] transition active:scale-[0.98]"
              >
                Next<span className="sr-only">: {KEEPSAKE_TABS[step.number]?.label}</span> <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            ) : (
              <span className="min-h-11 px-1 font-sans text-xs leading-[2.75rem] text-brand-muted/70">Last step</span>
            )}
          </nav>
        )}
      </div>
    </>,
  );
}

export default KeepsakeEditor;
