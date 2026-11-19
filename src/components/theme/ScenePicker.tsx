/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Event page look" — the host picks how the guest welcome page and the
 * booth's splash + intro are dressed: a template, a gradient, one colour,
 * their own photo, or one of the event's frames. Stored in
 * events.config.scene (lib/sceneThemes, no migration) through the same
 * read-merge-write every other config edit uses; "Reset to default" writes
 * null, which normalizeScene reads as absent (today's background).
 *
 * Platform events only (Branding renders it behind its db gate). Every
 * thumbnail and the live preview are the real SceneBackdrop, so what the
 * host sees here is what guests get.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, ImagePlus, LayoutTemplate, Palette, Pipette, RefreshCw, RotateCcw, Save, Frame as FrameIcon } from 'lucide-react';
import SceneBackdrop from './SceneBackdrop';
import { Emblem } from '../ui/EventLogo';
import { ToastProvider, useToast } from '../ui/Toast';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';
import { uploadAsset } from '../../lib/db';
import { updateEventConfig } from '../../lib/host';
import {
  DEFAULT_PALETTE_ID,
  isHex,
  paletteCss,
  resolveScene,
  normalizePageBorder,
  resolveSceneImageUrl,
  SCENE_PAGE_BORDER_META,
  SCENE_PAGE_BORDERS,
  SCENE_PALETTES,
  SCENE_TEMPLATES,
  type EventScene,
  type ScenePageBorder,
  type ScenePalette,
} from '../../lib/sceneThemes';
import {
  draftTone,
  sceneEquals,
  sceneFrameChoices,
  sceneSummary,
  sceneToSave,
  sceneUploadError,
  SCENE_UPLOAD_TYPES,
  withPageBorder,
  type SceneKind,
} from '../../lib/scenePage';
import PageBorder from './PageBorder';

const TABS: Array<{ kind: SceneKind; label: string; icon: typeof Palette }> = [
  { kind: 'template', label: 'Templates', icon: LayoutTemplate },
  { kind: 'gradient', label: 'Gradient', icon: Palette },
  { kind: 'color', label: 'Colour', icon: Pipette },
  { kind: 'image', label: 'Photo', icon: ImagePlus },
  { kind: 'frame', label: 'Frame', icon: FrameIcon },
];

/** A handful of colours that work as a page; any other is one click away. */
const COLOUR_SUGGESTIONS = ['#1A1740', '#2B2A8C', '#0F3B3A', '#4A1F3A', '#F4F1EA', '#E9E8FF', '#F6E3DC', '#DDE9DF'];

/** The first value a tab shows when the host switches to it. */
function starterFor(kind: SceneKind, frames: ReturnType<typeof sceneFrameChoices>): EventScene | undefined {
  switch (kind) {
    case 'template': return { kind: 'template', id: SCENE_TEMPLATES[0].id };
    case 'gradient': return { kind: 'gradient', paletteId: DEFAULT_PALETTE_ID };
    case 'color': return { kind: 'color', color: '#1A1740' };
    case 'image': return undefined; // nothing until a photo is uploaded
    case 'frame': return frames[0] ? { kind: 'frame', url: frames[0].url, paletteId: 'midnight' } : undefined;
  }
}

export default function ScenePicker() {
  // Own toast stack: Branding is also reachable from the guest-side admin
  // routes, which have no ToastProvider of their own.
  return (
    <ToastProvider>
      <ScenePickerBody />
    </ToastProvider>
  );
}

