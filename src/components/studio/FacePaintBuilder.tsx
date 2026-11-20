/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FacePaintBuilder — the Face Paint Power-Up. Pick a design from labelled
 * shelves (Everyday, Party, …) (live
 * thumbnails drawn by the SAME painter the booth runs), recolour it (defaults
 * come from the event theme), stamp a host logo on a cheek or the forehead, set
 * the pigment strength, then add it to the scene or test it on your own face in
 * the stage's Live view.
 *
 * ONE face-paint layer per scene — the face is one surface. Opening the builder
 * on a scene that already has one EDITS that layer (Update = one undo step);
 * that is this builder's slot guard, the face-paint analogue of the dock's
 * same-slot Replace/Add-both confirm.
 *
 * Conventions shared with the other Power-Ups: portalled full-screen modal
 * (useDialog: focus trap, Escape, modal-aware shortcuts), a backdrop click
 * never discards a design in progress, every write is ONE batched action, and
 * 44px / 10px floors on coarse pointers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Palette, ScanFace, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useDialog } from '../../lib/useDialog';
import { uploadAsset } from '../../lib/db';
import {
  DEFAULT_THEME,
  FACE_PAINT_DESIGNS,
  FACE_PAINT_DESIGN_MAP,
  FACE_PAINT_CATEGORIES,
  categoryOf,
  defaultColorsFor,
  type ThemeColors,
} from '../../lib/facePaint/designs';
import { faceFrameFromUvs } from '../../lib/facePaint/features';
import { drawFaceBase, paintFacePaint, type LogoImage } from '../../lib/facePaint/painter';
import { STANDARD_FACE_INDICES, STANDARD_FACE_UVS } from '../../lib/facePaint/faceTopology';
import {
  FACE_PAINT_LOGO_SIZE,
  FACE_PAINT_OPACITY,
  FACE_PAINT_PLACEMENTS,
  FACE_PAINT_PROCEDURAL_ID,
  facePaintKey,
  hasFacePaintPigment,
  normalizeHex,
  type FacePaintPlacement,
  type FacePaintSpec,
} from '../../lib/facePaint/spec';
import { createObject3D, planSlotAdd, MAX_OBJECTS, type Object3D, type StudioAction, type StudioDraft } from '../../lib/studio/state';
import type { LightingPresetId } from '../../lib/studio/lighting';
import { loadFacePaintLogo } from '../ar/FacePaintLayer';
import { SectionLabel, StudioSlider } from './StudioControls';

interface Props {
  /** Event SLUG — uploadAsset's tenant folder. */
  eventId: string;
  dispatch: React.Dispatch<StudioAction>;
  draft?: StudioDraft;
  onClose: () => void;
  onUploaded?: () => void;
  /** Unused here (the paint is lit by the booth rig); kept for the shared Power-Up props contract. */
  lighting?: LightingPresetId;
}

/** The honest engine note — plain language, never the vendor's name (host-facing). */
export const FACE_PAINT_ENGINE_NOTE =
  'Face paint uses our advanced face tracker. On the few phones that can’t run it, guests get the look without the paint.';

/**
 * The studio's neutral mannequin tone (ReferenceBust is an untextured GLB under
 * three's default white material, which the studio lights to a light grey), so
 * the preview never assumes one skin colour. Pale paint (white stripes, the
 * sugar skull) would vanish on it, so those sit on a slightly darker neutral.
 */
