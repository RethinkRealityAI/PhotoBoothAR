/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GuidedFrameMaker — AI frames for a host who is not a designer.
 *
 * First screen: a look (pre-picked from the event type), colours, an optional
 * "anything to add?", Generate. Nothing to write unless they want to;
 * "Describe it yourself" hands over to the free-text form. Then an honest
 * wait (staged copy, Stop, a client deadline that checks what happened
 * instead of paying twice), then the frame inside a phone with the booth's
 * buttons outlined, the event name drawn on in real type (editable, free),
 * "More like this", and Use.
 *
 * Shared by FrameStudio (create-event success) and AiFramePanel (studio), so
 * the two can never drift. All generation goes through
 * frameProcessing.runFrameGeneration (one automatic, free, quality retry).
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, PencilLine, RefreshCw, Sparkles, Square, Wand2 } from 'lucide-react';
import {
  aiErrorMessage,
  aiErrorRetryable,
  countFreeFramesLeft,
  frameAllowance,
  frameEventHexes,
  FREE_FRAMES_USED_COPY,
  type AiErrorCode,
} from '../../lib/ai';
import { useStudioBase } from '../admin/studioBase';
import { inferFrameLayout, type FrameLayout } from '../../lib/assetPrompt';
import {
  FRAME_PALETTES,
  FRAME_PRESETS,
  composePresetPrompt,
  defaultPresetFor,
  eventPalette,
  eventPaletteGreenNote,
  framePresetById,
  providerForPreset,
  type FramePalette,
  type FramePresetId,
} from '../../lib/framePresets';
import { rekeyOptions } from '../../lib/studio/frameQuality';
import {
  FRAME_STAGE_COPY,
  isWaitStopped,
  paintingCopy,
  processGeneratedFrame,
  recoverFrame,
  restyleFrameText,
  runFrameGeneration,
  takeUsable,
  type FrameRunResult,
  type FrameStage,
  type FrameTake,
} from '../../lib/studio/frameProcessing';
import {
  FRAME_TEXT_MAX,
  aiFrameName,
  cleanFrameText,
  formatFrameDate,
  type FrameTextFont,
  type FrameTextSpec,
} from '../../lib/studio/frameText';
import { providerBody, providerCostLabel } from '../../lib/providerPricing';
import FrameTruthPreview from './FrameTruthPreview';
import type { ProviderChoice } from './AiFramePanel';
import type { Experience } from '../../types';

interface EventFacts {
  uuid: string;
  slug: string;
  name: string;
  eventType: string | null;
  date: string | null;
  accentHexes: string[];
  occasion: string | null;
}

async function loadEventFacts(eventUuid: string | null, eventSlug: string | null): Promise<EventFacts | null> {
  if (!eventUuid && !eventSlug) return null;
  try {
    const { supabase } = await import('../../lib/supabase');
    const q = supabase.from('events').select('id, slug, name, event_type, starts_at, config');
    const { data, error } = await (eventUuid ? q.eq('id', eventUuid) : q.eq('slug', eventSlug as string)).maybeSingle();
    if (error || !data) {
      if (error) console.error('[frames] loadEventFacts', error);
      return null;
    }
    const cfg = (data.config ?? {}) as Record<string, unknown>;
    const brief = (cfg.brief ?? {}) as Record<string, unknown>;
    return {
      uuid: data.id as string,
      slug: data.slug as string,
      name: typeof data.name === 'string' ? data.name : '',
      eventType: typeof data.event_type === 'string' ? data.event_type : null,
      date: typeof data.starts_at === 'string' ? data.starts_at.slice(0, 10) : null,
      // The host's current accent first (Branding never rewrites accentHexes).
      accentHexes: frameEventHexes(cfg),
      occasion: typeof brief.occasion === 'string' && brief.occasion.trim() ? brief.occasion : null,
    };
  } catch (e) {
    console.error('[frames] loadEventFacts', e);
    return null;
  }
}

type Phase =
  | { kind: 'choose' }
  | { kind: 'working'; stage: FrameStage; startedAt: number }
  | { kind: 'results'; run: FrameRunResult; layout: FrameLayout; selected: number; rekeys: number; busy: boolean; note: string }
  | { kind: 'stopped'; reason: 'timeout' | 'aborted'; since: string; layout: FrameLayout; check: 'checking' | 'running' | 'failed' | 'unknown'; tries: number }
  | { kind: 'error'; code: AiErrorCode };

