/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Event Settings — live wall feature toggles + event info + URL reference card.
 * Writes via db.setWallSettings() and syncs into store.setWallSettings().
 * Subscribes to realtime so two admin tabs stay in sync.
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  QrCode, Trophy, BarChart2, Info, ExternalLink, Copy, Check,
  Wifi, RefreshCw, Sparkles, Globe, User, Rows3, Timer, Gauge,
  Megaphone, Save, Plus, Trash2, Wand2, Lock,
} from 'lucide-react';
import EventBackground from '../ui/EventBackground';
import {
  getWallSettings, setWallSettings as dbSetWallSettings, subscribeToSettings,
  getLandingContent, setLandingContent, defaultLanding,
  getUploadSettings, saveUploadSettings, type UploadSettings,
} from '../../lib/db';
import { buildCatalog } from '../../lib/catalog';
import { sha256Hex } from '../../lib/hash';
import { useStore } from '../../store';
import { useEvent } from '../../events/EventContext';
import { useStudioBase } from './studioBase';
import type { WallSettings, LandingContent } from '../../types';
import { inputCls, TextField, TextArea } from './fields';

/* ------------------------------------------------------------------ */
/* Gala-styled toggle row                                               */
/* ------------------------------------------------------------------ */

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  helper: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  busy?: boolean;
}

