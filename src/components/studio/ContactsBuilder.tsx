/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ContactsBuilder — the Coloured Contacts Power-Up. Pick a lens style (live
 * thumbnails drawn by the SAME painter the booth runs), recolour it, set its
 * strength and size, then add it to the scene or test it on your own eyes in
 * the stage's Live view. The preview has two tabs: Example (stand-in eyes) and
 * Live camera (ContactsLivePreview: the look on the host, as it changes).
 *
 * Contacts ride the scene's ONE face layer (the face-paint layer): they live on
 * the same tracked face and need the same tracker. A scene with face paint
 * gains contacts on that layer; a scene without one gets a contacts-only layer.
 * Opening the builder on a scene that already has contacts EDITS them.
 *
 * Conventions shared with the other Power-Ups (FacePaintBuilder is the model):
 * portalled full-screen modal (useDialog), a backdrop click never discards a
 * look in progress, every write is ONE batched action, 44px / 10px floors on
 * coarse pointers.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Eye, ScanFace, Sparkles, Trash2, X } from 'lucide-react';
import { useDialog } from '../../lib/useDialog';
import {
  CONTACT_STYLES, CONTACT_STYLE_MAP, LENS_SPAN, defaultContactColors, hexToRgb, paintLensTexture,
} from '../../lib/contacts/lens';
import { CONTACT_OPACITY, CONTACT_SIZE, contactsKey, type ContactLensSpec } from '../../lib/contacts/spec';
import { FACE_PAINT_OPACITY, FACE_PAINT_PROCEDURAL_ID, hasFacePaintPigment, normalizeHex } from '../../lib/facePaint/spec';
import { createObject3D, planSlotAdd, MAX_OBJECTS, type Object3D, type StudioAction, type StudioDraft } from '../../lib/studio/state';
import type { LightingPresetId } from '../../lib/studio/lighting';
import { SectionLabel, StudioSlider } from './StudioControls';

const ContactsLivePreview = lazy(() => import('./ContactsLivePreview'));

type PreviewTab = 'example' | 'live';
const PREVIEW_TAB_KEY = 'pbar.contacts.previewTab';
/** The tab the host used last (a per-device convenience; storage may be blocked). */
function readPreviewTab(): PreviewTab {
  try { return localStorage.getItem(PREVIEW_TAB_KEY) === 'live' ? 'live' : 'example'; } catch { return 'example'; }
}

interface Props {
  /** Unused here; kept for the shared Power-Up props contract. */
  eventId: string;
  dispatch: React.Dispatch<StudioAction>;
  draft?: StudioDraft;
  onClose: () => void;
  onUploaded?: () => void;
  lighting?: LightingPresetId;
}

/** The honest engine note — plain language, never the vendor's name (host-facing). */
export const CONTACTS_ENGINE_NOTE =
  'Contacts use our advanced face tracker and follow one guest at a time. On the few phones that can’t run it, guests get the rest of your scene without the lenses.';

