/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Text3DBuilder — the live editor for procedural 3D name jewelry: a name, a
 * kind (necklace / earrings / nose ring / floating text), a typeface, a metal
 * and a few dimensions, rebuilt in a real THREE scene as the host types.
 *
 * "Add to scene" exports the built group as a GLB, uploads it to the event's
 * bucket with the `.bw1` marker (so the dock never auto-fits it — the piece is
 * already authored in true centimetres) and drops it on the kind's head anchor
 * at scale 1. "Save as sticker" grabs the preview canvas as a transparent PNG
 * instead, for hosts who want the look without the tracking.
 *
 * The preview renders `<SceneLighting>` — the SAME shared rig the booth uses
 * (lib/studio/lighting.ts) — so what the host tunes against is what the guest's
 * photo gets. It used to copy Overlay3D's light values by hand and a comment
 * promised they stayed "VERBATIM"; nothing enforced that, and the mirror-metal
 * presets shipped with a warning that they would look dark on camera. With a
 * real (locally generated) environment map to reflect, they no longer do.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { Bounds, OrbitControls } from '@react-three/drei';
import { Gem, Loader2, Sparkles, X } from 'lucide-react';
import { useDialog } from '../../lib/useDialog';
import { uploadAsset } from '../../lib/db';
import { thumbUploadName } from '../../lib/studio/assetSources';
import { ANCHOR_MAP } from '../../lib/faceRig';
import {
  CHAIN_LINKS,
  FONT_OPTIONS,
  KIND_ANCHOR,
  KIND_LABEL,
  KIND_PLACEMENT,
  MATERIAL_PRESETS,
  SAG_CM,
  TEXT3D_KINDS,
  TEXT_CHARS,
  TEXT_HEIGHT_CM,
  clampName,
  defaultSpecFor,
  kindHasChain,
  materialWarning,
  strippedChars,
  validateSpec,
  type FontId,
  type MaterialPresetId,
  type Text3DKind,
  type Text3DSpec,
} from '../../lib/studio/text3d';
import { buildText3D, exportGlb, glyphsOf, loadFont, type BuiltText3D } from '../../lib/studio/text3dBuild';
import type { StudioAction, StudioDraft } from '../../lib/studio/state';
import { DEFAULT_LIGHTING, type LightingPresetId } from '../../lib/studio/lighting';
import SceneLighting from '../ar/SceneLighting';
import { SectionLabel, StudioSlider, StudioToggle } from './StudioControls';

interface Props {
  /** Event SLUG — uploadAsset's tenant folder. */
  eventId: string;
  dispatch: React.Dispatch<StudioAction>;
  /** Accepted for the shared ADDON_VIEWS props contract (PowerFxBuilder uses
   *  it for cap/conflict guards); jewelry places at the ear slots, unguarded. */
  draft?: StudioDraft;
  onClose: () => void;
  /** Refresh the dock's Uploads list once the GLB has landed in the bucket. */
  onUploaded?: () => void;
  /** The event's lighting rig, so the preview matches the booth exactly. */
  lighting?: LightingPresetId;
}

/** Rebuild delay after the last keystroke/drag. Long enough that typing a name
 *  costs one build instead of one per character, short enough to feel live. */
const REBUILD_DEBOUNCE_MS = 250;