function ToggleRow({ icon, label, helper, checked, onChange, busy }: ToggleRowProps) {
  return (
    <div className="flex items-center gap-4 py-4 border-b border-white/5 last:border-0">
      <div className="w-9 h-9 rounded-xl bg-gold-400/10 flex items-center justify-center shrink-0 text-gold-300">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-sans text-sm text-ivory font-medium leading-tight">{label}</p>
        <p className="font-sans text-[11px] text-champagne/45 mt-0.5 leading-relaxed">{helper}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        disabled={busy}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-12 h-6 rounded-full transition-colors duration-200 disabled:opacity-40 ${
          checked ? 'bg-gold-400 glow-accent' : 'bg-noir-700'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-noir-900 shadow-md transition-transform duration-200 ${
            checked ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Slider row                                                            */
/* ------------------------------------------------------------------ */

interface SliderRowProps {
  icon: React.ReactNode;
  label: string;
  helper: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
  busy?: boolean;
}

function SliderRow({ icon, label, helper, value, min, max, step, displayValue, onChange, busy }: SliderRowProps) {
  return (
    <div className="flex items-start gap-4 py-4 border-b border-white/5 last:border-0">
      <div className="w-9 h-9 rounded-xl bg-gold-400/10 flex items-center justify-center shrink-0 text-gold-300 mt-0.5">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <p className="font-sans text-sm text-ivory font-medium leading-tight">{label}</p>
          <span className="font-mono text-[12px] text-gold-300 bg-gold-400/10 px-2 py-0.5 rounded-lg">{displayValue}</span>
        </div>
        <p className="font-sans text-[11px] text-champagne/45 mb-2 leading-relaxed">{helper}</p>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={busy}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40"
          style={{
            background: `linear-gradient(to right, #D4AF37 0%, #D4AF37 ${((value - min) / (max - min)) * 100}%, rgba(var(--accent-rgb),0.15) ${((value - min) / (max - min)) * 100}%, rgba(var(--accent-rgb),0.15) 100%)`,
            accentColor: '#D4AF37',
          }}
        />
        <div className="flex justify-between mt-1">
          <span className="font-label text-[9px] text-champagne/30 uppercase tracking-widest">{min}</span>
          <span className="font-label text-[9px] text-champagne/30 uppercase tracking-widest">{max}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Copy button                                                           */
/* ------------------------------------------------------------------ */

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      className="p-1.5 rounded-lg glass hover:bg-gold-400/15 text-champagne/50 hover:text-gold-300 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* URL row                                                               */
/* ------------------------------------------------------------------ */

function UrlRow({ label, url, icon }: { label: string; url: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      <div className="w-7 h-7 rounded-lg bg-gold-400/10 flex items-center justify-center shrink-0 text-gold-300">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-label uppercase tracking-widest text-[9px] text-champagne/40 mb-0.5">{label}</p>
        <p className="font-mono text-[11px] text-champagne/70 truncate">{url}</p>
      </div>
      <CopyBtn text={url} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1.5 rounded-lg glass hover:bg-gold-400/15 text-champagne/50 hover:text-gold-300 transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Settings                                                         */
/* ------------------------------------------------------------------ */

export default function Settings() {
  const { eventId, config, source, basePath } = useEvent();
  const base = useStudioBase();
  const storeSet = useStore((s) => s.setWallSettings);
  const experiences = useStore((s) => s.experiences);
  const linkedGlobals = useStore((s) => s.linkedGlobals);
  const fetchExperiences = useStore((s) => s.fetchExperiences);
  const presetOverrides = useStore((s) => s.presetOverrides);
  const fetchPresetOverrides = useStore((s) => s.fetchPresetOverrides);
  const copy = useStore((s) => s.copy);

  useEffect(() => { fetchExperiences(true); fetchPresetOverrides(); }, [fetchExperiences, fetchPresetOverrides]);

  // Catalog grouped for the "default booth filter" picker
  const catalog = useMemo(() => buildCatalog(config.arContent, experiences, presetOverrides, linkedGlobals), [config, experiences, presetOverrides, linkedGlobals]);
  const effects = catalog.filter((e) => e.kind === 'shader');
  const frames = catalog.filter((e) => e.kind === 'border' || e.kind === '2d_filter');
  const pieces3d = catalog.filter((e) => e.kind === '3d_attachment');
  const [settings, setSettings] = useState<WallSettings>({
    showQR: true,
    showLeaderboard: true,
    showChallenges: true,
    galleryScroll: true,
    galleryScrollSpeed: 1,
    slideshowInterval: 6,
    featuredSpotlight: true,
    featuredIntervalSec: 45,
    defaultExperienceId: null,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  // ── Landing ("Join the Photo Booth") page content ──
  const [landing, setLanding] = useState<LandingContent>(() => defaultLanding(config.copy));
  const [landingSaving, setLandingSaving] = useState(false);
  const [landingSaved, setLandingSaved] = useState(false);

  useEffect(() => {
    getLandingContent(eventId, config.copy).then(setLanding).catch(() => {});
  }, [eventId, config]);

  const patchLanding = (patch: Partial<LandingContent>) => {
    setLanding((l) => ({ ...l, ...patch }));
    setLandingSaved(false);
  };
  const patchStep = (i: number, patch: Partial<LandingContent['steps'][number]>) => {
    setLanding((l) => ({ ...l, steps: l.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
    setLandingSaved(false);
  };
  const addStep = () => { setLanding((l) => ({ ...l, steps: [...l.steps, { title: 'New step', body: '' }] })); setLandingSaved(false); };
  const removeStep = (i: number) => { setLanding((l) => ({ ...l, steps: l.steps.filter((_, idx) => idx !== i) })); setLandingSaved(false); };
  const saveLanding = async () => {
    setLandingSaving(true);
    await setLandingContent(eventId, landing);
    setLandingSaving(false);
    setLandingSaved(true);
    setTimeout(() => setLandingSaved(false), 2500);
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // ── Public upload passcode (runtime DB events only) ──
  const isDbEvent = source === 'db';
  const [uploadCfg, setUploadCfg] = useState<UploadSettings | null>(null);
  const [uploadCfgLoaded, setUploadCfgLoaded] = useState(false);
  const [uploadCode, setUploadCode] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadSaved, setUploadSaved] = useState(false);
  const uploadsOpen = Boolean(uploadCfg?.passcodeHash);

  useEffect(() => {
    if (!isDbEvent) return;
    let alive = true;
    getUploadSettings(eventId).then((v) => {
      if (!alive) return;
      setUploadCfg(v);
      setUploadCfgLoaded(true);
    });
    return () => { alive = false; };
  }, [isDbEvent, eventId]);

  const saveUploadPasscode = async () => {
    const v = uploadCode.trim();
    if (!v) return;
    setUploadBusy(true);
    // Raw passcode is never stored — only its sha256 hash.
    const value: UploadSettings = { passcodeHash: await sha256Hex(v) };
    await saveUploadSettings(eventId, value);
    setUploadCfg(value);
    setUploadCode('');
    setUploadBusy(false);
    setUploadSaved(true);
    setTimeout(() => setUploadSaved(false), 2500);
  };

  const closeUploads = async () => {
    setUploadBusy(true);
    await saveUploadSettings(eventId, { passcodeHash: null });
    setUploadCfg({ passcodeHash: null });
    setUploadBusy(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const s = await getWallSettings(eventId);
    setSettings(s);
    storeSet(s);
    setLoading(false);
  }, [eventId, storeSet]);

  useEffect(() => {
    load();
    const unsub = subscribeToSettings(eventId, (s) => {
      setConnected(true);
      setSettings(s);
      storeSet(s);
    });
    unsubRef.current = unsub;
    const tid = setTimeout(() => setConnected(true), 1200);
    return () => {
      clearTimeout(tid);
      unsub();
    };
  }, [eventId, load, storeSet]);

  const toggle = async (key: keyof WallSettings, value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);          // optimistic
    storeSet(next);
    setBusy(true);
    const saved = await dbSetWallSettings(eventId, { [key]: value });
    setSettings(saved);
    storeSet(saved);
    setBusy(false);
  };

  const setNumeric = async (key: keyof WallSettings, value: number) => {
    const next = { ...settings, [key]: value };
    setSettings(next);          // optimistic
    storeSet(next);
    setBusy(true);
    const saved = await dbSetWallSettings(eventId, { [key]: value });
    setSettings(saved);
    storeSet(saved);
    setBusy(false);
  };

  const setDefaultExp = async (value: string | null) => {
    const next = { ...settings, defaultExperienceId: value };
    setSettings(next);          // optimistic
    storeSet(next);
    setBusy(true);
    const saved = await dbSetWallSettings(eventId, { defaultExperienceId: value });
    setSettings(saved);
    storeSet(saved);
    setBusy(false);
  };

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <EventBackground density={28} />
      <div className="relative z-10 p-6 md:p-10 flex flex-col gap-8 max-w-2xl mx-auto">

        {/* Header */}
        <header className="flex items-center justify-between animate-rise-in">
          <div>
            <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40 mb-1">AR Studio</p>
            <h1 className="font-serif italic text-3xl text-foil-static">Event Settings</h1>
            <p className="font-sans text-xs text-champagne/45 mt-1">
              Live wall feature controls — changes apply immediately.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-label uppercase tracking-widest ${connected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-champagne/10 text-champagne/30'}`}>
              <Wifi className={`w-3 h-3 ${connected ? 'animate-pulse' : ''}`} />
              {connected ? 'Live' : 'Connecting…'}
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="p-2 glass rounded-xl text-champagne/40 hover:text-gold-300 transition-colors disabled:opacity-30"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {/* Wall feature toggles */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-1">Wall Features</h2>
          <p className="font-sans text-[11px] text-champagne/40 mb-4">
            These gates control what appears on the projected live wall in real-time.
          </p>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 glass rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div>
              <ToggleRow
                icon={<QrCode className="w-4 h-4" />}
                label="Show QR Code"
                helper="Displays the 'Scan to get your photos' QR on the wall so guests can visit /me."
                checked={settings.showQR}
                onChange={(v) => toggle('showQR', v)}
                busy={busy}
              />
              <ToggleRow
                icon={<BarChart2 className="w-4 h-4" />}
                label="Show Leaderboard"
                helper="Shows the points leaderboard on the wall — great for engagement during dinner."
                checked={settings.showLeaderboard}
                onChange={(v) => toggle('showLeaderboard', v)}
                busy={busy}
              />
              <ToggleRow
                icon={<Trophy className="w-4 h-4" />}
                label="Challenges Mode"
                helper="Master switch — shows the Challenges button in the booth and the challenges ticker on the wall. Turn OFF to disable challenges entirely."
                checked={settings.showChallenges}
                onChange={(v) => toggle('showChallenges', v)}
                busy={busy}
              />
            </div>
          )}
        </section>

        {/* Gallery & Slideshow settings */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-1">Gallery &amp; Slideshow</h2>
          <p className="font-sans text-[11px] text-champagne/40 mb-4">
            Control how photos appear in Gallery mode and how fast the slideshow advances.
          </p>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 glass rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div>
              <ToggleRow
                icon={<Rows3 className="w-4 h-4" />}
                label="Scrolling Rows (Marquee)"
                helper="ON = animated scrolling rows (marquee). OFF = static masonry grid. Changes take effect immediately on the wall."
                checked={settings.galleryScroll}
                onChange={(v) => toggle('galleryScroll', v)}
                busy={busy}
              />
              <SliderRow
                icon={<Gauge className="w-4 h-4" />}
                label="Scroll Speed"
                helper="Speed multiplier for the marquee rows. 1× is the default comfortable pace."
                value={settings.galleryScrollSpeed ?? 1}
                min={0.25}
                max={3}
                step={0.25}
                displayValue={`${(settings.galleryScrollSpeed ?? 1).toFixed(2)}×`}
                onChange={(v) => setNumeric('galleryScrollSpeed', v)}
                busy={busy}
              />
              <SliderRow
                icon={<Timer className="w-4 h-4" />}
                label="Slideshow Interval"
                helper="How many seconds each photo is shown before the slideshow advances."
                value={settings.slideshowInterval ?? 6}
                min={3}
                max={15}
                step={1}
                displayValue={`${settings.slideshowInterval ?? 6}s`}
                onChange={(v) => setNumeric('slideshowInterval', v)}
                busy={busy}
              />
              <ToggleRow
                icon={<Sparkles className="w-4 h-4" />}
                label="Featured Spotlight"
                helper="Every so often, Gallery mode spotlights one photo (or a join-QR, leaderboard or challenge card) full-screen for a few seconds."
                checked={settings.featuredSpotlight}
                onChange={(v) => toggle('featuredSpotlight', v)}
                busy={busy}
              />
              <SliderRow
                icon={<Timer className="w-4 h-4" />}
                label="Spotlight every"
                helper="Seconds between Featured Spotlight appearances — each spotlight shows for about 8 seconds."
                value={settings.featuredIntervalSec ?? 45}
                min={15}
                max={120}
                step={5}
                displayValue={`${settings.featuredIntervalSec ?? 45}s`}
                onChange={(v) => setNumeric('featuredIntervalSec', v)}
                busy={busy}
              />
            </div>
          )}
        </section>

        {/* Booth default filter */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-1 flex items-center gap-2">
            <Wand2 className="w-3.5 h-3.5" /> Booth Default Filter
          </h2>
          <p className="font-sans text-[11px] text-champagne/40 mb-4">
            Auto-select an effect, frame or 3D piece the moment the booth opens. Guests can still change or clear it.
          </p>
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-gold-400/10 flex items-center justify-center shrink-0 text-gold-300">
              <Sparkles className="w-4 h-4" />
            </div>
            <select
              value={settings.defaultExperienceId ?? ''}
              onChange={(e) => setDefaultExp(e.target.value || null)}
              disabled={busy}
              className="flex-1 bg-noir-800/80 border border-gold-700/30 rounded-lg px-3 py-2.5 font-sans text-sm text-ivory/90 outline-none focus:border-gold-400/55 transition-colors disabled:opacity-50"
            >
              <option value="">None — start clean</option>
              {effects.length > 0 && (
                <optgroup label="Effects">
                  {effects.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </optgroup>
              )}
              {frames.length > 0 && (
                <optgroup label="Frames">
                  {frames.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </optgroup>
              )}
              {pieces3d.length > 0 && (
                <optgroup label="3D Pieces">
                  {pieces3d.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </optgroup>
              )}
            </select>
          </div>
        </section>

        {/* Join / Landing page editor */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 flex items-center gap-2">
              <Megaphone className="w-3.5 h-3.5" /> Join Page
            </h2>
            <a href={`${basePath}/join`} target="_blank" rel="noopener noreferrer" className="font-label text-[9px] uppercase tracking-widest text-champagne/40 hover:text-gold-300 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Preview
            </a>
          </div>
          <p className="font-sans text-[11px] text-champagne/40 mb-4">
            Customize the public "Join the Photo Booth" page (the big QR poster at <span className="font-mono text-gold-300/80 text-[11px]">/join</span>). All text and steps are editable; changes go live when you save.
          </p>

          <div className="space-y-3">
            <TextField label="Eyebrow" value={landing.eyebrow} onChange={(v) => patchLanding({ eyebrow: v })} />
            <TextField label="Title" value={landing.title} onChange={(v) => patchLanding({ title: v })} />
            <TextField label="Subtitle" value={landing.subtitle} onChange={(v) => patchLanding({ subtitle: v })} />
            <TextArea label="Intro blurb" value={landing.intro} onChange={(v) => patchLanding({ intro: v })} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="Button label" value={landing.ctaLabel} onChange={(v) => patchLanding({ ctaLabel: v })} />
              <TextField label="QR URL (blank = this site)" value={landing.url} onChange={(v) => patchLanding({ url: v })} placeholder={origin} />
            </div>
            <TextField label="Footer" value={landing.footer} onChange={(v) => patchLanding({ footer: v })} />

            {/* Steps editor */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-2">
                <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/50">How-it-works steps</span>
                <button onClick={addStep} className="flex items-center gap-1 font-label uppercase tracking-widest text-[9px] text-gold-300 hover:text-gold-200 transition-colors">
                  <Plus className="w-3 h-3" /> Add step
                </button>
              </div>
              <div className="space-y-2">
                {landing.steps.map((s, i) => (
                  <div key={i} className="rounded-xl border border-gold-700/20 bg-noir-800/40 p-3 flex gap-3">
                    <span className="font-serif text-gold-400/70 text-sm pt-1.5 w-4 text-center shrink-0">{i + 1}</span>
                    <div className="flex-1 space-y-2 min-w-0">
                      <input value={s.title} onChange={(e) => patchStep(i, { title: e.target.value })} placeholder="Step title" className={inputCls} />
                      <textarea value={s.body} onChange={(e) => patchStep(i, { body: e.target.value })} placeholder="Step description" rows={2} className={`${inputCls} resize-none`} />
                    </div>
                    <button onClick={() => removeStep(i)} title="Remove step" className="text-champagne/30 hover:text-red-400 self-start pt-1.5 transition-colors shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={saveLanding}
              disabled={landingSaving}
              className="w-full bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl py-3 glow-accent flex items-center justify-center gap-2 hover:brightness-110 transition-all disabled:opacity-50"
            >
              {landingSaved ? <><Check className="w-4 h-4" /> Saved</> : landingSaving ? 'Saving…' : <><Save className="w-4 h-4" /> Save Join Page</>}
            </button>
          </div>
        </section>

        {/* How "Scan to get your photos" works — explainer */}
        <section className="glass rounded-2xl border border-gold-400/15 p-6 animate-rise-in">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-gold-300 shrink-0" />
            <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300">
              How "Scan to get your photos" works
            </h2>
          </div>
          <div className="space-y-3 font-sans text-[12px] text-champagne/65 leading-relaxed">
            <p>
              The QR code on the live wall points guests to <span className="font-mono text-gold-300/80 text-[11px]">/me</span> on their phone.
              When they visit, the page shows all photos captured on <strong className="text-ivory/70">that specific device</strong> during the event.
            </p>
            <p>
              Photos are remembered two ways: (1) stored locally in the browser so guests can re-download from the same phone without a login, and (2) linked to an anonymous <em>session ID</em> so re-visiting the page later still shows their shots — even after closing the tab.
            </p>
            <p>
              <strong className="text-ivory/70">No login required.</strong> Guests never create an account. If they switch devices they can still browse the full wall at <span className="font-mono text-gold-300/80 text-[11px]">/wall</span> and save from there.
            </p>
          </div>
        </section>

        {/* Event info */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-4">Event Info</h2>
          <div className="space-y-2 font-sans text-sm text-champagne/70">
            <div className="flex items-center gap-3">
              <Sparkles className="w-4 h-4 text-gold-400 shrink-0" />
              <span><strong className="text-ivory">{copy.fullName}</strong></span>
            </div>
            <div className="flex items-center gap-3">
              <Megaphone className="w-4 h-4 text-gold-400 shrink-0" />
              <span>{copy.eyebrow}</span>
            </div>
            <p className="font-sans text-[11px] text-champagne/40 pt-1">
              Edit the event name, onboarding and theme on the{' '}
              <a href={`${base}/branding`} className="text-gold-300 hover:text-gold-200 underline">Branding</a> page.
            </p>
          </div>
        </section>

        {/* Public upload passcode — runtime DB events only */}
        {isDbEvent && (
          <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
            <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-1 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5" /> Public Upload Passcode
            </h2>
            <p className="font-sans text-[11px] text-champagne/40 mb-4">
              Controls the public <span className="font-mono text-gold-300/80 text-[11px]">{basePath}/upload</span> page.
              Set a passcode to open uploads to guests with the code; close them to keep the doors shut.
            </p>
            {!uploadCfgLoaded ? (
              <div className="h-14 glass rounded-xl animate-pulse" />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1.5 rounded-full text-[9px] font-label uppercase tracking-widest ${
                      uploadsOpen ? 'bg-emerald-500/15 text-emerald-400' : 'bg-champagne/10 text-champagne/40'
                    }`}
                  >
                    {uploadsOpen ? 'Open with passcode' : 'Closed'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={uploadCode}
                    onChange={(e) => setUploadCode(e.target.value)}
                    placeholder={uploadsOpen ? 'New passcode…' : 'Set a passcode to open uploads…'}
                    className={`flex-1 ${inputCls}`}
                  />
                  <button
                    onClick={saveUploadPasscode}
                    disabled={uploadBusy || !uploadCode.trim()}
                    className="px-4 py-2 bg-foil text-noir-900 font-label uppercase tracking-widest text-[10px] font-bold rounded-xl glow-accent transition-all disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {uploadSaved ? <><Check className="w-3.5 h-3.5" /> Saved</> : <><Save className="w-3.5 h-3.5" /> Save</>}
                  </button>
                </div>
                {uploadsOpen && (
                  <button
                    onClick={closeUploads}
                    disabled={uploadBusy}
                    className="text-[10px] font-label uppercase tracking-widest text-champagne/40 hover:text-red-400 transition-colors disabled:opacity-40"
                  >
                    Close uploads
                  </button>
                )}
                <p className="font-sans text-[10px] text-champagne/30">
                  The passcode is stored as a hash and shown to no one — share it with guests yourself.
                </p>
              </div>
            )}
          </section>
        )}

        {/* URLs reference */}
        <section className="glass rounded-2xl border border-gold-400/15 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-4">Event URLs</h2>
          <div>
            <UrlRow label="Join Page (QR poster)" url={`${origin}${basePath}/join`} icon={<Megaphone className="w-3.5 h-3.5" />} />
            <UrlRow label="AR Photo Booth" url={`${origin}${basePath}/`} icon={<Sparkles className="w-3.5 h-3.5" />} />
            <UrlRow label="Live Wall" url={`${origin}${basePath}/wall`} icon={<Globe className="w-3.5 h-3.5" />} />
            <UrlRow label="My Media (guest)" url={`${origin}${basePath}/me`} icon={<User className="w-3.5 h-3.5" />} />
            <UrlRow label="Admin Studio" url={`${origin}${base}`} icon={<QrCode className="w-3.5 h-3.5" />} />
          </div>
        </section>

        <div className="h-6" />
      </div>
    </div>
  );
}