/** Named lens colours, so a host can pick "Sapphire" instead of hunting a hex. */
export const LENS_SWATCHES: readonly { name: string; hex: string }[] = [
  { name: 'Sapphire', hex: '#3f7fd0' },
  { name: 'Aqua', hex: '#18c8d8' },
  { name: 'Emerald', hex: '#18b08a' },
  { name: 'Hazel', hex: '#9a6a2f' },
  { name: 'Honey', hex: '#d9a514' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Rose', hex: '#e8336f' },
  { name: 'Crimson', hex: '#d0101c' },
  { name: 'Ice', hex: '#9fb6c9' },
  { name: 'White', hex: '#f4f4f4' },
  { name: 'Black', hex: '#060608' },
];

const SKIN = '#b9bbc2';
const LENS_PX = 128;

/** A stand-in eye wearing `spec`: almond opening, plain iris, the production lens on top, lid over it. */
function drawEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, spec: ContactLensSpec, lens: HTMLCanvasElement): void {
  const style = CONTACT_STYLE_MAP[spec.style];
  const hw = w / 2, hh = w * 0.23;
  const r = w * 0.2; // iris radius
  const almond = () => {
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy + hh * 0.1);
    ctx.quadraticCurveTo(cx, cy - hh * 2.05, cx + hw, cy + hh * 0.1);
    ctx.quadraticCurveTo(cx, cy + hh * 1.75, cx - hw, cy + hh * 0.1);
    ctx.closePath();
  };
  ctx.save();
  almond();
  ctx.clip();
  // White of the eye, shaded toward the corners.
  const sclera = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, hw * 1.05);
  sclera.addColorStop(0, '#f6f3f0');
  sclera.addColorStop(1, '#c9c2c0');
  ctx.fillStyle = sclera;
  ctx.fillRect(cx - hw, cy - hh * 2.2, w, hh * 4.4);
  // A plain brown eye underneath, so a see-through lens has something to tint.
  ctx.fillStyle = '#5a3a22';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#08080a';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2); ctx.fill();
  // The lens (the booth's own painter).
  ctx.globalAlpha = spec.opacity;
  if (style?.fullEye) {
    ctx.fillStyle = spec.colors[0] ?? style.slots[0].default;
    ctx.fillRect(cx - hw, cy - hh * 2.2, w, hh * 4.4);
  }
  const side = 2 * r * LENS_SPAN * spec.size * 1.08;
  ctx.drawImage(lens, cx - side / 2, cy - side / 2, side, side);
  ctx.globalAlpha = 1;
  // The wet highlight survives a lens in the booth, so it does here.
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(cx - r * 0.34, cy - r * 0.36, r * 0.13, 0, Math.PI * 2); ctx.fill();
  // Upper-lid shadow.
  const lid = ctx.createLinearGradient(0, cy - hh * 1.1, 0, cy - hh * 0.2);
  lid.addColorStop(0, 'rgba(20,14,12,0.5)');
  lid.addColorStop(1, 'rgba(20,14,12,0)');
  ctx.fillStyle = lid;
  ctx.fillRect(cx - hw, cy - hh * 2.2, w, hh * 2.2);
  ctx.restore();
  if (style?.glow) {
    const rgb = hexToRgb(spec.colors[0] ?? style.slots[0].default) ?? [1, 1, 1];
    const halo = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 3);
    const c = `${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)}`;
    halo.addColorStop(0, `rgba(${c},${0.5 * spec.opacity})`);
    halo.addColorStop(1, `rgba(${c},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = halo;
    ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);
    ctx.restore();
  }
  // Lash line.
  ctx.strokeStyle = 'rgba(30,22,20,0.85)';
  ctx.lineWidth = Math.max(1, w * 0.018);
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy + hh * 0.1);
  ctx.quadraticCurveTo(cx, cy - hh * 2.05, cx + hw, cy + hh * 0.1);
  ctx.stroke();
}

/** One or two stand-in eyes wearing the lens. */
function EyeThumb({ spec, width, height, pair, className }: { spec: ContactLensSpec; width: number; height: number; pair?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = contactsKey(spec);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const lens = document.createElement('canvas');
    lens.width = lens.height = LENS_PX;
    const lctx = lens.getContext('2d');
    if (!lctx) return;
    const img = lctx.createImageData(LENS_PX, LENS_PX);
    paintLensTexture(img.data, LENS_PX, spec);
    lctx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = SKIN;
    ctx.fillRect(0, 0, width, height);
    if (pair) {
      const w = width * 0.36;
      drawEye(ctx, width * 0.27, height * 0.54, w, spec, lens);
      drawEye(ctx, width * 0.73, height * 0.54, w, spec, lens);
    } else {
      drawEye(ctx, width / 2, height * 0.56, width * 0.8, spec, lens);
    }
    // `spec` is read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width, height, pair]);
  return <canvas ref={ref} width={width} height={height} className={className} aria-hidden />;
}

/** The event's live theme colours (EventProvider sets the CSS vars); empty outside an event. */
function readThemeColors(): string[] {
  try {
    const cs = getComputedStyle(document.documentElement);
    return ['--color-accent', '--color-accent-2', '--color-accent-3']
      .map((v) => normalizeHex(cs.getPropertyValue(v)))
      .filter((c): c is string => c !== null);
  } catch {
    return [];
  }
}

export default function ContactsBuilder({ dispatch, draft, onClose }: Props) {
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, 'Coloured contacts');
  const theme = useMemo(readThemeColors, []);
  // The scene's face layer, if any — contacts join it (or edit the ones on it).
  const existing = useMemo<Object3D | null>(
    () => (draft?.objects.find((o): o is Object3D => o.type !== 'overlay' && o.facePaint !== undefined) ?? null),
    [draft],
  );
  const existingEyes = existing?.facePaint?.eyes;

  const [spec, setSpec] = useState<ContactLensSpec>(() =>
    existingEyes ?? { style: 'natural', colors: defaultContactColors('natural'), opacity: CONTACT_OPACITY.default, size: CONTACT_SIZE.default });
  const initialRef = useRef(spec);
  const touched = contactsKey(spec) !== contactsKey(initialRef.current);
  const style = CONTACT_STYLE_MAP[spec.style];

  const setStyle = (id: string) => setSpec((s) => ({ ...s, style: id, colors: defaultContactColors(id) }));
  const setColor = (i: number, hex: string) => {
    const v = normalizeHex(hex);
    if (!v) return;
    setSpec((s) => {
      const colors = [...s.colors];
      colors[i] = v;
      return { ...s, colors };
    });
  };

  const [tab, setTabState] = useState<PreviewTab>(readPreviewTab);
  const setTab = (t: PreviewTab) => {
    setTabState(t);
    try { localStorage.setItem(PREVIEW_TAB_KEY, t); } catch { /* storage blocked: the choice lasts this visit */ }
  };
  // The face layer the Live tab draws: the scene's own (its paint shows under the
  // lenses, as it will for guests) or a contacts-only stand-in, made ONCE so its
  // id is stable while the look changes.
  const standIn = useMemo(
    () => createObject3D('headpiece', {
      proceduralId: FACE_PAINT_PROCEDURAL_ID,
      anchor: 'noseTip',
      facePaint: { design: 'none', colors: [], opacity: FACE_PAINT_OPACITY.default },
    }),
    [],
  );
  const specKey = contactsKey(spec);
  const liveLayer = useMemo<Object3D>(() => {
    const base = existing?.facePaint ? existing : standIn;
    return { ...base, hidden: undefined, facePaint: { ...(base.facePaint as NonNullable<Object3D['facePaint']>), eyes: spec } };
    // `spec` is read through `specKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, standIn, specKey]);

  const plan = draft && !existing ? planSlotAdd(draft, [{}], 'both') : null;
  const full = plan !== null && !plan.fits;

  /** ONE batched write (one undo step): put the lenses on the scene's face layer, or add one. */
  const commit = (thenLive: boolean) => {
    if (!style || full) return;
    const actions: StudioAction[] = existing?.facePaint
      ? [
          { type: 'UPDATE_OBJECT', id: existing.id, patch: { facePaint: { ...existing.facePaint, eyes: spec }, hidden: undefined } },
          { type: 'SELECT_OBJECT', id: existing.id },
        ]
      : [{
          type: 'ADD_OBJECT',
          object: createObject3D('headpiece', {
            proceduralId: FACE_PAINT_PROCEDURAL_ID,
            name: `Contacts · ${style.name}`,
            anchor: 'noseTip',
            facePaint: { design: 'none', colors: [], opacity: FACE_PAINT_OPACITY.default, eyes: spec },
          }),
        }];
    dispatch({ type: 'BATCH', actions });
    if (thenLive) {
      // View-only switches (never part of the undo history).
      dispatch({ type: 'SET_MODE', mode: '3d' });
      dispatch({ type: 'SET_THREE_VIEW', view: 'live' });
    }
    onClose();
  };

  /** Take the lenses off: the face paint (if any) stays; a contacts-only layer goes. */
  const remove = () => {
    if (!existing?.facePaint || !existingEyes) return;
    if (hasFacePaintPigment(existing.facePaint)) {
      const { eyes: _e, ...rest } = existing.facePaint;
      void _e;
      dispatch({ type: 'UPDATE_OBJECT', id: existing.id, patch: { facePaint: rest } });
    } else {
      dispatch({ type: 'DELETE_OBJECT', id: existing.id });
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
        data-testid="contacts-builder"
        className="glass-strong rounded-3xl w-full max-w-4xl max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] overflow-hidden animate-rise-in flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif text-lg text-foil-static flex items-center gap-2">
              <Eye className="w-4 h-4 text-accent-2 shrink-0" /> Coloured Contacts
            </h2>
            <p className="font-sans text-[10px] text-brand-muted/60 mt-0.5 leading-snug">
              Lenses that follow your guest’s eyes: they move with every glance and disappear behind a blink.
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
          {/* PREVIEW — Example: the production lens painter on stand-in eyes.
              Live camera: the same look on the host, through the booth pipeline.
              `contents` on a phone: the pinned preview must be a child of the
              scrolling grid, or it would unpin where this column ends. */}
          <div className="contents md:flex md:flex-col md:gap-2 md:min-w-0">
            {/* On a phone the controls sit BELOW the preview, so it stays pinned
                while they scroll: a live preview nobody can see is no preview. */}
            <div className="sticky top-0 z-10 -mx-1 px-1 pb-2 flex flex-col gap-2 bg-brand-surface md:static md:mx-0 md:p-0 md:bg-transparent">
            <div role="tablist" aria-label="Preview" className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1">
              {([['example', 'Example', Eye], ['live', 'Live camera', Camera]] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`contacts-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls="contacts-preview-panel"
                  data-testid={`contacts-tab-${id}`}
                  onClick={() => setTab(id)}
                  className={`pressable flex items-center justify-center gap-1.5 min-h-9 pointer-coarse:min-h-11 rounded-lg font-label uppercase tracking-widest text-[10px] transition-colors ${
                    tab === id ? 'bg-accent/15 ring-1 ring-accent/40 text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.05]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            <div
              id="contacts-preview-panel"
              role="tabpanel"
              aria-labelledby={`contacts-tab-${tab}`}
              className="relative rounded-2xl overflow-hidden border border-white/10 bg-[radial-gradient(120%_100%_at_50%_0%,#141826,#05060B_70%)]"
            >
              {tab === 'live' ? (
                <div className="relative mx-auto w-full aspect-[3/4] max-w-[calc(30vh*0.75)] md:max-w-[calc(52vh*0.75)] overflow-hidden">
                  <Suspense fallback={null}>
                    <ContactsLivePreview layer={liveLayer} />
                  </Suspense>
                </div>
              ) : (
                <div className="flex items-center justify-center p-2 md:p-4">
                  <EyeThumb spec={spec} width={640} height={300} pair className="w-full max-w-[300px] md:max-w-[420px] rounded-xl" />
                </div>
              )}
            </div>
            </div>
            <p className="font-sans text-[10px] text-brand-muted/70 leading-snug">{style?.blurb}</p>
            <p className="font-sans text-[10px] text-brand-muted/60 leading-snug flex items-start gap-1.5">
              <ScanFace className="w-3.5 h-3.5 shrink-0 mt-px text-accent-2/70" />
              <span>{CONTACTS_ENGINE_NOTE}</span>
            </p>
          </div>

          {/* CONTROLS */}
          <div className="flex flex-col gap-4 min-w-0">
            <div>
              <SectionLabel>Style</SectionLabel>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5" role="group" aria-label="Lens styles">
                {CONTACT_STYLES.map((s) => {
                  const active = s.id === spec.style;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStyle(s.id)}
                      aria-pressed={active}
                      title={s.blurb}
                      data-testid={`contacts-style-${s.id}`}
                      className={`pressable flex flex-col items-center gap-1 rounded-xl p-1.5 transition-colors ${
                        active ? 'bg-accent/15 ring-1 ring-accent/40' : 'bg-white/[0.03] hover:bg-white/[0.07]'
                      }`}
                    >
                      <EyeThumb
                        spec={{ style: s.id, colors: active ? spec.colors : defaultContactColors(s.id), opacity: CONTACT_OPACITY.max, size: 1 }}
                        width={168}
                        height={112}
                        className="w-full max-w-[84px] rounded-lg"
                      />
                      <span className="font-label uppercase tracking-wider text-[10px] leading-tight text-center text-brand-fg/80 line-clamp-2 break-words max-w-full">{s.name}</span>
                    </button>
                  );
                })}
              </div>
              {style?.glow && (
                <p className="font-sans text-[10px] text-brand-muted/60 mt-1.5 leading-snug flex items-start gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 mt-px text-accent-2/70" />
                  <span>This lens pulses softly on your guest’s eyes (it holds steady for guests who turn off motion).</span>
                </p>
              )}
            </div>

            {style && (
              <div>
                <SectionLabel>Colours</SectionLabel>
                <div className="flex flex-col gap-2.5">
                  {style.slots.map((slot, i) => (
                    <div key={slot.label} className="flex items-start gap-2 min-w-0">
                      <label className="relative w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-lg overflow-hidden ring-1 ring-white/15 shrink-0 cursor-pointer" style={{ background: spec.colors[i] ?? slot.default }}>
                        <span className="sr-only">{slot.label} colour, any colour</span>
                        <input
                          type="color"
                          value={spec.colors[i] ?? slot.default}
                          onChange={(e) => setColor(i, e.target.value)}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                      </label>
                      <span className="font-sans text-[10px] text-brand-muted/70 w-12 shrink-0 truncate pt-2">{slot.label}</span>
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {[...LENS_SWATCHES, ...theme.map((hex) => ({ name: 'Event theme', hex }))].map((sw, k) => (
                          <button
                            key={`${sw.hex}-${k}`}
                            type="button"
                            onClick={() => setColor(i, sw.hex)}
                            title={sw.name}
                            aria-label={`${slot.label}: ${sw.name}`}
                            aria-pressed={spec.colors[i] === sw.hex}
                            className={`w-6 h-6 pointer-coarse:w-11 pointer-coarse:h-11 rounded-full ring-1 transition-transform hover:scale-110 ${spec.colors[i] === sw.hex ? 'ring-accent-2 ring-2' : 'ring-white/15'}`}
                            style={{ background: sw.hex }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="font-sans text-[10px] text-brand-muted/50 mt-1.5 leading-snug">
                  Tap the square for any colour.{theme.length > 0 ? ' The last swatches are your event’s theme colours.' : ''}
                </p>
              </div>
            )}

            <StudioSlider
              label="Lens strength"
              value={spec.opacity}
              min={CONTACT_OPACITY.min}
              max={CONTACT_OPACITY.max}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setSpec((s) => ({ ...s, opacity: v }))}
            />
            {!style?.fullEye && (
              <StudioSlider
                label="Lens size"
                value={spec.size}
                min={CONTACT_SIZE.min}
                max={CONTACT_SIZE.max}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => setSpec((s) => ({ ...s, size: v }))}
              />
            )}

            <p className="font-sans text-[10px] text-brand-muted/50 leading-relaxed">
              {existingEyes
                ? 'This scene already has contacts — your changes update them.'
                : existing
                  ? 'The lenses join this scene’s face paint layer, so the two show and hide together.'
                  : 'Adds one contacts layer you can rename, hide or delete like any other.'}
            </p>
          </div>
        </div>

        {/* STICKY FOOTER — the primary action is never below the fold. */}
        <div
          className="shrink-0 border-t border-white/10 px-5 pt-3 flex flex-col gap-2"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {full && (
            <p role="alert" className="font-sans text-[10px] text-rose-300/90 leading-snug">
              This scene is full — {MAX_OBJECTS} stickers and 3D pieces is the limit. Remove a layer to add contacts.
            </p>
          )}
          <div className="flex gap-2">
            {existingEyes && (
              <button
                type="button"
                onClick={remove}
                aria-label="Remove contacts"
                data-testid="contacts-remove"
                className="pressable flex items-center justify-center min-h-11 min-w-11 px-3 rounded-xl bg-white/[0.03] hover:bg-rose-500/15 text-brand-muted/60 hover:text-rose-300 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => commit(true)}
              disabled={!style || full}
              data-testid="contacts-test"
              className="pressable flex-1 flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-fg/80 text-[10px] font-label uppercase tracking-widest disabled:opacity-40 transition-colors"
            >
              <ScanFace className="w-3.5 h-3.5 shrink-0" />
              Test on my eyes
            </button>
            <button
              type="button"
              onClick={() => commit(false)}
              disabled={!style || full}
              data-testid="contacts-commit"
              className="pressable flex-1 flex items-center justify-center gap-1.5 min-h-11 px-3 bg-foil text-[color:var(--on-accent)] rounded-xl font-bold text-[10px] font-label uppercase tracking-widest disabled:opacity-40 glow-accent transition"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              {existingEyes ? 'Update contacts' : 'Add to scene'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
