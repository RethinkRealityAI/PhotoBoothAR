/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WallDesignPanel — the host's editor for the live wall's look: layout (with
 * grid size and tile transition), backdrop (event theme, a palette, a solid
 * colour or their own image), light/dark, beside a LIVE miniature of the wall.
 *
 * Stored as WallSettings.wallLook in the existing app_settings 'wall' row
 * (lib/sceneThemes is the contract — no migration). Rules this keeps:
 *   - NEVER WRITE ON A FAILED READ: if the settings row cannot be read, Save
 *     stays off — merging into defaults would overwrite the real wall.
 *   - Saves are `strict`, so a write that did not land is reported, not
 *     quietly shown as saved.
 *   - Uploads are checked (image type, 10 MB) before they leave the device,
 *     and the stored URL goes through the same validator the wall reads with.
 *
 * Props-only (no useEvent/store/toast) so it renders standalone; WallDesign
 * wires it into the event studio.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, ImageUp, LoaderCircle, Moon, RefreshCw, Sun, SunMoon, Trash2 } from 'lucide-react';
import {
  SCENE_PALETTES,
  WALL_GRID_SIZES,
  WALL_LAYOUTS,
  WALL_LAYOUT_META,
  WALL_TRANSITIONS,
  WALL_TRANSITION_META,
  DEFAULT_WALL_LOOK,
  describeWallLook,
  isHex,
  normalizeWallLook,
  paletteCss,
  resolveSceneImageUrl,
  wallLookEquals,
  type EventScene,
  type WallLook,
} from '../../lib/sceneThemes';
import { getWallSettingsResult, setWallSettings, subscribeToSettings, uploadAsset } from '../../lib/db';
import type { Post, WallSettings } from '../../types';
import WallPreview, { samplePosts } from '../wall/WallPreview';
import LayoutGlyph from './WallDesignGlyphs';

export const WALL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const WALL_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

