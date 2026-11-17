/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Branding editor — admin-editable per-event identity: names/copy, onboarding
 * steps, theme colours, and the logo. Stored in app_settings (key='branding')
 * and applied at runtime, so an event can be re-themed without a code deploy.
 *
 * Edits preview live across the studio; "Save" persists them (and realtime
 * pushes them to the booth + wall). Leaving without saving reverts the preview.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Palette, Type, ListOrdered, Image as ImageIcon, Save, Check,
  Upload, Trash2, Plus, RefreshCw, Wallpaper, NotebookPen, Sparkles,
} from 'lucide-react';
import EventBackground from '../ui/EventBackground';
import { Wordmark } from '../ui/EventLogo';
import { useEvent } from '../../events/EventContext';
import { getBranding, setBranding, uploadAsset } from '../../lib/db';
import { updateEventConfig } from '../../lib/host';
import { mergeBrief, type BriefPatch, type EventBrief } from '../../lib/eventBrief';
import { BACKGROUND_TEMPLATES, DEFAULT_BACKGROUND_ID } from '../theme/backgrounds';
import { useStore } from '../../store';
import type { BrandingColors, BrandingOverrides } from '../../types';
import type { OnboardingStep } from '../../events/types';
import { TextField, TextArea, ColorField } from './fields';

const COLOR_FIELDS: Array<{ key: keyof BrandingColors; cssVar: string; label: string }> = [
  { key: 'accent', cssVar: '--color-accent', label: 'Accent (Gold)' },
  { key: 'accent2', cssVar: '--color-accent-2', label: 'Accent — Light' },
  { key: 'accent3', cssVar: '--color-accent-3', label: 'Accent — Deep' },
  { key: 'brandBg', cssVar: '--color-brand-bg', label: 'Background' },
  { key: 'brandSurface', cssVar: '--color-brand-surface', label: 'Surface / Cards' },
  { key: 'brandFg', cssVar: '--color-brand-fg', label: 'Text' },
  { key: 'brandMuted', cssVar: '--color-brand-muted', label: 'Muted Text' },
];

type Draft = {
  eventName: string;
  eyebrow: string;
  tagline: string;
  fullName: string;
  thankYou: string;
  shareTitle: string;
  momentTitle: string;
  shareText: string;
  /** Generated-once guest lines (eventCopy.ts); a host edit overlays them. */
  welcomeIntro: string;
  keepsakeIntro: string;
  onboardingSteps: OnboardingStep[];
  colors: Record<keyof BrandingColors, string>;
  logoUrl: string | null;
};

/** The Event brief form — lists as comma-separated text (mergeBrief splits). */
type BriefDraft = Record<'occasion' | 'honorees' | 'palette' | 'tone' | 'avoid' | 'notes', string>;

function briefToDraft(b: EventBrief | undefined): BriefDraft {
  return {
    occasion: b?.occasion ?? '',
    honorees: b?.honorees.join(', ') ?? '',
    palette: b?.palette ?? '',
    tone: b?.tone ?? '',
    avoid: b?.avoid.join(', ') ?? '',
    notes: b?.notes ?? '',
  };
}

/** "4 Sept 2026" from a full ISO-Z stamp; null when it does not parse, so the
 *  caller shows nothing rather than "Invalid Date". Display only — no date
 *  arithmetic happens here. */