const FONT_PILLS: { id: FrameTextFont; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'script', label: 'Script' },
  { id: 'modern', label: 'Modern' },
];

/** How often, and how many times, a stopped wait checks on the job. */
const RECOVER_EVERY_MS = 8_000;
const RECOVER_TRIES = 20;

const chip = (active: boolean) =>
  `pressable min-h-[44px] rounded-full px-3.5 font-sans text-[12px] leading-tight transition-colors border ${
    active
      ? 'bg-accent/20 border-[color:var(--color-accent)]/60 text-brand-fg'
      : 'border-white/10 bg-white/[0.04] text-brand-muted hover:text-brand-fg'
  }`;
// Ink is decided per mount (see `platform` below): `--on-accent` is the
// contrast-checked ink for the platform's foil; the frozen legacy studios
// keep their white.
const primaryBtnBase =
  'pressable min-h-[44px] flex items-center justify-center gap-2 rounded-full bg-foil px-5 font-label uppercase tracking-luxe text-[11px] font-bold glow-accent transition active:scale-[0.98] disabled:opacity-50';
const ghostBtn =
  'pressable min-h-[44px] flex items-center justify-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-4 font-label uppercase tracking-luxe text-[11px] text-brand-fg transition hover:bg-white/[0.08] disabled:opacity-50';
const field =
  'w-full min-h-[44px] rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-[13px] text-brand-fg placeholder:text-brand-muted/50 outline-none transition focus:border-[color:var(--color-accent)]/60';