const MANNEQUIN = '#d4d5d9';
const MANNEQUIN_DARK = '#9fa2a9';
function baseFor(colors: readonly string[]): string {
  const pale = colors.some((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return Number.isFinite(n) && (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.75;
  });
  return pale ? MANNEQUIN_DARK : MANNEQUIN;
}

const PLACEMENT_LABEL: Record<FacePaintPlacement, string> = {
  leftCheek: 'Left cheek',
  rightCheek: 'Right cheek',
  bothCheeks: 'Both cheeks',
  forehead: 'Forehead',
};

const QUICK_SWATCHES = ['#ffffff', '#121212', '#e8336f', '#1d4ed8', '#16a34a', '#f2851f', '#7c3aed'];
const MAX_LOGO_BYTES = 4 * 1024 * 1024;

/** The event's live theme colours (EventProvider sets the CSS vars), else the platform gold. */
function readTheme(): ThemeColors {
  try {
    const cs = getComputedStyle(document.documentElement);
    const pick = (v: string, fb: string) => normalizeHex(cs.getPropertyValue(v)) ?? fb;
    return {
      accent: pick('--color-accent', DEFAULT_THEME.accent),
      accent2: pick('--color-accent-2', DEFAULT_THEME.accent2),
      accent3: pick('--color-accent-3', DEFAULT_THEME.accent3),
    };
  } catch {
    return DEFAULT_THEME;
  }
}

/** Draw a flat face wearing `spec` onto `out` (the production painter). */
export function drawFacePaintThumb(out: CanvasRenderingContext2D, spec: FacePaintSpec, logo: LogoImage | null, size: number): void {
  const paint = document.createElement('canvas');
  paint.width = paint.height = size;
  const pctx = paint.getContext('2d');
  if (!pctx) return;
  paintFacePaint(pctx, faceFrameFromUvs(STANDARD_FACE_UVS, size), spec, { logo, grain: size >= 256 });
  out.clearRect(0, 0, size, size);
  drawFaceBase(out, STANDARD_FACE_UVS, STANDARD_FACE_INDICES, size, baseFor(spec.colors));
  // The paint only lands where there is face (the booth mesh does this for free).
  out.save();
  out.globalCompositeOperation = 'source-atop';
  out.globalAlpha = spec.opacity;
  out.drawImage(paint, 0, 0);
  out.restore();
}

/** The same face as a PNG data URL (a row thumbnail), or null without a canvas. */
export function facePaintThumbDataUrl(spec: FacePaintSpec, size = 192): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    drawFacePaintThumb(ctx, spec, null, size);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** A flat face wearing `spec`, drawn by the production painter. */
export function FaceThumb({ spec, logo, size, className }: { spec: FacePaintSpec; logo: LogoImage | null; size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = facePaintKey(spec);
  useEffect(() => {
    const out = ref.current?.getContext('2d');
    if (!out) return;
    drawFacePaintThumb(out, spec, logo, size);
    // `spec` is read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, logo, size]);
  return <canvas ref={ref} width={size} height={size} className={className} aria-hidden />;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`pressable px-2 py-1.5 pointer-coarse:min-h-11 rounded-lg text-[9px] pointer-coarse:text-[10px] font-label uppercase tracking-widest truncate transition-colors ${
        active
          ? 'bg-accent/20 text-accent-2 ring-1 ring-accent/30'
          : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'
      }`}
    >
      {children}
    </button>
  );
}

export default function FacePaintBuilder({ eventId, dispatch, draft, onClose, onUploaded }: Props) {
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, 'Face paint');
  const theme = useMemo(readTheme, []);
  // The scene's existing face-paint layer, if any — the builder then EDITS it.
  const existing = useMemo<Object3D | null>(
    () => (draft?.objects.find((o): o is Object3D => o.type !== 'overlay' && o.facePaint !== undefined) ?? null),
    [draft],
  );

  // A contacts-only face layer has no paint yet: start from the default look
  // and keep its lenses (they ride the same layer).
  const existingPainted = existing?.facePaint !== undefined && hasFacePaintPigment(existing.facePaint);
  const [spec, setSpec] = useState<FacePaintSpec>(() =>
    existing?.facePaint && existingPainted
      ? existing.facePaint
      : {
          design: 'game-day',
          colors: defaultColorsFor('game-day', theme),
          opacity: FACE_PAINT_OPACITY.default,
          ...(existing?.facePaint?.eyes ? { eyes: existing.facePaint.eyes } : {}),
        });
  const initialRef = useRef(spec);
  const touched = facePaintKey(spec) !== facePaintKey(initialRef.current);
  const [logo, setLogo] = useState<LogoImage | null>(null);
  const [busy, setBusy] = useState<'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const logoUrl = spec.logo?.url ?? null;
  useEffect(() => {
    let alive = true;
    setLogo(null);
    if (logoUrl) void loadFacePaintLogo(logoUrl).then((l) => { if (alive) setLogo(l); });
    return () => { alive = false; };
  }, [logoUrl]);

  const design = FACE_PAINT_DESIGN_MAP[spec.design];
  const setDesign = useCallback((id: string) => {
    setSpec((s) => ({ ...s, design: id, colors: id === 'none' ? [] : defaultColorsFor(id, theme) }));
  }, [theme]);
  const setColor = (i: number, hex: string) => {
    const v = normalizeHex(hex);
    if (!v) return;
    setSpec((s) => {
      const colors = [...s.colors];
      colors[i] = v;
      return { ...s, colors };
    });
  };

  const onPickLogo = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setError('Use a PNG, JPG or WebP image — a transparent PNG looks best.'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('That image is over 4 MB — export a smaller one.'); return; }
    setBusy('upload');
    try {
      const url = await uploadAsset(eventId, file, `facepaint-logo-${file.name.replace(/\.[a-z0-9]+$/i, '')}`);
      if (!url) { setError('Upload failed — check your connection and try again.'); return; }
      setSpec((s) => ({ ...s, logo: { url, placement: s.logo?.placement ?? 'leftCheek', size: s.logo?.size ?? FACE_PAINT_LOGO_SIZE.default } }));
      onUploaded?.();
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const paintable = hasFacePaintPigment(spec);
  const plan = draft && !existing ? planSlotAdd(draft, [{}], 'both') : null;
  const full = plan !== null && !plan.fits;

  /** ONE batched write (one undo step): update the scene's layer, or add one. */
  const commit = (thenLive: boolean) => {
    if (!paintable || full) return;
    const name = `Face Paint · ${design?.name ?? 'Logo'}`;
    const actions: StudioAction[] = existing
      ? [
          { type: 'UPDATE_OBJECT', id: existing.id, patch: { facePaint: spec, hidden: undefined } },
          { type: 'SELECT_OBJECT', id: existing.id },
        ]
      : [{
          type: 'ADD_OBJECT',
          object: createObject3D('headpiece', { proceduralId: FACE_PAINT_PROCEDURAL_ID, name, anchor: 'noseTip', facePaint: spec }),
        }];
    dispatch({ type: 'BATCH', actions });
    if (thenLive) {
      // View-only switches (never part of the undo history).
      dispatch({ type: 'SET_MODE', mode: '3d' });
      dispatch({ type: 'SET_THREE_VIEW', view: 'live' });
    }
    onClose();
  };

  if (typeof document === 'undefined') return null;

  // data-platform: a portal leaves the studio's themed chrome, and <html> wears
  // the EVENT's theme here, so the dialog opts back into the platform look.
  return createPortal(
    <div data-platform data-surface="night" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => { if (!touched) onClose(); }}>
      <div
        ref={panelRef}
        {...dialogProps}
        onClick={(e) => e.stopPropagation()}
        data-testid="face-paint-builder"
        className="glass-strong rounded-3xl w-full max-w-4xl max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] overflow-hidden animate-rise-in flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif text-lg text-foil-static flex items-center gap-2">
              <Palette className="w-4 h-4 text-accent-2 shrink-0" /> Face Paint
            </h2>
            <p className="font-sans text-[10px] text-brand-muted/60 mt-0.5 leading-snug">
              Painted onto the guest’s skin — it stretches with every smile and stays put when they turn.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pressable p-1.5 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 md:grid-cols-[1fr_1.1fr] gap-4 px-5 pb-5">
          {/* PREVIEW — the production painter on a flat stand-in face. */}
          <div className="flex flex-col gap-2 min-w-0">
            <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[radial-gradient(120%_100%_at_50%_0%,#141826,#05060B_70%)] flex items-center justify-center p-4">
              <FaceThumb spec={spec} logo={logo} size={512} className="w-full max-w-[320px] aspect-square" />
            </div>
            <p className="font-sans text-[10px] text-brand-muted/60 leading-snug flex items-start gap-1.5">
              <ScanFace className="w-3.5 h-3.5 shrink-0 mt-px text-accent-2/70" />
              <span>{FACE_PAINT_ENGINE_NOTE}</span>
            </p>
          </div>

          {/* CONTROLS */}
          <div className="flex flex-col gap-4 min-w-0">
            <div>
              <SectionLabel>Design</SectionLabel>
              {/* Labelled shelves (FACE_PAINT_CATEGORIES) keep ~20 looks scannable; empty shelves are skipped. */}
              <div className="flex flex-col gap-2.5">
                {FACE_PAINT_CATEGORIES.filter((g, gi) => gi === 0 || FACE_PAINT_DESIGNS.some((d) => categoryOf(d) === g.id)).map((g, gi) => (
                  <div key={g.id} role="group" aria-label={`${g.label} designs`}>
                    <p className="font-label uppercase tracking-widest text-[10px] text-brand-muted/55 mb-1">{g.label}</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                      {FACE_PAINT_DESIGNS.filter((d) => categoryOf(d) === g.id).map((d) => {
                        const active = d.id === spec.design;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setDesign(d.id)}
                            aria-pressed={active}
                            title={d.blurb}
                            data-testid={`face-paint-design-${d.id}`}
                            className={`pressable flex flex-col items-center gap-1 rounded-xl p-1.5 transition-colors ${
                              active ? 'bg-accent/15 ring-1 ring-accent/40' : 'bg-white/[0.03] hover:bg-white/[0.07]'
                            }`}
                          >
                            <FaceThumb
                              spec={{ design: d.id, colors: active ? spec.colors : defaultColorsFor(d.id, theme), opacity: FACE_PAINT_OPACITY.default }}
                              logo={null}
                              size={128}
                              className="w-full max-w-[84px] aspect-square"
                            />
                            <span className="font-label uppercase tracking-wider text-[10px] leading-tight text-center text-brand-fg/80 line-clamp-2 break-words max-w-full">{d.name}</span>
                          </button>
                        );
                      })}
                      {gi === 0 && (
                        <button
                          type="button"
                          onClick={() => setDesign('none')}
                          aria-pressed={spec.design === 'none'}
                          data-testid="face-paint-design-none"
                          className={`pressable flex flex-col items-center justify-center gap-1 rounded-xl p-1.5 min-h-[84px] transition-colors ${
                            spec.design === 'none' ? 'bg-accent/15 ring-1 ring-accent/40' : 'bg-white/[0.03] hover:bg-white/[0.07]'
                          }`}
                        >
                          <Upload className="w-4 h-4 text-brand-muted/60" />
                          <span className="font-label uppercase tracking-wider text-[10px] leading-tight text-center text-brand-fg/80">Logo only</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {design?.shimmer && (
                <p className="font-sans text-[10px] text-brand-muted/60 mt-1.5 leading-snug flex items-start gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 mt-px text-accent-2/70" />
                  <span>This look twinkles on the guest’s face (it holds still for guests who turn off motion).</span>
                </p>
              )}
            </div>

            {design && (
              <div>
                <SectionLabel>Colours</SectionLabel>
                <div className="flex flex-col gap-2">
                  {design.slots.map((slot, i) => (
                    <div key={slot.label} className="flex items-center gap-2 min-w-0">
                      <label className="relative w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-lg overflow-hidden ring-1 ring-white/15 shrink-0 cursor-pointer" style={{ background: spec.colors[i] ?? '#ffffff' }}>
                        <span className="sr-only">{slot.label} colour</span>
                        <input
                          type="color"
                          value={spec.colors[i] ?? '#ffffff'}
                          onChange={(e) => setColor(i, e.target.value)}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                      </label>
                      <span className="font-sans text-[10px] text-brand-muted/70 w-16 shrink-0 truncate">{slot.label}</span>
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {[theme.accent, theme.accent2, theme.accent3, ...QUICK_SWATCHES].map((hex, k) => (
                          <button
                            key={`${hex}-${k}`}
                            type="button"
                            onClick={() => setColor(i, hex)}
                            aria-label={`${slot.label}: ${hex}${k < 3 ? ' (event theme)' : ''}`}
                            className={`w-5 h-5 pointer-coarse:w-11 pointer-coarse:h-11 rounded-md ring-1 transition-transform hover:scale-110 ${spec.colors[i] === hex ? 'ring-accent-2 ring-2' : 'ring-white/15'}`}
                            style={{ background: hex }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="font-sans text-[10px] text-brand-muted/50 mt-1.5 leading-snug">The first swatches are your event’s theme colours.</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <SectionLabel>Logo stamp</SectionLabel>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void onPickLogo(e.target.files?.[0])}
                data-testid="face-paint-logo-input"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy !== null}
                  className="pressable flex items-center gap-1.5 px-3 py-2 pointer-coarse:min-h-11 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-brand-fg/85 text-[10px] font-label uppercase tracking-widest disabled:opacity-40 transition-colors"
                >
                  {busy === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {spec.logo ? 'Replace logo' : 'Upload a logo'}
                </button>
                {spec.logo && (
                  <button
                    type="button"
                    onClick={() => setSpec((s) => { const { logo: _l, ...rest } = s; void _l; return rest; })}
                    aria-label="Remove logo"
                    className="pressable p-2 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-lg bg-white/[0.03] hover:bg-rose-500/15 text-brand-muted/60 hover:text-rose-300 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {spec.logo && (
                <>
                  <div className="grid grid-cols-4 gap-1">
                    {FACE_PAINT_PLACEMENTS.map((p) => (
                      <Chip key={p} active={spec.logo?.placement === p} onClick={() => setSpec((s) => (s.logo ? { ...s, logo: { ...s.logo, placement: p } } : s))}>
                        {PLACEMENT_LABEL[p]}
                      </Chip>
                    ))}
                  </div>
                  <StudioSlider
                    label="Logo size"
                    value={spec.logo.size}
                    min={FACE_PAINT_LOGO_SIZE.min}
                    max={FACE_PAINT_LOGO_SIZE.max}
                    step={0.05}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setSpec((s) => (s.logo ? { ...s, logo: { ...s.logo, size: v } } : s))}
                  />
                </>
              )}
              <p className="font-sans text-[10px] text-brand-muted/50 leading-snug">
                Sponsors and brands: a transparent PNG reads best. Left and right are as guests see themselves on screen, and your logo always reads the right way round.
              </p>
            </div>

            <StudioSlider
              label="Paint strength"
              value={spec.opacity}
              min={FACE_PAINT_OPACITY.min}
              max={FACE_PAINT_OPACITY.max}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setSpec((s) => ({ ...s, opacity: v }))}
            />

            <p className="font-sans text-[10px] text-brand-muted/50 leading-relaxed">
              {existingPainted
                ? 'This scene already has face paint — your changes update it.'
                : existing
                  ? 'The paint joins this scene’s contacts layer, so the two show and hide together.'
                : 'Adds one face-paint layer you can rename, hide or delete like any other.'}
            </p>
          </div>
        </div>

        {/* STICKY FOOTER — the primary action is never below the fold. */}
        <div
          className="shrink-0 border-t border-white/10 px-5 pt-3 flex flex-col gap-2"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {error && <p role="alert" className="font-sans text-[10px] text-rose-300/90 leading-snug">{error}</p>}
          {!paintable && <p role="alert" className="font-sans text-[10px] text-rose-300/90 leading-snug">Upload a logo, or pick a design.</p>}
          {full && (
            <p role="alert" className="font-sans text-[10px] text-rose-300/90 leading-snug">
              This scene is full — {MAX_OBJECTS} stickers and 3D pieces is the limit. Remove a layer to add face paint.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => commit(true)}
              disabled={!paintable || full || busy !== null}
              data-testid="face-paint-test"
              className="pressable flex-1 flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-fg/80 text-[10px] font-label uppercase tracking-widest disabled:opacity-40 transition-colors"
            >
              <ScanFace className="w-3.5 h-3.5 shrink-0" />
              Test on my face
            </button>
            <button
              type="button"
              onClick={() => commit(false)}
              disabled={!paintable || full || busy !== null}
              data-testid="face-paint-commit"
              className="pressable flex-1 flex items-center justify-center gap-1.5 min-h-11 px-3 bg-foil text-[color:var(--on-accent)] rounded-xl font-bold text-[10px] font-label uppercase tracking-widest disabled:opacity-40 glow-accent transition"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              {existingPainted ? 'Update face paint' : 'Add to scene'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