function formatStamp(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function readCssColor(cssVar: string): string {
  if (typeof window === 'undefined') return '#000000';
  const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return v || '#000000';
}

function buildInitialDraft(): Draft {
  const copy = useStore.getState().copy;
  const branding = useStore.getState().branding;
  const colors = {} as Record<keyof BrandingColors, string>;
  for (const { key, cssVar } of COLOR_FIELDS) {
    colors[key] = branding.colors?.[key] ?? readCssColor(cssVar);
  }
  return {
    eventName: copy.eventName,
    eyebrow: copy.eyebrow,
    tagline: copy.tagline,
    fullName: copy.fullName,
    thankYou: copy.thankYou,
    shareTitle: copy.shareTitle,
    momentTitle: copy.momentTitle,
    shareText: copy.shareText,
    welcomeIntro: copy.welcomeIntro ?? '',
    keepsakeIntro: copy.keepsakeIntro ?? '',
    onboardingSteps: copy.onboardingSteps.map((s) => ({ ...s })),
    colors,
    logoUrl: useStore.getState().logoUrl,
  };
}

function draftToOverrides(d: Draft): BrandingOverrides {
  return {
    eventName: d.eventName,
    eyebrow: d.eyebrow,
    tagline: d.tagline,
    fullName: d.fullName,
    thankYou: d.thankYou,
    shareTitle: d.shareTitle,
    momentTitle: d.momentTitle,
    shareText: d.shareText,
    welcomeIntro: d.welcomeIntro,
    keepsakeIntro: d.keepsakeIntro,
    onboardingSteps: d.onboardingSteps,
    colors: { ...d.colors },
    logoUrl: d.logoUrl,
  };
}

export default function Branding() {
  const { eventId, eventUuid, source, config, refreshConfig } = useEvent();
  const applyBranding = useStore((s) => s.applyBranding);
  const [draft, setDraft] = useState<Draft>(() => buildInitialDraft());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Snapshot of last-saved branding so leaving without saving reverts the preview.
  const savedBrandingRef = useRef<BrandingOverrides>(useStore.getState().branding);
  const committedRef = useRef(false);

  // Refresh the draft from the DB once on mount (in case App's fetch hasn't landed).
  useEffect(() => {
    getBranding(eventId).then((b) => {
      savedBrandingRef.current = b;
      applyBranding(b);
      setDraft(buildInitialDraft());
    });
    return () => {
      // Revert any unsaved live-preview edits back to the last-saved state.
      if (!committedRef.current) applyBranding(savedBrandingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the draft live whenever it changes (preview across the studio).
  const overrides = useMemo(() => draftToOverrides(draft), [draft]);
  useEffect(() => {
    applyBranding(overrides);
    setSaved(false);
    committedRef.current = false; // unsaved edits should revert if we leave
  }, [overrides, applyBranding]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const patchColor = (key: keyof BrandingColors, v: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: v } }));
  const patchStep = (i: number, p: Partial<OnboardingStep>) =>
    setDraft((d) => ({ ...d, onboardingSteps: d.onboardingSteps.map((s, idx) => (idx === i ? { ...s, ...p } : s)) }));
  const addStep = () =>
    setDraft((d) => ({ ...d, onboardingSteps: [...d.onboardingSteps, { eyebrow: `Step ${d.onboardingSteps.length + 1}`, title: 'New step', body: '' }] }));
  const removeStep = (i: number) =>
    setDraft((d) => ({ ...d, onboardingSteps: d.onboardingSteps.filter((_, idx) => idx !== i) }));

  const handleLogo = async (file: File) => {
    setUploading(true);
    const url = await uploadAsset(eventId, file, `logo-${eventId}`);
    setUploading(false);
    if (url) patch({ logoUrl: url });
  };

  const save = async () => {
    setSaving(true);
    const o = draftToOverrides(draft);
    await setBranding(eventId, o);
    savedBrandingRef.current = o;
    committedRef.current = true;
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // ── Background template picker (runtime DB events only) ──
  const isDbEvent = source === 'db' && Boolean(eventUuid);
  const currentBgId = config.backgroundTemplateId ?? DEFAULT_BACKGROUND_ID;
  const [bgSaving, setBgSaving] = useState<string | null>(null);

  const selectBackground = async (id: string) => {
    if (!eventUuid || bgSaving || id === currentBgId) return;
    setBgSaving(id);
    const ok = await updateEventConfig(eventUuid, { background_template: id });
    // Re-fetch the event config into the EventProvider so the whole studio
    // (and this page's own backdrop) re-renders with the new template.
    if (ok) await refreshConfig();
    setBgSaving(null);
  };

  const resetToCoded = () => {
    // Clear all overrides back to the coded event defaults.
    applyBranding({});
    setDraft(buildInitialDraft());
  };

  // ── Event brief (runtime DB events only; events.config.brief) ──
  // The one shared memory the concierge, Platform Copilot and Scene Director
  // all read. Saved through updateEventConfig (a SHALLOW config merge — the
  // whole `brief` object is rebuilt by mergeBrief), then the EventProvider is
  // refreshed so the studio's Director sees the new line on its next turn.
  const [briefDraft, setBriefDraft] = useState<BriefDraft>(() => briefToDraft(config.brief));
  const [briefSaving, setBriefSaving] = useState(false);
  const [briefStatus, setBriefStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const briefStamp = config.brief?.updatedAt ?? null;
  // Re-seed when the stored brief changes underneath us (our own save's
  // refresh, or a copilot `update_brief` on another tab) — keyed on the stamp
  // so typing never resets the form.
  useEffect(() => { setBriefDraft(briefToDraft(config.brief)); }, [briefStamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchBrief = (p: Partial<BriefDraft>) => {
    setBriefStatus(null);
    setBriefDraft((d) => ({ ...d, ...p }));
  };

  const saveBrief = async () => {
    if (!eventUuid || briefSaving) return;
    setBriefSaving(true);
    setBriefStatus(null);
    // Every field is sent: the form IS the brief, so a cleared box clears the
    // field ('' → cleared per BriefPatch's contract).
    const patch: BriefPatch = { ...briefDraft };
    const next = mergeBrief(config.brief ?? null, patch, new Date().toISOString());
    const ok = await updateEventConfig(eventUuid, { brief: next });
    if (ok) {
      await refreshConfig();
      setBriefStatus({ tone: 'ok', text: 'Brief saved — the AI assistants read it on their next turn.' });
    } else {
      // false = the read failed OR the write touched zero rows (RLS-hidden or
      // deleted event) — either way nothing was stored; say so, never "Saved".
      setBriefStatus({ tone: 'error', text: 'Couldn’t save the brief — nothing was written. Check your connection and try again.' });
    }
    setBriefSaving(false);
  };
  const generatedOn = config.copy.generatedAt ? formatStamp(config.copy.generatedAt) : null;

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <EventBackground density={26} />
      <div className="relative z-10 p-6 md:p-10 flex flex-col gap-8 max-w-2xl mx-auto">

        {/* Header */}
        <header className="flex items-center justify-between animate-rise-in">
          <div>
            <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40 mb-1">AR Studio</p>
            <h1 className="font-serif italic text-3xl text-foil-static">Branding & Identity</h1>
            <p className="font-sans text-xs text-champagne/45 mt-1">
              Names, onboarding, colours and logo — edits preview live; Save to publish.
            </p>
          </div>
          <Wordmark size="sm" />
        </header>

        {/* Logo */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-1 flex items-center gap-2">
            <ImageIcon className="w-3.5 h-3.5" /> Logo
          </h2>
          <p className="font-sans text-[11px] text-champagne/40 mb-4">
            Upload a transparent PNG/SVG to replace the coded logo everywhere. Leave empty to use the event's built-in lockup.
          </p>
          <div className="flex items-center gap-4">
            <div className="w-28 h-20 rounded-xl glass flex items-center justify-center overflow-hidden shrink-0">
              {draft.logoUrl
                ? <img src={draft.logoUrl} alt="logo" className="max-h-16 max-w-24 object-contain" />
                : <span className="font-label text-[9px] uppercase tracking-luxe text-champagne/30">Coded logo</span>}
            </div>
            <div className="flex flex-col gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogo(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 glass rounded-lg text-[11px] font-label uppercase tracking-luxe text-gold-300 hover:bg-gold-400/15 transition-colors disabled:opacity-50">
                <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading…' : 'Upload logo'}
              </button>
              {draft.logoUrl && (
                <button onClick={() => patch({ logoUrl: null })}
                  className="flex items-center gap-2 px-4 py-2 glass rounded-lg text-[11px] font-label uppercase tracking-luxe text-champagne/50 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Identity copy */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-4 flex items-center gap-2">
            <Type className="w-3.5 h-3.5" /> Names & Copy
          </h2>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="Event name" value={draft.eventName} onChange={(v) => patch({ eventName: v })} />
              <TextField label="Eyebrow (small label)" value={draft.eyebrow} onChange={(v) => patch({ eyebrow: v })} />
            </div>
            <TextField label="Full name" value={draft.fullName} onChange={(v) => patch({ fullName: v })} />
            <TextField label="Tagline" value={draft.tagline} onChange={(v) => patch({ tagline: v })} />
            <TextArea label="Thank-you message" value={draft.thankYou} onChange={(v) => patch({ thankYou: v })} rows={2} />
            {/* Generated guest lines — the values start as the AI's (or the
                built-in) text; clearing a box falls back to it (mergeCopy
                ignores blanks). Only DB events ever carry these keys. */}
            {isDbEvent && (
              <>
                <TextArea
                  label="Welcome intro (guest welcome page)"
                  value={draft.welcomeIntro}
                  onChange={(v) => patch({ welcomeIntro: v })}
                  placeholder={config.copy.welcomeIntro ?? 'Leave blank for the built-in intro'}
                  rows={2}
                />
                <TextArea
                  label="Keepsake email intro"
                  value={draft.keepsakeIntro}
                  onChange={(v) => patch({ keepsakeIntro: v })}
                  placeholder={config.copy.keepsakeIntro ?? 'Leave blank for the built-in intro'}
                  rows={2}
                />
                {generatedOn !== null && (
                  <p className="font-sans text-[11px] text-champagne/40 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-gold-300 shrink-0" />
                    Tagline, thank-you, welcome and keepsake lines written by AI on {generatedOn} — edit any of them above.
                  </p>
                )}
              </>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="Share title" value={draft.shareTitle} onChange={(v) => patch({ shareTitle: v })} />
              <TextField label="Moment title" value={draft.momentTitle} onChange={(v) => patch({ momentTitle: v })} />
            </div>
            <TextArea label="Share text" value={draft.shareText} onChange={(v) => patch({ shareText: v })} rows={2} />
          </div>
        </section>

        {/* Event brief (runtime DB events only) */}
        {isDbEvent && (
          <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
            <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-1 flex items-center gap-2">
              <NotebookPen className="w-3.5 h-3.5" /> Event brief
            </h2>
            <p className="font-sans text-[11px] text-champagne/40 mb-4">
              Who it’s for, the colours, the mood, what to avoid. The AI assistants read this on every turn.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="Occasion" value={briefDraft.occasion} onChange={(v) => patchBrief({ occasion: v })} placeholder="e.g. Maya’s 40th" />
                <TextField label="Honorees (comma-separated)" value={briefDraft.honorees} onChange={(v) => patchBrief({ honorees: v })} placeholder="e.g. Maya, Sam" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="Palette" value={briefDraft.palette} onChange={(v) => patchBrief({ palette: v })} placeholder="e.g. gold and navy" />
                <TextField label="Tone" value={briefDraft.tone} onChange={(v) => patchBrief({ tone: v })} placeholder="e.g. elegant, a little playful" />
              </div>
              <TextField label="Avoid (comma-separated)" value={briefDraft.avoid} onChange={(v) => patchBrief({ avoid: v })} placeholder="e.g. balloons, puns" />
              <TextArea label="Notes" value={briefDraft.notes} onChange={(v) => patchBrief({ notes: v })} rows={2} placeholder="Anything else the assistants should know" />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={saveBrief}
                disabled={briefSaving}
                className="min-h-11 px-5 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl glow-accent flex items-center justify-center gap-2 hover:brightness-110 transition-all disabled:opacity-50"
              >
                {briefSaving ? 'Saving…' : <><Save className="w-4 h-4" /> Save brief</>}
              </button>
              {briefStatus !== null ? (
                <p role="status" className={`font-sans text-[11px] ${briefStatus.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>
                  {briefStatus.text}
                </p>
              ) : briefStamp !== null && formatStamp(briefStamp) !== null ? (
                <p className="font-sans text-[11px] text-champagne/40">Last updated {formatStamp(briefStamp)}</p>
              ) : null}
            </div>
          </section>
        )}

        {/* Theme colors */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-4 flex items-center gap-2">
            <Palette className="w-3.5 h-3.5" /> Theme Colours
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {COLOR_FIELDS.map(({ key, label }) => (
              <ColorField key={key} label={label} value={draft.colors[key]} onChange={(v) => patchColor(key, v)} />
            ))}
          </div>
        </section>

        {/* Background template (runtime DB events only) */}
        {isDbEvent && (
          <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
            <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-1 flex items-center gap-2">
              <Wallpaper className="w-3.5 h-3.5" /> Background
            </h2>
            <p className="font-sans text-[11px] text-champagne/40 mb-4">
              The ambient animated backdrop behind every screen (booth, wall, guest pages).
              It recolors automatically with your theme colours. Applies immediately on click.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.values(BACKGROUND_TEMPLATES).map(({ id, name, component: Preview }) => {
                const selected = id === currentBgId;
                return (
                  <button
                    key={id}
                    onClick={() => selectBackground(id)}
                    disabled={bgSaving !== null}
                    aria-pressed={selected}
                    className={`relative overflow-hidden rounded-xl border text-left transition-all ${
                      selected
                        ? 'border-gold-400/70 glow-accent'
                        : 'border-gold-700/25 hover:border-gold-400/45'
                    } ${bgSaving && bgSaving !== id ? 'opacity-50' : ''}`}
                  >
                    {/* live scaled preview — the real component in a small card */}
                    <div className="relative h-24 bg-noir-900">
                      <Preview density={10} sparkle={0.4} />
                    </div>
                    <div className="absolute bottom-0 inset-x-0 px-2.5 py-1.5 bg-noir-900/70 backdrop-blur-sm flex items-center justify-between">
                      <span className={`font-label uppercase tracking-widest text-[9px] ${selected ? 'text-gold-300' : 'text-champagne/60'}`}>
                        {name}
                      </span>
                      {bgSaving === id
                        ? <RefreshCw className="w-3 h-3 text-gold-300 animate-spin" />
                        : selected && <Check className="w-3 h-3 text-gold-300" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Onboarding steps */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 flex items-center gap-2">
              <ListOrdered className="w-3.5 h-3.5" /> Onboarding Steps
            </h2>
            <button onClick={addStep} className="flex items-center gap-1 font-label uppercase tracking-widest text-[9px] text-gold-300 hover:text-gold-200 transition-colors">
              <Plus className="w-3 h-3" /> Add step
            </button>
          </div>
          <p className="font-sans text-[11px] text-champagne/40 mb-3">
            The first-launch cards guests see in the booth.
          </p>
          <div className="space-y-2">
            {draft.onboardingSteps.map((s, i) => (
              <div key={i} className="rounded-xl border border-gold-700/20 bg-noir-800/40 p-3 flex gap-3">
                <span className="font-serif text-gold-400/70 text-sm pt-1.5 w-4 text-center shrink-0">{i + 1}</span>
                <div className="flex-1 space-y-2 min-w-0">
                  <input value={s.eyebrow} onChange={(e) => patchStep(i, { eyebrow: e.target.value })} placeholder="Eyebrow (e.g. Step One)"
                    className="w-full bg-noir-800/70 border border-gold-700/25 rounded-lg px-3 py-2 font-sans text-sm text-ivory/90 placeholder-champagne/25 outline-none focus:border-gold-400/55 transition-colors" />
                  <input value={s.title} onChange={(e) => patchStep(i, { title: e.target.value })} placeholder="Title"
                    className="w-full bg-noir-800/70 border border-gold-700/25 rounded-lg px-3 py-2 font-sans text-sm text-ivory/90 placeholder-champagne/25 outline-none focus:border-gold-400/55 transition-colors" />
                  <textarea value={s.body} onChange={(e) => patchStep(i, { body: e.target.value })} placeholder="Body" rows={2}
                    className="w-full bg-noir-800/70 border border-gold-700/25 rounded-lg px-3 py-2 font-sans text-sm text-ivory/90 placeholder-champagne/25 outline-none focus:border-gold-400/55 transition-colors resize-none" />
                </div>
                <button onClick={() => removeStep(i)} title="Remove step" className="text-champagne/30 hover:text-red-400 self-start pt-1.5 transition-colors shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Save bar */}
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="flex-1 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl py-3 glow-accent flex items-center justify-center gap-2 hover:brightness-110 transition-all disabled:opacity-50">
            {saved ? <><Check className="w-4 h-4" /> Saved</> : saving ? 'Saving…' : <><Save className="w-4 h-4" /> Save Branding</>}
          </button>
          <button onClick={resetToCoded} title="Reset to coded defaults"
            className="px-4 py-3 glass rounded-xl text-champagne/50 hover:text-gold-300 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}