export default function GuidedFrameMaker({
  eventUuid,
  eventSlug,
  freeTrial,
  providerChoice,
  onUse,
  useLabel = 'Use this frame',
  onDescribeYourself,
  onSpent,
}: {
  eventUuid: string | null;
  eventSlug: string | null;
  freeTrial: boolean;
  /** The studio's provider pick; absent → Beamwall AI. */
  providerChoice?: ProviderChoice;
  onUse: (exp: Experience) => void | Promise<unknown>;
  useLabel?: string;
  /** Switch to the free-text form. Hidden when absent. */
  onDescribeYourself?: () => void;
  /** A generation finished (credits may have moved) — refresh a balance. */
  onSpent?: () => void;
}) {
  const [ev, setEv] = useState<EventFacts | null>(null);
  const [evFailed, setEvFailed] = useState(false);
  const [presetPick, setPresetPick] = useState<FramePresetId | null>(null);
  const [palettePick, setPalettePick] = useState<string | null>(null);
  const [extra, setExtra] = useState('');
  const [variants, setVariants] = useState(1);
  const [textOn, setTextOn] = useState(true);
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [subtitleEdit, setSubtitleEdit] = useState<string | null>(null);
  const [font, setFont] = useState<FrameTextFont>('classic');
  const [guides, setGuides] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  // Platform mounts (/host/events/…) only; the legacy admin studios render
  // exactly as before.
  const platform = useStudioBase().startsWith('/host/');
  const primaryBtn = `${primaryBtnBase} ${platform ? 'text-[color:var(--on-accent)]' : 'text-white'}`;
  // Free AI images left on this event (null = unknown → show the price).
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  const [freeCheck, setFreeCheck] = useState(0);

  useEffect(() => {
    let alive = true;
    void loadEventFacts(eventUuid, eventSlug).then((f) => {
      if (!alive) return;
      setEv(f);
      setEvFailed(f === null);
    });
    return () => { alive = false; };
  }, [eventUuid, eventSlug]);

  // Re-counted after every generation (freeCheck), so the button flips from
  // "free" to the price the moment the third free one is used.
  const evUuid = ev?.uuid ?? null;
  useEffect(() => {
    if (!platform || !evUuid) return;
    let alive = true;
    void countFreeFramesLeft(evUuid).then((n) => { if (alive) setFreeLeft(n); });
    return () => { alive = false; };
  }, [platform, evUuid, freeCheck]);

  // Stop waiting (never stops the server) if the host navigates away.
  useEffect(() => () => abortRef.current?.abort(), []);

  // One-second tick while painting, for the staged copy.
  useEffect(() => {
    if (phase.kind !== 'working') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  const provider = providerChoice?.effective ?? 'gemini';
  const presetId = presetPick ?? defaultPresetFor(ev?.eventType, ev?.occasion);
  const preset = framePresetById(presetId) ?? FRAME_PRESETS[0];
  const evPal = eventPalette(ev?.accentHexes);
  const greenNote = eventPaletteGreenNote(ev?.accentHexes);
  const palettes: FramePalette[] = evPal ? [evPal, ...FRAME_PALETTES] : [...FRAME_PALETTES];
  const palette = palettes.find((p) => p.id === (palettePick ?? palettes[0].id)) ?? palettes[0];
  const title = titleEdit ?? ev?.name ?? '';
  const subtitle = subtitleEdit ?? formatFrameDate(ev?.date);
  const textSpec: FrameTextSpec = { enabled: textOn && cleanFrameText(title) !== '', title, subtitle, font };
  // A free slot covers the whole request (ai-generate-image zeroCost), but it
  // grants ONE take (jobPolicy FREE_TRIAL_MAX_VARIANTS = 1) — so while one is
  // left, the "how many options" choice is hidden exactly as on a free plan.
  const freeNext = freeLeft !== null && freeLeft > 0;
  const oneTake = freeTrial || freeNext;
  // Platform only; `freeTrial` = no aiStudio (FrameStudio/AssetsDock pass
  // !entitlements.aiStudio). Out of free frames without it, the server
  // answers upgrade_required — so no Generate is offered, only the way on.
  const allowance = platform ? frameAllowance(freeLeft, !freeTrial) : null;
  const outOfFree = allowance === 'upgrade';
  const costLabel = freeNext ? 'free' : allowance === 'trial' ? 'first 3 free' : providerCostLabel(provider, providerChoice?.status ?? null);
  const upgradeNote = (
    <p className="font-sans text-[13px] text-brand-fg leading-snug">
      {FREE_FRAMES_USED_COPY}{' '}
      <a href="/host/billing" target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center align-middle underline text-accent-2">See upgrade options</a>
    </p>
  );
  const higgsfieldTip =
    providerChoice !== undefined &&
    providerForPreset(preset, provider, providerChoice.higgsfieldReady) !== provider;

  /* ── The stopped-wait check: what happened, without paying again ─────── */
  useEffect(() => {
    if (phase.kind !== 'stopped' || !ev) return;
    if (phase.check !== 'checking' && phase.check !== 'running') return;
    if (phase.tries >= RECOVER_TRIES) return;
    const { since, layout, tries } = phase;
    const t = setTimeout(async () => {
      const r = await recoverFrame(ev.uuid, ev.slug, since);
      if (r.state === 'done') {
        const p = await processGeneratedFrame(r.experience, ev.slug, {}, {
          layout,
          text: textSpec.enabled ? { spec: textSpec, layout, accentHexes: palette.hexes } : null,
          ...(platform ? { name: aiFrameName(preset.label) } : {}),
        });
        onSpent?.();
        // The recovered frame used a free slot too — re-count it.
        setFreeCheck((n) => n + 1);
        setPhase({
          kind: 'results',
          run: { takes: [{ experience: p.experience, keyed: p.keyed, quality: p.quality }], job: r.job, autoRetried: false, retryFree: false, retryUnavailable: false },
          layout, selected: 0, rekeys: 0, busy: false, note: 'It finished after all — here it is.',
        });
        return;
      }
      setPhase((cur) =>
        cur.kind === 'stopped'
          ? { ...cur, check: r.state === 'running' ? 'running' : r.state, tries: tries + 1 }
          : cur);
    }, phase.check === 'checking' ? 1500 : RECOVER_EVERY_MS);
    return () => clearTimeout(t);
    // textSpec/palette are deliberately read at the moment the frame lands.
  }, [phase, ev]);

  /** A new paid generation is only safe when nothing is still being made. */
  const stillMaking = phase.kind === 'stopped' && (phase.check === 'checking' || phase.check === 'running') && phase.tries < RECOVER_TRIES;

  const generate = async (referenceImageUrl?: string) => {
    if (!ev || phase.kind === 'working' || stillMaking) return;
    const words = extra.trim();
    const fromWords = inferFrameLayout(words);
    const layout: FrameLayout = fromWords !== 'classic-border' ? fromWords : preset.layout;
    // Words for the prompt only for a named swatch; the HEXES always go, the
    // event's too — the server's own fallback is config.accentHexes, which
    // still holds the template colours after a Branding change.
    const picked = palette.id === 'event' ? null : palette;
    const ctl = new AbortController();
    abortRef.current = ctl;
    // A little slack for clock skew between this device and the database.
    const since = new Date(Date.now() - 10_000).toISOString();
    setPhase({ kind: 'working', stage: 'painting', startedAt: Date.now() });
    setNow(Date.now());
    const res = await runFrameGeneration({
      eventUuid: ev.uuid,
      eventSlug: ev.slug,
      opts: {
        // The deployed server reads only `prompt`; a newer one reads the
        // preset / extra / palette fields and fences `extra` alone.
        prompt: composePresetPrompt(preset.id, words, picked),
        preset: preset.id,
        extra: words,
        kind: 'border',
        transparentBackground: false,
        greenScreen: true,
        layout,
        plaque: textSpec.enabled,
        ...(platform
          ? (palette.hexes.length > 0 ? { palette: palette.hexes.slice(0, 3) } : {})
          : (picked ? { palette: picked.hexes } : {})),
        ...(oneTake ? {} : { variants }),
        ...providerBody(provider),
        ...(referenceImageUrl ? { referenceImageUrl } : {}),
      },
      text: textSpec.enabled ? { spec: textSpec, layout, accentHexes: palette.hexes } : null,
      // New frames get a human name (platform; legacy studios unchanged).
      ...(platform ? { look: preset.label } : {}),
      signal: ctl.signal,
      onStage: (stage) => setPhase((p) => (p.kind === 'working' ? { ...p, stage } : p)),
    });
    if (abortRef.current === ctl) abortRef.current = null;
    onSpent?.();
    setFreeCheck((n) => n + 1);
    if (res.error !== null || !res.data) {
      const code = res.error ?? 'internal';
      if (isWaitStopped(code)) {
        setPhase({ kind: 'stopped', reason: code === 'timeout' ? 'timeout' : 'aborted', since, layout, check: 'checking', tries: 0 });
      } else {
        setPhase({ kind: 'error', code });
      }
      return;
    }
    const run = res.data;
    const note = run.autoRetried
      ? run.retryFree
        ? 'The first try didn’t fit the booth, so we redid it once — free.'
        : 'The first try didn’t fit the booth; we tried once more.'
      : '';
    setPhase({ kind: 'results', run, layout, selected: 0, rekeys: 0, busy: false, note });
  };

  const results = phase.kind === 'results' ? phase : null;
  const take: FrameTake | null = results ? results.run.takes[results.selected] ?? null : null;

  const patchTake = (next: FrameTake, note = '') =>
    setPhase((p) => {
      if (p.kind !== 'results') return p;
      const takes = p.run.takes.slice();
      takes[p.selected] = next;
      return { ...p, run: { ...p.run, takes }, busy: false, note };
    });
  const setBusy = (busy: boolean) => setPhase((p) => (p.kind === 'results' ? { ...p, busy } : p));

  /** Free: re-key the SAME image once with a looser key (never regenerates). */
  const rekey = async () => {
    if (!results || !take || !ev) return;
    const keyOpts = rekeyOptions(results.rekeys);
    if (!keyOpts) return;
    setBusy(true);
    const p = await processGeneratedFrame(take.experience, ev.slug, {}, {
      layout: results.layout,
      keyOpts,
      text: textSpec.enabled ? { spec: textSpec, layout: results.layout, accentHexes: palette.hexes } : null,
    });
    setPhase((cur) => (cur.kind === 'results' ? { ...cur, rekeys: cur.rekeys + 1 } : cur));
    patchTake({ experience: p.experience, keyed: p.keyed, quality: p.quality }, p.keyed ? 'Cleaned up — no extra credits.' : '');
  };

  /** Free: redraw the name/date on the saved art. */
  const applyText = async () => {
    if (!results || !take || !ev) return;
    setBusy(true);
    const updated = await restyleFrameText(take.experience, ev.slug, {
      spec: textSpec,
      layout: results.layout,
      accentHexes: palette.hexes,
    });
    if (updated) patchTake({ ...take, experience: updated }, textSpec.enabled ? 'Text updated.' : 'Text removed.');
    else patchTake(take, 'Couldn’t update the text — try again.');
  };

  const use = async () => {
    if (!take) return;
    setBusy(true);
    try {
      await onUse(take.experience);
    } finally {
      setBusy(false);
    }
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (evFailed) {
    return (
      <p role="alert" className="font-sans text-[12px] text-red-300 leading-snug">
        Couldn’t load this event to design a frame — check your connection and reopen this panel.
      </p>
    );
  }

  const textControls = (
    <fieldset className="flex flex-col gap-2 min-w-0">
      <legend className="sr-only">Event name on the frame</legend>
      <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer">
        <input type="checkbox" checked={textOn} onChange={(e) => setTextOn(e.target.checked)} className="w-5 h-5 accent-[color:var(--color-accent)]" />
        <span className="font-sans text-[13px] text-brand-fg">Add the event name</span>
      </label>
      {textOn && (
        <div className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitleEdit(e.target.value.slice(0, FRAME_TEXT_MAX))}
            aria-label="Name on the frame"
            placeholder="Event name"
            className={field}
          />
          <input
            value={subtitle}
            onChange={(e) => setSubtitleEdit(e.target.value.slice(0, FRAME_TEXT_MAX))}
            aria-label="Second line (date or a few words)"
            placeholder="Date or a few words (optional)"
            className={field}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lettering">
            {FONT_PILLS.map((f) => (
              <button key={f.id} type="button" aria-pressed={font === f.id} onClick={() => setFont(f.id)} className={chip(font === f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );

  /* Waiting */
  if (phase.kind === 'working') {
    const seconds = Math.max(0, Math.floor((now - phase.startedAt) / 1000));
    const line = phase.stage === 'painting' ? paintingCopy(seconds) : FRAME_STAGE_COPY[phase.stage];
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center" aria-live="polite">
        <Loader2 className="w-6 h-6 text-[color:var(--color-accent)] motion-safe:animate-spin" aria-hidden="true" />
        <p className="font-sans text-[14px] text-brand-fg">{line}</p>
        <p className="font-sans text-[12px] text-brand-muted leading-snug max-w-[30ch]">
          {phase.stage === 'tidying'
            ? 'The first try didn’t fit the booth — redoing it once, free.'
            : 'Most frames take 20–60 seconds.'}
        </p>
        <button type="button" onClick={() => abortRef.current?.abort()} className={ghostBtn}>
          <Square className="w-3.5 h-3.5" aria-hidden="true" /> Stop waiting
        </button>
        <p className="font-sans text-[11px] text-brand-muted/80 leading-snug max-w-[34ch]">
          Stopping never charges twice — if it was already being made it still lands in your Frames.
        </p>
      </div>
    );
  }

  /* Stopped (timeout or cancel) */
  if (phase.kind === 'stopped') {
    const copy =
      phase.check === 'failed'
        ? 'That one didn’t finish, and it was refunded. You can safely try again.'
        : !stillMaking
          ? 'We couldn’t confirm whether it finished. Check your Frames in a minute before trying again.'
          : phase.reason === 'timeout'
            ? 'This is taking much longer than usual. It’s still being made — we’ll show it here the moment it lands. You won’t be charged again.'
            : 'Stopped waiting. If it was already being made, we’ll show it here when it lands — you won’t be charged twice.';
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="font-sans text-[13px] text-brand-fg leading-snug">{copy}</p>
        {stillMaking && (
          <p className="flex items-center gap-2 font-sans text-[12px] text-brand-muted">
            <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Checking…
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPhase({ kind: 'choose' })} disabled={stillMaking} className={ghostBtn}>
            Back
          </button>
          {!outOfFree && (
            <button type="button" onClick={() => void generate()} disabled={stillMaking} className={primaryBtn}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again · {costLabel}
            </button>
          )}
        </div>
        {outOfFree && upgradeNote}
      </div>
    );
  }

  /* Results */
  if (results && take) {
    const usable = takeUsable(take);
    const fail = take.quality?.reasons.find((r) => r.severity === 'fail');
    const warns = take.quality?.reasons.filter((r) => r.severity === 'warn') ?? [];
    const canRekey = !take.keyed && rekeyOptions(results.rekeys) !== null;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
          <FrameTruthPreview
            assetUrl={take.keyed ? take.experience.asset_url : null}
            layout={results.layout}
            guides={guides}
            className="w-[min(58vw,200px)] shrink-0"
          />
          <div className="flex-1 min-w-0 flex flex-col gap-3 w-full">
            {results.run.takes.length > 1 && (
              <div className="flex gap-2" role="group" aria-label="Options">
                {results.run.takes.map((t, i) => (
                  <button
                    key={t.experience.id}
                    type="button"
                    aria-pressed={i === results.selected}
                    aria-label={`Option ${i + 1}${takeUsable(t) ? '' : ' (needs a fix)'}`}
                    onClick={() => setPhase({ ...results, selected: i, note: '' })}
                    className={`pressable w-14 aspect-[9/16] rounded-lg overflow-hidden border-2 bg-black/40 ${
                      i === results.selected ? 'border-[color:var(--color-accent)]' : 'border-white/10'
                    }`}
                  >
                    {t.keyed && t.experience.asset_url && (
                      <img src={t.experience.asset_url} alt="" className="w-full h-full object-contain" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {results.note && <p className="font-sans text-[12px] text-brand-muted leading-snug" aria-live="polite">{results.note}</p>}

            {!take.keyed && (
              <p role="alert" className="font-sans text-[13px] text-amber-200 leading-snug">
                The background didn’t come away cleanly on this one.
              </p>
            )}
            {take.keyed && fail && (
              <p role="alert" className="font-sans text-[13px] text-amber-200 leading-snug">{fail.message}</p>
            )}
            {take.keyed && !fail && warns.map((w) => (
              <p key={w.code} className="font-sans text-[12px] text-brand-muted leading-snug">{w.message}</p>
            ))}
            {results.run.retryUnavailable && !usable && !outOfFree && (
              <p className="font-sans text-[12px] text-brand-muted leading-snug">{freeNext ? 'A fresh try is free.' : `A fresh try costs ${costLabel}.`}</p>
            )}
            {!usable && outOfFree && upgradeNote}

            <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer">
              <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} className="w-5 h-5 accent-[color:var(--color-accent)]" />
              <span className="font-sans text-[12px] text-brand-muted">Show where the booth’s buttons sit</span>
            </label>

            <div className="flex flex-wrap gap-2">
              {/* A take that failed the gate is never the primary action:
                  the fix (Clean it up / a fresh try) leads, "Use anyway" trails. */}
              {take.keyed && usable && (
                <button type="button" onClick={() => void use()} disabled={results.busy} className={primaryBtn}>
                  {results.busy ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                  {useLabel}
                </button>
              )}
              {!usable && !outOfFree && (
                <button type="button" onClick={() => void generate()} disabled={results.busy} className={primaryBtn}>
                  <RefreshCw className="w-4 h-4" aria-hidden="true" /> Try a fresh one · {costLabel}
                </button>
              )}
              {canRekey && (
                <button type="button" onClick={() => void rekey()} disabled={results.busy} className={ghostBtn}>
                  <Wand2 className="w-3.5 h-3.5" aria-hidden="true" /> Clean it up · free
                </button>
              )}
              {take.keyed && usable && !outOfFree && provider === 'gemini' && take.experience.asset_url && (
                <button type="button" onClick={() => void generate(take.experience.asset_url ?? undefined)} disabled={results.busy} className={ghostBtn}>
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> More like this · {costLabel}
                </button>
              )}
              {take.keyed && !usable && (
                <button type="button" onClick={() => void use()} disabled={results.busy} className={ghostBtn}>
                  {results.busy ? <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                  Use anyway
                </button>
              )}
              <button type="button" onClick={() => setPhase({ kind: 'choose' })} disabled={results.busy} className={ghostBtn}>
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Start over
              </button>
            </div>
          </div>
        </div>

        {take.keyed && (
          <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
            {textControls}
            <button type="button" onClick={() => void applyText()} disabled={results.busy} className={`${ghostBtn} self-start`}>
              {results.busy ? <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <PencilLine className="w-3.5 h-3.5" aria-hidden="true" />}
              Update text · free
            </button>
          </div>
        )}
      </div>
    );
  }

  /* First screen */
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2 min-w-0">
        <legend className="font-label uppercase tracking-luxe text-[11px] text-brand-muted mb-1">Pick a look</legend>
        <div className="grid grid-cols-2 gap-2">
          {FRAME_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === preset.id}
              onClick={() => setPresetPick(p.id)}
              className={`pressable min-h-[56px] rounded-xl border px-3 py-2 text-left transition-colors ${
                p.id === preset.id
                  ? 'bg-accent/15 border-[color:var(--color-accent)]/60'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <span className="block font-sans text-[13px] text-brand-fg leading-tight">{p.label}</span>
              <span className="block font-sans text-[11px] text-brand-muted leading-snug">{p.blurb}</span>
            </button>
          ))}
        </div>
        {higgsfieldTip && (
          <p className="font-sans text-[11px] text-brand-muted leading-snug">
            Tip: this look comes out especially crisp on Higgsfield.
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2 min-w-0">
        <legend className="font-label uppercase tracking-luxe text-[11px] text-brand-muted mb-1">Colours</legend>
        <div className="flex flex-wrap gap-2">
          {palettes.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === palette.id}
              onClick={() => setPalettePick(p.id)}
              className={`${chip(p.id === palette.id)} flex items-center gap-2 pl-2`}
            >
              <span className="flex -space-x-1" aria-hidden="true">
                {p.hexes.map((h) => (
                  <span key={h} className="w-5 h-5 rounded-full border border-black/30" style={{ background: h }} />
                ))}
              </span>
              {p.label}
            </button>
          ))}
        </div>
        {/* Platform only: a green event colour is dropped by the cut-out key
            (no "Your colours" chip, or one without the green) — say so
            instead of leaving the host to wonder where their colour went. */}
        {platform && greenNote !== null && (evPal === null || palette.id === 'event') && (
          <p className="font-sans text-[12px] text-brand-muted leading-snug">{greenNote}</p>
        )}
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="font-label uppercase tracking-luxe text-[11px] text-brand-muted">Anything to add? (optional)</span>
        <input
          value={extra}
          onChange={(e) => setExtra(e.target.value.slice(0, 300))}
          placeholder="e.g. tiny basketballs in the corners"
          className={field}
        />
      </label>

      {textControls}

      {!oneTake && (
        <fieldset className="flex flex-col gap-1.5 min-w-0">
          <legend className="font-label uppercase tracking-luxe text-[11px] text-brand-muted mb-1">How many options</legend>
          <div className="flex gap-2" role="group" aria-label="How many options">
            {[1, 2].map((n) => (
              <button key={n} type="button" aria-pressed={variants === n} onClick={() => setVariants(n)} className={`${chip(variants === n)} min-w-[44px]`}>
                {n}
              </button>
            ))}
          </div>
          {variants > 1 && (
            <p className="font-sans text-[11px] text-brand-muted leading-snug">Both options together cost {costLabel}, the same as one.</p>
          )}
        </fieldset>
      )}

      {phase.kind === 'error' && (
        <p role="alert" className="font-sans text-[13px] text-red-300 leading-snug">
          {aiErrorMessage(phase.code)}
          {!aiErrorRetryable(phase.code) && phase.code === 'insufficient_credits' && (
            <> <a href="/host/billing" target="_blank" rel="noopener" className="underline text-accent-2">Top up</a></>
          )}
        </p>
      )}

      {outOfFree && upgradeNote}
      <div className="flex flex-col sm:flex-row gap-2">
        {!outOfFree && (
          <button type="button" onClick={() => void generate()} disabled={!ev} className={`${primaryBtn} sm:flex-1`}>
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            {ev ? `Generate · ${costLabel}` : 'Loading…'}
          </button>
        )}
        {onDescribeYourself && (
          <button type="button" onClick={onDescribeYourself} className={ghostBtn}>
            <PencilLine className="w-3.5 h-3.5" aria-hidden="true" /> Describe it yourself
          </button>
        )}
      </div>
    </div>
  );
}