/** Why a picked file cannot be a wall backdrop, or null when it can. */
export function wallImageProblem(file: { type: string; size: number }): string | null {
  if (!(WALL_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'Use a JPG, PNG, WebP or AVIF image.';
  if (file.size > WALL_IMAGE_MAX_BYTES) return 'That image is over 10 MB. Try a smaller copy.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

type Upload = { phase: 'idle' } | { phase: 'uploading'; name: string } | { phase: 'error'; message: string };

export interface WallDesignPanelProps {
  eventId: string;
  /** Public wall URL for the "Open the wall" link. */
  wallUrl: string;
  eventScene?: EventScene;
  /** Real approved moments when there are some; the preview falls back to samples. */
  posts: Post[];
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  /** Called with what the database now holds after a load or a save. */
  onSettings?: (s: WallSettings) => void;
  onClose?: () => void;
  /** Lets the wrapper ask before closing on unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-serif text-[17px] leading-tight text-brand-fg">{title}</h3>
        {hint !== undefined && <p className="mt-0.5 font-sans text-[13px] text-brand-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string | number>({
  options, value, onChange, label,
}: {
  options: { id: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="liquid-glass-inset inline-flex w-full rounded-full p-1 gap-1 sm:w-auto">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`pressable flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-4 font-sans text-[13px] font-medium transition-colors sm:flex-none ${
              on ? 'is-selected text-brand-fg' : 'text-brand-muted hover:text-brand-fg'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function WallDesignPanel({
  eventId, wallUrl, eventScene, posts, notify, onSettings, onClose, onDirtyChange,
}: WallDesignPanelProps) {
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading');
  const [base, setBase] = useState<WallLook>(DEFAULT_WALL_LOOK);
  const [draft, setDraft] = useState<WallLook>(DEFAULT_WALL_LOOK);
  const [saving, setSaving] = useState(false);
  const [upload, setUpload] = useState<Upload>({ phase: 'idle' });
  const [colorText, setColorText] = useState('#1E1B4B');
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = load === 'ready' && !wallLookEquals(base, draft);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const read = useCallback(async () => {
    setLoad('loading');
    const { settings, failed } = await getWallSettingsResult(eventId);
    if (failed) { setLoad('error'); return; }
    const look = normalizeWallLook(settings.wallLook, settings.galleryScroll);
    setBase(look);
    setDraft(look);
    if (look.backdrop.kind === 'color') setColorText(look.backdrop.color);
    onSettings?.(settings);
    setLoad('ready');
  }, [eventId, onSettings]);

  useEffect(() => { void read(); }, [read]);

  // Another tab (or a co-host) saved: take it as the new baseline, and adopt
  // it outright when nothing here is unsaved.
  useEffect(() => {
    return subscribeToSettings(eventId, (s) => {
      const look = normalizeWallLook(s.wallLook, s.galleryScroll);
      setBase(look);
      if (!dirtyRef.current) setDraft(look);
    });
  }, [eventId]);

  const patch = (p: Partial<WallLook>) => setDraft((d) => ({ ...d, ...p }));

  const save = async () => {
    if (load !== 'ready' || saving) return;
    setSaving(true);
    try {
      const saved = await setWallSettings(eventId, { wallLook: draft }, { strict: true });
      setBase(normalizeWallLook(saved.wallLook, saved.galleryScroll));
      onSettings?.(saved);
      notify('Wall design saved. Every screen showing the wall updates now.', 'success');
    } catch {
      notify('Couldn’t save the wall design. Check your connection and try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const pickFile = async (file: File) => {
    const problem = wallImageProblem(file);
    if (problem !== null) { setUpload({ phase: 'error', message: problem }); return; }
    setUpload({ phase: 'uploading', name: file.name });
    let url: string | null = null;
    try {
      url = await uploadAsset(eventId, file, 'wall-backdrop');
    } catch {
      url = null;
    }
    const safe = resolveSceneImageUrl(url);
    if (safe === undefined) {
      setUpload({ phase: 'error', message: 'The upload didn’t go through. Check your connection and try again.' });
      return;
    }
    setUpload({ phase: 'idle' });
    const dim = draft.backdrop.kind === 'image' ? draft.backdrop.dim : 0.45;
    patch({ backdrop: { kind: 'image', url: safe, dim } });
  };

  const b = draft.backdrop;
  const imageUrl = b.kind === 'image' ? b.url : undefined;
  const darkPalettes = SCENE_PALETTES.filter((p) => p.tone === 'dark');
  const lightPalettes = SCENE_PALETTES.filter((p) => p.tone === 'light');
  // Real moments when the event has enough to fill a wall; samples otherwise,
  // so a host designing before the party still sees the look.
  const previewPosts = posts.length >= 9 ? posts : [...posts, ...samplePosts(30 - posts.length)];

  if (load === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p className="font-sans text-[14px] text-brand-fg">We couldn’t load your wall settings, so nothing can be saved yet.</p>
        <p className="font-sans text-[13px] text-brand-muted">Saving now could overwrite the wall with defaults. Try again in a moment.</p>
        <button type="button" onClick={() => void read()} className="pressable liquid-glass flex min-h-11 items-center gap-2 rounded-full px-5 font-sans text-[13px] font-medium text-brand-fg">
          <RefreshCw className="h-4 w-4" aria-hidden /> Try again
        </button>
      </div>
    );
  }

  const swatch = (selected: boolean) =>
    `pressable group flex flex-col gap-1.5 rounded-2xl p-1.5 text-left transition-shadow ${selected ? 'is-selected' : 'hover:bg-white/[0.04]'}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-4 pb-6 pt-1 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:overflow-hidden">
        {/* Preview */}
        <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
          {load === 'loading' ? (
            <div className="w-full animate-pulse rounded-2xl bg-white/[0.06]" style={{ aspectRatio: '16 / 10' }} />
          ) : (
            <WallPreview look={draft} eventScene={eventScene} posts={previewPosts} />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-sans text-[13px] text-brand-muted" aria-live="polite">{describeWallLook(draft)}</p>
            <a
              href={wallUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-sans text-[13px] font-medium text-brand-fg hover:underline"
            >
              Open the wall <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
          <p className="font-sans text-[12px] text-brand-muted">
            Saved changes show on every screen at once. Anyone can still switch views on their own screen with the tabs at the top of the wall.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-8 lg:min-h-0 lg:overflow-y-auto lg:pr-1 lg:pb-2" aria-busy={load === 'loading'}>
          <Section title="Layout" hint="How the photos fill the screen.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WALL_LAYOUTS.map((l) => {
                const on = draft.layout === l;
                return (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patch({ layout: l })}
                    className={`pressable liquid-glass flex flex-col gap-2 rounded-2xl p-2.5 text-left ${on ? 'is-selected' : ''}`}
                  >
                    <span className="block overflow-hidden rounded-xl bg-black/20">
                      <LayoutGlyph layout={l} gridSize={draft.gridSize} />
                    </span>
                    <span className="px-0.5 font-sans text-[13px] font-semibold text-brand-fg">{WALL_LAYOUT_META[l].label}</span>
                    <span className="px-0.5 font-sans text-[12px] leading-snug text-brand-muted">{WALL_LAYOUT_META[l].blurb}</span>
                  </button>
                );
              })}
            </div>
            {draft.layout === 'grid' && (
              <div className="flex flex-col gap-3 pt-1">
                <div className="flex flex-col gap-1.5">
                  <span className="font-sans text-[13px] font-medium text-brand-fg">Grid size</span>
                  <Segmented
                    label="Grid size"
                    value={draft.gridSize}
                    onChange={(v) => patch({ gridSize: v })}
                    options={WALL_GRID_SIZES.map((n) => ({ id: n, label: `${n} × ${n}` }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="font-sans text-[13px] font-medium text-brand-fg">When a tile changes</span>
                  <Segmented
                    label="Tile transition"
                    value={draft.transition}
                    onChange={(v) => patch({ transition: v })}
                    options={WALL_TRANSITIONS.map((t) => ({ id: t, label: WALL_TRANSITION_META[t].label }))}
                  />
                </div>
              </div>
            )}
          </Section>

          <Section title="Backdrop" hint="What sits behind the photos.">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <button type="button" aria-pressed={b.kind === 'event'} onClick={() => patch({ backdrop: { kind: 'event' } })} className={swatch(b.kind === 'event')}>
                <span className="relative block h-14 w-full overflow-hidden rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.03))', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)' }}>
                  <span className="absolute inset-0 flex items-center justify-center font-sans text-[12px] text-brand-muted">Theme</span>
                </span>
                <span className="px-1 font-sans text-[12px] font-medium text-brand-fg">Event theme</span>
              </button>
              {[...darkPalettes, ...lightPalettes].map((p) => {
                const on = b.kind === 'gradient' && b.paletteId === p.id;
                return (
                  <button key={p.id} type="button" aria-pressed={on} onClick={() => patch({ backdrop: { kind: 'gradient', paletteId: p.id } })} className={swatch(on)}>
                    <span className="block h-14 w-full rounded-xl" style={{ background: paletteCss(p), boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)' }} />
                    <span className="flex items-center justify-between px-1 font-sans text-[12px] font-medium text-brand-fg">
                      {p.name}
                      <span className="text-brand-muted">{p.tone === 'dark' ? 'Dark' : 'Light'}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Solid colour */}
            <div className={`liquid-glass flex flex-wrap items-center gap-3 rounded-2xl p-3 ${b.kind === 'color' ? 'is-selected' : ''}`}>
              <label className="relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-full" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.3)' }}>
                <span className="sr-only">Pick a solid colour</span>
                <input
                  type="color"
                  value={isHex(colorText) ? colorText : '#1E1B4B'}
                  onChange={(e) => {
                    setColorText(e.target.value);
                    patch({ backdrop: { kind: 'color', color: e.target.value } });
                  }}
                  className="absolute -inset-2 h-[calc(100%+16px)] w-[calc(100%+16px)] cursor-pointer border-0 p-0"
                />
              </label>
              <div className="min-w-0 flex-1">
                <p className="font-sans text-[13px] font-medium text-brand-fg">Solid colour</p>
                <p className="font-sans text-[12px] text-brand-muted">Text turns light or dark to suit it.</p>
              </div>
              <input
                aria-label="Colour hex code"
                value={colorText}
                maxLength={7}
                onChange={(e) => {
                  const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                  setColorText(v);
                  if (isHex(v)) patch({ backdrop: { kind: 'color', color: v } });
                }}
                className="liquid-glass-inset min-h-11 w-28 rounded-xl px-3 font-mono text-[13px] text-brand-fg outline-none"
              />
              {b.kind !== 'color' && (
                <button
                  type="button"
                  onClick={() => isHex(colorText) && patch({ backdrop: { kind: 'color', color: colorText } })}
                  className="pressable min-h-11 rounded-full px-4 font-sans text-[13px] font-medium text-brand-fg liquid-glass"
                >
                  Use
                </button>
              )}
            </div>

            {/* Own image */}
            <div className={`liquid-glass flex flex-col gap-3 rounded-2xl p-3 ${b.kind === 'image' ? 'is-selected' : ''}`}>
              <div className="flex flex-wrap items-center gap-3">
                {imageUrl !== undefined ? (
                  <img src={imageUrl} alt="Your wall backdrop" className="h-14 w-20 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-xl liquid-glass-inset text-brand-muted">
                    <ImageUp className="h-5 w-5" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-sans text-[13px] font-medium text-brand-fg">Your own image</p>
                  <p className="font-sans text-[12px] text-brand-muted">JPG, PNG or WebP up to 10 MB. Landscape works best.</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={WALL_IMAGE_TYPES.join(',')}
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void pickFile(f);
                  }}
                />
                <button
                  type="button"
                  disabled={upload.phase === 'uploading' || load !== 'ready'}
                  onClick={() => fileRef.current?.click()}
                  className="pressable flex min-h-11 items-center gap-2 rounded-full px-4 font-sans text-[13px] font-medium text-brand-fg liquid-glass disabled:opacity-50"
                >
                  {upload.phase === 'uploading' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <ImageUp className="h-4 w-4" aria-hidden />}
                  {imageUrl !== undefined ? 'Replace' : 'Upload'}
                </button>
                {imageUrl !== undefined && (
                  <button
                    type="button"
                    aria-label="Remove the image backdrop"
                    onClick={() => patch({ backdrop: { kind: 'event' } })}
                    className="pressable flex min-h-11 min-w-11 items-center justify-center rounded-full text-brand-muted hover:text-brand-fg"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              {upload.phase === 'uploading' && (
                <div role="status" className="flex flex-col gap-1.5">
                  <span className="font-sans text-[12px] text-brand-muted">Uploading {upload.name}…</span>
                  <span className="relative block h-1.5 overflow-hidden rounded-full bg-white/10">
                    <span className="wall-upload-bar absolute inset-y-0 left-0 w-1/3 rounded-full" style={{ background: 'rgba(var(--accent-rgb), 0.85)' }} />
                  </span>
                </div>
              )}
              {upload.phase === 'error' && (
                <p role="alert" className="font-sans text-[13px] text-amber-300">{upload.message}</p>
              )}
              {b.kind === 'image' && (
                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between font-sans text-[13px] text-brand-fg">
                    Dim the image
                    <span className="font-mono text-[12px] text-brand-muted">{Math.round(b.dim * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={0.8}
                    step={0.05}
                    value={b.dim}
                    onChange={(e) => patch({ backdrop: { ...b, dim: Number(e.target.value) } })}
                    className="w-full"
                    style={{ accentColor: 'var(--color-accent)' }}
                  />
                </label>
              )}
            </div>
          </Section>

          <Section title="Light or dark" hint="Auto follows the backdrop you picked.">
            <Segmented
              label="Wall tone"
              value={draft.tone}
              onChange={(v) => patch({ tone: v })}
              options={[
                { id: 'auto', label: 'Auto', icon: <SunMoon className="h-4 w-4" aria-hidden /> },
                { id: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" aria-hidden /> },
                { id: 'light', label: 'Light', icon: <Sun className="h-4 w-4" aria-hidden /> },
              ]}
            />
          </Section>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-3 sm:px-6">
        {dirty && <span className="mr-auto font-sans text-[13px] text-brand-muted">Unsaved changes</span>}
        {dirty && (
          <button type="button" onClick={() => setDraft(base)} className="pressable min-h-11 rounded-full px-4 font-sans text-[13px] font-medium text-brand-muted hover:text-brand-fg">
            Undo changes
          </button>
        )}
        {onClose !== undefined && (
          <button type="button" onClick={onClose} className="pressable liquid-glass min-h-11 rounded-full px-5 font-sans text-[13px] font-medium text-brand-fg">
            {dirty ? 'Cancel' : 'Done'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || upload.phase === 'uploading'}
          className="pressable bg-foil glow-accent flex min-h-11 items-center gap-2 rounded-full px-6 font-sans text-[13px] font-semibold text-[color:var(--on-accent)] disabled:opacity-50"
        >
          {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          {saving ? 'Saving…' : 'Save wall design'}
        </button>
      </div>
    </div>
  );
}