type Busy = 'add' | 'sticker' | null;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pressable px-2 py-1.5 rounded-lg text-[9px] font-label uppercase tracking-widest truncate transition-colors ${
        active
          ? 'bg-accent/20 text-accent-2 ring-1 ring-accent/30'
          : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'
      }`}
    >
      {children}
    </button>
  );
}

export default function Text3DBuilder({ eventId, dispatch, onClose, onUploaded, lighting = DEFAULT_LIGHTING }: Props) {
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, '3D name jewelry');

  const [spec, setSpec] = useState<Text3DSpec>(() => defaultSpecFor('necklace'));
  // What the host typed, kept separate from spec.text: spec.text only ever
  // holds the clamped, glyph-checked name the geometry is built from, but the
  // input must still show exactly what they pressed.
  const [typed, setTyped] = useState('Name');
  const [glyphs, setGlyphs] = useState<Record<string, unknown> | null>(null);
  const [built, setBuilt] = useState<BuiltText3D | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const patch = useCallback((p: Partial<Text3DSpec>) => setSpec((s) => ({ ...s, ...p })), []);

  // Switching kind resets to that kind's defaults (its dimension ranges differ),
  // but keeps the name, typeface and metal the host already chose.
  const setKind = useCallback((kind: Text3DKind) => {
    setSpec((s) => ({ ...defaultSpecFor(kind), text: s.text, fontId: s.fontId, material: s.material }));
  }, []);

  // The chosen typeface's glyph table drives clampName — load it up front so
  // the "we removed these characters" hint is right from the first keystroke.
  useEffect(() => {
    let alive = true;
    loadFont(spec.fontId)
      .then((font) => { if (alive) setGlyphs(glyphsOf(font)); })
      .catch(() => { if (alive) setGlyphs(null); });
    return () => { alive = false; };
  }, [spec.fontId]);

  // Re-clamp whenever the typeface changes: Optimer Bold has a different glyph
  // set from Helvetiker, so a name valid under one can lose characters here.
  useEffect(() => {
    if (!glyphs) return;
    setSpec((s) => {
      const next = clampName(typed, glyphs);
      return next === s.text ? s : { ...s, text: next };
    });
  }, [glyphs, typed]);

  const dropped = useMemo(() => (glyphs ? strippedChars(typed, glyphs) : []), [typed, glyphs]);
  const validation = useMemo(() => validateSpec(spec), [spec]);
  const metalNote = materialWarning(spec.material);
  const linkRange = CHAIN_LINKS[spec.kind];
  const heightRange = TEXT_HEIGHT_CM[spec.kind];
  const anchorHint = useMemo(() => {
    const anchor = KIND_ANCHOR[spec.kind];
    if (Array.isArray(anchor)) return 'Adds one piece per ear, both tracking the head.';
    return `Attaches at the ${(ANCHOR_MAP[anchor]?.label ?? anchor).toLowerCase()} anchor.`;
  }, [spec.kind]);

  // Debounced rebuild. Every swap disposes the group it replaces (the effect
  // cleanup below), so dragging a slider cannot leak a geometry per frame.
  useEffect(() => {
    if (!validation.ok) { setBuilt(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const font = await loadFont(spec.fontId);
          if (cancelled) return;
          const next = buildText3D(spec, font);
          if (cancelled) { next.dispose(); return; }
          setBuilt(next);
          setBuildError(null);
        } catch (e) {
          if (cancelled) return;
          setBuilt(null);
          setBuildError(e instanceof Error ? e.message : 'Could not build that piece.');
        }
      })();
    }, REBUILD_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [spec, validation.ok]);

  // Runs when `built` is replaced AND on unmount — the previous group's
  // geometries and material are freed exactly once, after React has already
  // committed the render that removed it from the scene.
  useEffect(() => () => { built?.dispose(); }, [built]);

  const addToScene = async () => {
    if (!built || busy) return;
    setBusy('add');
    setActionError(null);
    try {
      const blob = await exportGlb(built.group);
      // The `.bw1` marker survives uploadAsset's filename sanitising and lands
      // as `…-<name>-<kind>.bw1.glb` — AssetsDock reads it as "already in true
      // centimetres, do not auto-fit".
      const url = await uploadAsset(eventId, blob, `${spec.text}-${spec.kind}.bw1`);
      if (!url) {
        setActionError('Upload failed — check your connection and try again.');
        return;
      }
      // Paired thumbnail, best-effort: the live preview canvas already shows
      // this exact piece under the event's lighting, so it IS the picture the
      // dock and layer list should carry. Named from the RETURNED url (never
      // `spec.text`) so it pairs — see assetSources.thumbUploadName.
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          const shot = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (shot) await uploadAsset(eventId, shot, thumbUploadName(url));
        } catch (e) {
          // A missing thumbnail is cosmetic; the piece itself is already saved.
          console.warn('[Text3DBuilder] thumbnail capture failed', e);
        }
      }
      const label = `${spec.text} ${KIND_LABEL[spec.kind]}`;
      const anchor = KIND_ANCHOR[spec.kind];
      // scale 1 explicitly: the piece is authored life-size, so the auto-fit
      // that normally rescales an uploaded model must not run.
      const anchors = Array.isArray(anchor) ? anchor : [anchor];
      const place = KIND_PLACEMENT[spec.kind];
      for (const a of anchors) {
        // The anchor rides the ADD, it is not a follow-up SELECT_ANCHOR — that
        // action deliberately zeroes offset and rotation (a host switching a
        // piece from crown to chin wants a clean slate), which silently wiped
        // the authored placement when it ran second.
        dispatch({
          type: 'SET_MODEL_ASSET',
          url,
          name: label,
          scale: place.scale,
          offsetCm: place.offsetCm,
          anchor: a,
        });
      }
      onUploaded?.();
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not export that piece.');
    } finally {
      setBusy(null);
    }
  };

  const saveAsSticker = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    if (!built) { setActionError('The preview is still building — try again in a moment.'); return; }
    setBusy('sticker');
    setActionError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        setActionError("Couldn't capture the preview — try again.");
        return;
      }
      dispatch({
        type: 'SET_OVERLAY_UPLOAD',
        url: URL.createObjectURL(blob),
        blob,
        overlayKind: '2d_filter',
        name: spec.text,
      });
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const disabled = !built || busy !== null;

  if (typeof document === 'undefined') return null;

  // Portalled to <body> (the DragGhost idiom): the assets dock lives in an
  // <aside> that is both `overflow-y-auto` AND `translate-x-*` at every
  // breakpoint, and any non-`none` transform makes that aside the containing
  // block for `position: fixed` children — an in-place overlay would be
  // clipped into a 19rem column instead of covering the screen.
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        ref={panelRef}
        {...dialogProps}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong rounded-3xl w-full max-w-4xl max-h-[88vh] overflow-hidden animate-rise-in flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif text-lg text-foil-static flex items-center gap-2">
              <Gem className="w-4 h-4 text-accent-2 shrink-0" /> 3D Name Jewelry
            </h2>
            <p className="font-sans text-[10px] text-brand-muted/50 mt-0.5 leading-snug">
              Built to real size in centimetres — it lands on the face life-size, no resizing needed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pressable p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-4 px-5 pb-5">
          {/* PREVIEW — the canvas itself keeps an alpha buffer (the backdrop is
              CSS behind it) so "Save as sticker" captures transparent PNG. */}
          <div className="relative rounded-2xl overflow-hidden border border-white/10 min-h-[260px] md:min-h-[380px] bg-[radial-gradient(120%_100%_at_50%_0%,#141826,#05060B_70%)]">
            <Canvas
              camera={{ position: [0, -2, 30], fov: 40, near: 0.1, far: 2000 }}
              gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
              onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
              dpr={[1, 2]}
              style={{ width: '100%', height: '100%' }}
            >
              {/* In-canvas Suspense: an async 3D child must never suspend past
                  the Canvas to the route boundary. */}
              <Suspense fallback={null}>
                {/* The shared booth rig — one definition, no hand-copied values.
                    No contact shadow: <Bounds> reframes the piece continuously
                    and there is no fixed floor to cast onto. */}
                <SceneLighting preset={lighting} />
                {/* Keyed on the built group: drei's Bounds only refits on
                    [size, clip, fit, observe, camera, controls] — never when
                    its children change — and R3F's <primitive> cannot swap its
                    `object` prop in place. Remounting on each build solves
                    both, and Bounds' reset() reframes along the CURRENT view
                    direction, so the host's orbit angle survives the refit. */}
                <Bounds key={built ? built.group.uuid : 'empty'} fit clip observe margin={1.25}>
                  {built ? <primitive object={built.group} /> : null}
                </Bounds>
                <OrbitControls makeDefault enableDamping dampingFactor={0.12} enablePan={false} />
              </Suspense>
            </Canvas>
            {/* Spinner only while a build is actually pending — an invalid spec
                (e.g. an emptied name) has its own message beside the controls,
                and a spinner there would promise a render that is not coming. */}
            {!built && !buildError && validation.ok && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <Loader2 className="w-5 h-5 animate-spin text-accent-2/70" />
              </div>
            )}
            {buildError && (
              <p role="alert" className="absolute inset-x-3 bottom-3 rounded-lg liquid-glass px-3 py-2 font-sans text-[10px] text-rose-300/90 leading-snug">
                {buildError}
              </p>
            )}
          </div>

          {/* CONTROLS */}
          <div className="flex flex-col gap-4 min-w-0">
            <div className="flex flex-col gap-1.5">
              <SectionLabel>Name</SectionLabel>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type a name…"
                maxLength={40}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] text-sm text-brand-fg placeholder:text-brand-muted/30 focus:outline-none focus:ring-1 focus:ring-accent/30"
              />
              {dropped.length > 0 && (
                <p className="font-sans text-[9px] text-brand-muted/50 leading-snug">
                  This typeface has no {dropped.map((c) => `“${c}”`).join(' ')} — left out of the piece.
                </p>
              )}
              {spec.text.length === 0 ? (
                <p role="alert" className="font-sans text-[9px] text-rose-300/90 leading-snug">
                  Type at least one letter this typeface can carve.
                </p>
              ) : (
                <p className="font-sans text-[9px] text-brand-muted/40 leading-snug">
                  {spec.text.length}/{TEXT_CHARS.max} characters
                </p>
              )}
            </div>

            <div>
              <SectionLabel>Piece</SectionLabel>
              <div className="grid grid-cols-4 gap-1">
                {TEXT3D_KINDS.map((k) => (
                  <Chip key={k} active={k === spec.kind} onClick={() => setKind(k)}>{KIND_LABEL[k]}</Chip>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Typeface</SectionLabel>
              <div className="grid grid-cols-3 gap-1">
                {FONT_OPTIONS.map((f) => (
                  <Chip key={f.id} active={f.id === spec.fontId} onClick={() => patch({ fontId: f.id as FontId })}>
                    {f.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Finish</SectionLabel>
              <div className="grid grid-cols-3 gap-1">
                {MATERIAL_PRESETS.map((m) => (
                  <Chip key={m.id} active={m.id === spec.material} onClick={() => patch({ material: m.id as MaterialPresetId })}>
                    {m.label}
                  </Chip>
                ))}
              </div>
              {metalNote && (
                <p className="font-sans text-[9px] text-brand-muted/50 leading-snug mt-1.5">{metalNote}</p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <StudioSlider
                label="Text height (cm)"
                value={spec.textHeightCm}
                min={heightRange.min}
                max={heightRange.max}
                step={0.1}
                format={(v) => v.toFixed(1)}
                onChange={(v) => patch({ textHeightCm: v })}
              />
              <StudioSlider
                label="Thickness (cm)"
                value={spec.depthCm}
                min={0.2}
                max={0.8}
                step={0.05}
                onChange={(v) => patch({ depthCm: v })}
              />
              {linkRange && (
                <StudioSlider
                  label="Chain links"
                  value={spec.chainLinks}
                  min={linkRange.min}
                  max={linkRange.max}
                  step={1}
                  format={(v) => v.toFixed(0)}
                  onChange={(v) => patch({ chainLinks: Math.round(v) })}
                />
              )}
              {spec.kind === 'necklace' && (
                <StudioSlider
                  label="Chain drop (cm)"
                  value={spec.sagCm}
                  min={SAG_CM.min}
                  max={SAG_CM.max}
                  step={0.1}
                  format={(v) => v.toFixed(1)}
                  onChange={(v) => patch({ sagCm: v })}
                />
              )}
              <StudioToggle
                label="Bevelled edges"
                hint="Softens the cut edge so the metal catches the light"
                value={spec.bevel}
                onChange={(v) => patch({ bevel: v })}
              />
            </div>

            {!validation.ok && spec.text.length > 0 && (
              <p role="alert" className="font-sans text-[10px] text-rose-300/90 leading-snug">{validation.errors[0]}</p>
            )}
            {actionError && (
              <p role="alert" className="font-sans text-[10px] text-rose-300/90 leading-snug">{actionError}</p>
            )}

            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={addToScene}
                disabled={disabled}
                className="pressable flex items-center justify-center gap-1.5 py-2.5 bg-foil text-white rounded-xl font-bold text-[10px] font-label uppercase tracking-widest disabled:opacity-40 glow-accent transition"
              >
                {busy === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {busy === 'add' ? 'Adding…' : 'Add to scene'}
              </button>
              <button
                type="button"
                onClick={saveAsSticker}
                disabled={disabled}
                className="pressable flex items-center justify-center gap-1.5 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] text-brand-muted/70 hover:text-brand-fg text-[10px] font-label uppercase tracking-widest disabled:opacity-40 transition-colors"
              >
                {busy === 'sticker' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Save as sticker
              </button>
              <p className="font-sans text-[9px] text-brand-muted/40 leading-relaxed px-1">
                {anchorHint}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