function ScenePickerBody() {
  const { eventId, eventUuid, config, refreshConfig } = useEvent();
  const toast = useToast();
  const experiences = useStore((s) => s.experiences);
  const linkedGlobals = useStore((s) => s.linkedGlobals);
  const experiencesLoaded = useStore((s) => s.experiencesLoaded);
  const fetchExperiences = useStore((s) => s.fetchExperiences);
  useEffect(() => {
    if (!experiencesLoaded) void fetchExperiences();
  }, [experiencesLoaded, fetchExperiences]);
  const frames = useMemo(() => sceneFrameChoices([...experiences, ...linkedGlobals]), [experiences, linkedGlobals]);

  const saved = config.scene;
  const [draft, setDraft] = useState<EventScene | undefined>(saved);
  const [tab, setTab] = useState<SceneKind>(saved?.kind ?? 'template');
  // Re-seed when the stored look changes underneath us (our own save's
  // refresh, or another tab).
  const savedKey = JSON.stringify(saved ?? null);
  useEffect(() => {
    setDraft(saved);
    if (saved) setTab(saved.kind);
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // What each tab last held, so flicking between tabs never loses a pick.
  const memory = useRef<Partial<Record<SceneKind, EventScene>>>(saved ? { [saved.kind]: saved } : {});
  // The page border is one setting across every kind of look: switching
  // tabs or picking a new look keeps it.
  const borderRef = useRef<ScenePageBorder>(normalizePageBorder(saved?.border));
  useEffect(() => { borderRef.current = normalizePageBorder(saved?.border); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (next: EventScene | undefined) => {
    const withB = next ? withPageBorder(next, borderRef.current) : next;
    if (withB) memory.current[withB.kind] = withB;
    setDraft(withB);
    setError(null);
  };
  const chooseBorder = (b: ScenePageBorder) => {
    borderRef.current = b;
    const next = withPageBorder(draft, b);
    if (next) {
      memory.current[next.kind] = next;
      if (next.kind !== tab) setTab(next.kind);
    }
    setDraft(next);
    setError(null);
  };
  const border = normalizePageBorder(draft?.border);
  const openTab = (kind: SceneKind) => {
    setTab(kind);
    pick(memory.current[kind] ?? starterFor(kind, frames));
  };

  const [busy, setBusy] = useState<'save' | 'reset' | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = !sceneEquals(draft, saved);
  const toSave = sceneToSave(draft);

  const save = async () => {
    if (!eventUuid || busy !== null || !toSave) return;
    setBusy('save');
    setError(null);
    const ok = await updateEventConfig(eventUuid, { scene: toSave });
    if (ok) {
      await refreshConfig();
      toast.push('Event page look saved. Guests see it the next time the page opens.', 'success');
    } else {
      const msg = 'Couldn’t save the look. Nothing was changed. Check your connection and try again.';
      setError(msg);
      toast.push(msg, 'error');
    }
    setBusy(null);
  };

  const reset = async () => {
    if (!eventUuid || busy !== null) return;
    setBusy('reset');
    setError(null);
    // null normalizes to "no scene" (sceneThemes.normalizeScene), the default.
    const ok = await updateEventConfig(eventUuid, { scene: null });
    if (ok) {
      memory.current = {};
      borderRef.current = 'none';
      setDraft(undefined);
      await refreshConfig();
      toast.push('Back to the default look.', 'success');
    } else {
      const msg = 'Couldn’t reset the look. Nothing was changed. Try again.';
      setError(msg);
      toast.push(msg, 'error');
    }
    setBusy(null);
  };

  const upload = async (file: File) => {
    const why = sceneUploadError(file);
    if (why !== null) { setError(why); return; }
    setBusy('upload');
    setError(null);
    const url = await uploadAsset(eventId, file, 'page-background');
    setBusy(null);
    const safe = url ? resolveSceneImageUrl(url) : undefined;
    if (!safe) {
      setError('That photo didn’t upload. Check your connection and try again.');
      return;
    }
    const prev = memory.current.image;
    pick({ kind: 'image', url: safe, dim: prev?.kind === 'image' ? prev.dim : 0.35, tone: prev?.kind === 'image' ? prev.tone : 'dark' });
  };

  const image = draft?.kind === 'image' ? draft : undefined;
  const frame = draft?.kind === 'frame' ? draft : undefined;
  const colour = draft?.kind === 'color' ? draft.color : '#1A1740';
  const [hexText, setHexText] = useState(colour);
  useEffect(() => { setHexText(colour); }, [colour]);

  return (
    <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in" aria-labelledby="scene-picker-title">
      <h2 id="scene-picker-title" className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-1 flex items-center gap-2">
        <LayoutTemplate className="w-3.5 h-3.5" /> Event page look
      </h2>
      <p className="font-sans text-[12px] text-champagne/60 mb-4">
        The backdrop of your guest welcome page and the booth’s first screen. Now showing: {sceneSummary(saved)}.
      </p>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0">
          {/* Kind tabs */}
          <div role="tablist" aria-label="Kind of look" className="flex flex-wrap gap-1.5">
            {TABS.map((t) => {
              const on = tab === t.kind;
              return (
                <button
                  key={t.kind}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => openTab(t.kind)}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 font-sans text-[13px] transition-colors ${
                    on ? 'is-selected text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.06]'
                  }`}
                >
                  <t.icon className="h-4 w-4" aria-hidden />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4" role="tabpanel">
            {tab === 'template' && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
                {SCENE_TEMPLATES.map((t) => {
                  const on = draft?.kind === 'template' && draft.id === t.id;
                  const resolved = resolveScene({ kind: 'template', id: t.id });
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick({ kind: 'template', id: t.id })}
                      className={`group overflow-hidden rounded-xl text-left transition ${on ? 'is-selected' : 'ring-1 ring-white/10 hover:ring-white/30'}`}
                    >
                      <div className="relative aspect-[4/3]" data-scene-ui={resolved.tone}>
                        <SceneBackdrop scene={resolved} compact />
                        <span className="sc-display absolute bottom-2 left-2.5 text-[15px] font-semibold sc-ink">Aa</span>
                        {on && (
                          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#1A1740]">
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </span>
                        )}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="font-sans text-[13px] font-medium text-brand-fg">{t.name}</p>
                        <p className="font-sans text-[12px] leading-snug text-brand-muted/70">{t.blurb}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {tab === 'gradient' && (
              <div className="flex flex-col gap-4">
                {(['dark', 'light'] as const).map((tone) => (
                  <div key={tone}>
                    <p className="mb-2 font-sans text-[12px] text-brand-muted/70">{tone === 'dark' ? 'Dark, light text' : 'Light, dark text'}</p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 md:grid-cols-3 lg:grid-cols-6">
                      {SCENE_PALETTES.filter((p) => p.tone === tone).map((p) => (
                        <Swatch
                          key={p.id}
                          palette={p}
                          on={draft?.kind === 'gradient' && draft.paletteId === p.id}
                          onPick={() => pick({ kind: 'gradient', paletteId: p.id })}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'color' && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-white/20" style={{ background: colour }}>
                    <span className="sr-only">Pick a colour</span>
                    <input
                      type="color"
                      value={colour}
                      onChange={(e) => pick({ kind: 'color', color: e.target.value.toUpperCase() })}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="mb-1 font-sans text-[12px] text-brand-muted/70">Hex</span>
                    <input
                      value={hexText}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setHexText(v);
                        const hex = v.startsWith('#') ? v : `#${v}`;
                        if (isHex(hex)) pick({ kind: 'color', color: hex.toUpperCase() });
                      }}
                      maxLength={7}
                      spellCheck={false}
                      className="min-h-11 w-32 rounded-xl bg-black/30 px-3 font-mono text-[13px] text-brand-fg outline-none ring-1 ring-white/15 focus:ring-white/40"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested colours">
                  {COLOUR_SUGGESTIONS.map((c) => {
                    const on = draft?.kind === 'color' && draft.color.toUpperCase() === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Use ${c}`}
                        aria-pressed={on}
                        onClick={() => pick({ kind: 'color', color: c })}
                        className={`h-11 w-11 rounded-full ring-1 ring-white/20 ${on ? 'is-selected' : ''}`}
                        style={{ background: c }}
                      />
                    );
                  })}
                </div>
                <p className="font-sans text-[12px] text-brand-muted/70">Text turns dark on light colours automatically.</p>
              </div>
            )}

            {tab === 'image' && (
              <div className="flex flex-col gap-4">
                <input
                  ref={fileRef}
                  type="file"
                  accept={SCENE_UPLOAD_TYPES.join(',')}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void upload(f);
                  }}
                />
                <div className="flex flex-wrap items-center gap-3">
                  {image && (
                    <img src={image.url} alt="Your page photo" className="h-16 w-24 rounded-lg object-cover ring-1 ring-white/15" />
                  )}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy !== null}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl glass px-4 font-sans text-[13px] text-brand-fg disabled:opacity-50"
                  >
                    {busy === 'upload' ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
                    {busy === 'upload' ? 'Uploading…' : image ? 'Replace photo' : 'Upload a photo'}
                  </button>
                  <p className="font-sans text-[12px] text-brand-muted/70">JPG, PNG, WebP or AVIF, up to 10 MB.</p>
                </div>
                {image && (
                  <>
                    <label className="block">
                      <span className="mb-1 flex justify-between font-sans text-[12px] text-brand-muted/80">
                        <span>Soften the photo so text stays readable</span>
                        <span className="tabular-nums">{Math.round(image.dim * 100)}%</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={0.8}
                        step={0.05}
                        value={image.dim}
                        onChange={(e) => pick({ ...image, dim: Number(e.target.value) })}
                        className="w-full accent-[color:var(--color-accent)]"
                      />
                    </label>
                    <div role="group" aria-label="Text colour" className="flex flex-wrap gap-2">
                      {(['dark', 'light'] as const).map((tone) => (
                        <button
                          key={tone}
                          type="button"
                          aria-pressed={image.tone === tone}
                          onClick={() => pick({ ...image, tone })}
                          className={`inline-flex min-h-11 items-center rounded-full px-4 font-sans text-[13px] ${
                            image.tone === tone ? 'is-selected text-brand-fg' : 'ring-1 ring-white/15 text-brand-muted/80 hover:text-brand-fg'
                          }`}
                        >
                          {tone === 'dark' ? 'Dark photo, light text' : 'Light photo, dark text'}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'frame' && (
              frames.length === 0 ? (
                <p className="rounded-xl p-4 font-sans text-[13px] text-brand-muted/80 ring-1 ring-white/10">
                  No uploaded or AI-made frames in this event yet. Frames you add in the studio show up here. The built-in frames are drawn live in the booth, so they can’t be used as a page backdrop.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4">
                    {frames.map((f) => {
                      const on = frame?.url === f.url;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          aria-pressed={on}
                          aria-label={f.name}
                          onClick={() => pick({ kind: 'frame', url: f.url, paletteId: frame?.paletteId ?? 'midnight' })}
                          className={`overflow-hidden rounded-xl bg-black/30 p-1.5 ${on ? 'is-selected' : 'ring-1 ring-white/10 hover:ring-white/30'}`}
                        >
                          <img src={f.url} alt="" loading="lazy" className="aspect-[9/16] w-full object-contain" />
                        </button>
                      );
                    })}
                  </div>
                  {frame && (
                    <div>
                      <p className="mb-2 font-sans text-[12px] text-brand-muted/70">Behind the frame</p>
                      <div className="grid grid-cols-5 gap-2">
                        {SCENE_PALETTES.map((p) => (
                          <Swatch key={p.id} palette={p} compact on={frame.paletteId === p.id} onPick={() => pick({ ...frame, paletteId: p.id })} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </div>

          {/* One setting across every kind of look. */}
          <fieldset className="mt-6">
            <legend className="mb-2 font-sans text-[13px] font-semibold text-brand-fg">Page border</legend>
            <div className="flex flex-wrap gap-2">
              {SCENE_PAGE_BORDERS.map((b) => {
                const on = border === b;
                const meta = SCENE_PAGE_BORDER_META[b];
                return (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={on}
                    title={meta.blurb}
                    onClick={() => chooseBorder(b)}
                    className={`min-h-11 whitespace-nowrap rounded-xl px-3.5 py-2 text-left font-sans text-[13px] transition ${
                      on ? 'is-selected text-brand-fg' : 'text-brand-muted/80 ring-1 ring-white/15 hover:text-brand-fg hover:ring-white/30'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      {on && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 font-sans text-[12px] text-brand-muted/70">{SCENE_PAGE_BORDER_META[border].blurb}</p>
          </fieldset>
        </div>

        {/* Live preview of the guest welcome page (phone). */}
        <div className="md:sticky md:top-4 md:self-start">
          <p className="mb-2 font-sans text-[12px] text-brand-muted/70">Guest page preview</p>
          <ScenePreview scene={draft} name={config.copy.fullName} />
        </div>
      </div>

      {error !== null && <p role="alert" className="mt-4 font-sans text-[12px] text-red-300">{error}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || !toSave || busy !== null}
          className="min-h-11 px-5 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl glow-accent flex items-center justify-center gap-2 hover:brightness-110 transition-all disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : <><Save className="w-4 h-4" /> Save look</>}
        </button>
        {saved !== undefined && (
          <button
            type="button"
            onClick={reset}
            disabled={busy !== null}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-sans text-[13px] text-brand-muted/80 ring-1 ring-white/15 hover:text-brand-fg disabled:opacity-50"
          >
            {busy === 'reset' ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
            Reset to default
          </button>
        )}
        {dirty && toSave === null && draft === undefined && tab === 'image' && (
          <p className="font-sans text-[12px] text-brand-muted/70">Upload a photo to use it.</p>
        )}
      </div>
    </section>
  );
}

function Swatch({ palette, on, onPick, compact = false }: { palette: ScenePalette; on: boolean; onPick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${palette.name} gradient`}
      onClick={onPick}
      className={`flex flex-col items-center gap-1.5 rounded-xl p-1.5 ${on ? 'is-selected' : 'hover:bg-white/[0.05]'}`}
    >
      <span className={`block w-full rounded-lg ring-1 ring-white/15 ${compact ? 'h-9' : 'h-12'}`} style={{ background: paletteCss(palette) }} />
      {!compact && <span className="font-sans text-[12px] text-brand-fg/90">{palette.name}</span>}
    </button>
  );
}

/** A phone-sized copy of the welcome page's hero on the drafted scene. */
function ScenePreview({ scene, name }: { scene: EventScene | undefined; name: string }) {
  const resolved = resolveScene(scene);
  const tone = draftTone(scene);
  const vars = { '--sc-accent': resolved.accent } as CSSProperties;
  return (
    <div
      data-scene-ui={tone}
      style={vars}
      className="relative mx-auto aspect-[9/16] w-full max-w-[200px] overflow-hidden rounded-[22px] ring-1 ring-white/20 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)]"
    >
      <SceneBackdrop scene={resolved} compact />
      {scene?.border && <PageBorder border={scene.border} contained />}
      <div className="relative flex h-full flex-col px-3.5 pb-3.5 pt-4">
        <div className="flex items-center gap-1.5">
          <Emblem size={16} />
          <span className="truncate font-sans text-[12px] sc-muted">{name}</span>
        </div>
        <div className="mt-auto">
          <p className="font-sans text-[12px] sc-faint">Welcome to</p>
          <p className="sc-display mt-0.5 line-clamp-2 text-[22px] font-semibold leading-[1.02] sc-ink">{name}</p>
          <div className="sc-cta mt-3 flex min-h-9 items-center justify-center rounded-full font-sans text-[12px] font-semibold">
            Step into the booth
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => <div key={i} className="sc-glass aspect-[3/4] rounded-lg" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
