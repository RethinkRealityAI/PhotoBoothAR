/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PowerFxBuilder — the "Power FX" Power-Up: pick a gear piece (visor / wand /
 * gauntlet / none), a colour, the gesture that fires it and the blast style,
 * watching the REAL ceremony loop in a live R3F preview (the same BeamFX +
 * fxBus the booth renders). One "Add to scene" writes an ordinary object +
 * ordinary trigger into the reducer, so PropertiesDock's existing sections
 * pick everything up with zero special cases.
 *
 * Chrome and portal rationale copied from Text3DBuilder (the assets <aside> is
 * translate-x'd, making it the containing block for fixed children — an
 * in-place overlay would clip to the dock column).
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Loader2, X, Zap } from 'lucide-react';
import { useDialog } from '../../lib/useDialog';
import { Model } from '../ar/FaceRig';
import { HeadPiece } from '../ar/HeadPieces';
import BeamFX from '../ar/BeamFX';
import SceneLighting from '../ar/SceneLighting';
import { RIG_CAMERA } from '../../lib/faceRig';
import { DEFAULT_LIGHTING, type LightingPresetId } from '../../lib/studio/lighting';
import { assetTemplateOf, findLibraryAsset } from '../../lib/studio/assetLibrary';
import { normalizeTemplate } from '../../lib/studio/assetTemplate';
import { measureGlbFitScale } from '../../lib/studio/glbThumb';
import { PROP_TARGET_CM } from '../../lib/studio/bustFit';
import { emitFx } from '../../lib/studio/fxBus';
import { makeBeamSpec } from '../../lib/studio/beam';
import {
  availableGear,
  buildPowerFxAdditions,
  defaultPowerFxSpec,
  POWER_GEAR,
  POWER_PALETTE,
  validatePowerFxSpec,
  type PowerFxSpec,
} from '../../lib/studio/powerFx';
import { libraryAssets } from '../../lib/studio/assetLibrary';
import {
  BEAM_STYLE_LABELS,
  BEAM_STYLES,
  FACE_TRIGGER_SOURCES,
  HAND_TRIGGER_SOURCES,
  isHandSource,
  TRIGGER_HINT_LABELS,
  TRIGGER_SOURCE_LABELS,
  type BeamStyle,
  type TriggerSource,
} from '../../lib/studio/triggers';
import type { StudioAction } from '../../lib/studio/state';
import { SectionLabel, StudioToggle } from './StudioControls';

interface Props {
  eventId: string;
  dispatch: React.Dispatch<StudioAction>;
  onClose: () => void;
  onUploaded?: () => void;
  lighting?: LightingPresetId;
}

/** How often the preview re-fires the ceremony. Longer than the longest style
 *  envelope so each loop reads as a complete charge → blast → fade. */
const PREVIEW_LOOP_MS = 2600;

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

/** The picked gear, rendered at booth head depth so BeamFX's static origin and
 *  the rig camera framing both hold. Library gear auto-fits like the dock does. */
function GearPreview({ spec }: { spec: PowerFxSpec }) {
  const gearDef = POWER_GEAR.find((g) => g.id === spec.gearId) ?? null;
  const [fitScale, setFitScale] = useState<number | null>(null);
  const libAsset = gearDef !== null && gearDef.kind === 'library' ? findLibraryAsset(gearDef.refId, import.meta.env.DEV) : null;
  const template = libAsset !== null ? assetTemplateOf(libAsset) : null;

  useEffect(() => {
    setFitScale(null);
    if (template === null) return;
    let alive = true;
    void measureGlbFitScale(template.glbUrl).then((s) => {
      if (alive) setFitScale(s);
    });
    return () => {
      alive = false;
    };
  }, [template?.glbUrl]); // eslint-disable-line react-hooks/exhaustive-deps -- template is derived per render; its glbUrl is the identity

  if (gearDef === null || gearDef.refId === '') return null;

  if (gearDef.kind === 'headpiece') {
    return (
      <group position={[0, 2.5, -42]}>
        <HeadPiece id={gearDef.refId} />
      </group>
    );
  }
  if (template === null || fitScale === null) return null;
  const scale = (fitScale * template.fitCm) / PROP_TARGET_CM;
  const customization = { parts: { [template.regions.find((r) => r.id === 'lens')?.id ?? template.regions[0]?.id ?? 'lens']: { hex: spec.hex.toLowerCase() } } };
  return (
    <group position={[0, 2.5, -42]} scale={scale}>
      <Model url={template.glbUrl} template={template} customization={customization} />
    </group>
  );
}

export default function PowerFxBuilder({ dispatch, onClose, lighting = DEFAULT_LIGHTING }: Props) {
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, 'Power FX');

  const gearChoices = useMemo(
    () => availableGear(libraryAssets(import.meta.env.DEV).map((a) => a.id)),
    [],
  );
  const [spec, setSpec] = useState<PowerFxSpec>(() => defaultPowerFxSpec(gearChoices[0]));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const gearDef = POWER_GEAR.find((g) => g.id === spec.gearId) ?? null;
  const isLibraryGear = gearDef !== null && gearDef.kind === 'library';
  const validation = validatePowerFxSpec(spec);

  const setGear = (id: string) => {
    const def = POWER_GEAR.find((g) => g.id === id);
    if (!def) return;
    // Adopt the gear's suggested pairing but keep the host's colour.
    setSpec((s) => ({ ...defaultPowerFxSpec(def), hex: s.hex, guestPick: s.guestPick }));
  };

  // The looping live ceremony — the REAL booth pipeline (fxBus → BeamFX).
  useEffect(() => {
    if (!validation.ok) return;
    const libAsset = isLibraryGear && gearDef !== null ? findLibraryAsset(gearDef.refId, import.meta.env.DEV) : null;
    const piece = libAsset
      ? {
          template: normalizeTemplate(libAsset.template),
          customization: { parts: { lens: { hex: spec.hex.toLowerCase() } } },
        }
      : null;
    const fire = () =>
      emitFx({
        kind: 'beam',
        spec: makeBeamSpec(
          { type: 'beam', style: spec.style, color: piece !== null ? 'auto' : spec.hex },
          piece,
          isHandSource(spec.source),
          performance.now(),
        ),
      });
    fire();
    const timer = window.setInterval(fire, PREVIEW_LOOP_MS);
    return () => window.clearInterval(timer);
  }, [spec.style, spec.hex, spec.source, spec.gearId, validation.ok, isLibraryGear, gearDef]);

  const addToScene = async () => {
    if (!validation.ok || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const libAsset = isLibraryGear && gearDef !== null ? findLibraryAsset(gearDef.refId, import.meta.env.DEV) : null;
      const additions = buildPowerFxAdditions(spec, libAsset?.template ?? null);

      if (additions.gear !== null && additions.gear.kind === 'headpiece') {
        dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: additions.gear.pieceId });
      } else if (additions.gear !== null && additions.gear.kind === 'library' && libAsset !== null) {
        const template = assetTemplateOf(libAsset);
        if (template === null) throw new Error('This gear’s descriptor failed to validate.');
        // Honour the guest-pick toggle by stamping the lens region on the
        // template copy that travels with the object (normalizeRegion keeps
        // guestPick only when === true).
        const rawTemplate = spec.guestPick
          ? stampGuestPick(libAsset.template, additions.customization)
          : libAsset.template;
        const fitScale = await measureGlbFitScale(template.glbUrl);
        dispatch({
          type: 'SET_MODEL_ASSET',
          url: template.glbUrl,
          name: libAsset.name,
          scale: fitScale != null ? (fitScale * template.fitCm) / PROP_TARGET_CM : undefined,
          template: rawTemplate,
          offsetCm: libAsset.defaultNudgeCm,
        });
        // The new object is selected by the reducer — recolour its lens.
        const parts = additions.customization?.parts;
        if (parts !== undefined && parts !== null) {
          for (const [id, style] of Object.entries(parts)) {
            if (style.hex !== undefined && style.hex !== null) {
              dispatch({ type: 'SET_CUSTOMIZATION', part: { id, hex: style.hex } });
            }
          }
        }
      }
      for (const trigger of additions.triggers) {
        dispatch({ type: 'ADD_TRIGGER', trigger });
      }
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not add that — try again.');
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

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
              <Zap className="w-4 h-4 text-accent-2 shrink-0" /> Power FX
            </h2>
            <p className="font-sans text-[10px] text-brand-muted/50 mt-0.5 leading-snug">
              Gesture-fired energy blasts — the preview loops the exact ceremony guests will set off.
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
          {/* PREVIEW — booth camera geometry (rig camera at the origin, gear at
              head depth) so BeamFX renders exactly as it will over a face. */}
          <div className="relative rounded-2xl overflow-hidden border border-white/10 min-h-[260px] md:min-h-[380px] bg-[radial-gradient(120%_100%_at_50%_0%,#141826,#05060B_70%)]">
            <Canvas
              camera={{ position: RIG_CAMERA.position, fov: RIG_CAMERA.fov, near: RIG_CAMERA.near, far: RIG_CAMERA.far }}
              gl={{ alpha: true, antialias: true }}
              dpr={[1, 2]}
              style={{ width: '100%', height: '100%' }}
            >
              <Suspense fallback={null}>
                <SceneLighting preset={lighting} />
                <GearPreview spec={spec} />
                <BeamFX mirror={false} videoId="powerfx-preview" staticHead />
                <OrbitControls
                  makeDefault
                  target={[0, 2, -42]}
                  enableDamping
                  dampingFactor={0.12}
                  enablePan={false}
                  minDistance={20}
                  maxDistance={70}
                />
              </Suspense>
            </Canvas>
          </div>

          {/* CONTROLS */}
          <div className="flex flex-col gap-4 min-w-0">
            <div>
              <SectionLabel>Gear</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {gearChoices.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGear(g.id)}
                    className={`pressable flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                      g.id === spec.gearId
                        ? 'bg-accent/15 ring-1 ring-accent/30'
                        : 'bg-white/[0.03] hover:bg-white/[0.06]'
                    }`}
                  >
                    <span
                      aria-hidden
                      className="w-6 h-6 rounded-lg shrink-0"
                      style={{ background: `linear-gradient(135deg, ${g.swatch[0]}, ${g.swatch[1]})` }}
                    />
                    <span className="min-w-0">
                      <span className="block text-[10px] font-label uppercase tracking-wide text-brand-fg truncate">{g.name}</span>
                      <span className="block text-[8.5px] font-sans text-brand-muted/50 leading-tight truncate">{g.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Colour</SectionLabel>
              <div className="flex items-center gap-1.5 flex-wrap">
                {POWER_PALETTE.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    title={p.label}
                    onClick={() => setSpec((s) => ({ ...s, hex: p.hex }))}
                    className={`pressable w-8 h-8 rounded-full transition-shadow ${
                      spec.hex.toLowerCase() === p.hex ? 'ring-2 ring-accent shadow-[0_0_10px_var(--color-accent)]' : 'ring-1 ring-white/15'
                    }`}
                    style={{ background: p.hex }}
                    aria-label={`${p.label} colour`}
                  />
                ))}
                <input
                  type="color"
                  value={spec.hex}
                  onChange={(e) => setSpec((s) => ({ ...s, hex: e.target.value }))}
                  aria-label="Custom colour"
                  className="w-8 h-8 rounded-full bg-transparent border border-white/15 cursor-pointer"
                />
              </div>
              {isLibraryGear && (
                <div className="mt-2">
                  <StudioToggle
                    label="Guests can pick this colour"
                    hint="A swatch row appears in the booth; your colour stays the default"
                    value={spec.guestPick}
                    onChange={(v) => setSpec((s) => ({ ...s, guestPick: v }))}
                  />
                </div>
              )}
            </div>

            <div>
              <SectionLabel>Fires when a guest…</SectionLabel>
              <p className="text-[8px] font-label uppercase tracking-widest text-brand-muted/35 mb-1">Hands</p>
              <div className="grid grid-cols-3 gap-1 mb-1.5">
                {HAND_TRIGGER_SOURCES.map((s) => (
                  <Chip key={s} active={s === spec.source} onClick={() => setSpec((prev) => ({ ...prev, source: s }))}>
                    {TRIGGER_SOURCE_LABELS[s]}
                  </Chip>
                ))}
              </div>
              <p className="text-[8px] font-label uppercase tracking-widest text-brand-muted/35 mb-1">Face</p>
              <div className="grid grid-cols-4 gap-1">
                {FACE_TRIGGER_SOURCES.map((s) => (
                  <Chip key={s} active={s === spec.source} onClick={() => setSpec((prev) => ({ ...prev, source: s }))}>
                    {TRIGGER_SOURCE_LABELS[s]}
                  </Chip>
                ))}
              </div>
              <p className="text-[9px] text-brand-muted/45 font-sans mt-1.5">Guest sees: “{TRIGGER_HINT_LABELS[spec.source]}”</p>
            </div>

            <div>
              <SectionLabel>Blast</SectionLabel>
              <div className="grid grid-cols-4 gap-1">
                {BEAM_STYLES.map((st: BeamStyle) => (
                  <Chip key={st} active={st === spec.style} onClick={() => setSpec((prev) => ({ ...prev, style: st }))}>
                    {BEAM_STYLE_LABELS[st]}
                  </Chip>
                ))}
              </div>
            </div>

            {actionError !== null && (
              <p role="alert" className="font-sans text-[10px] text-rose-300/90 leading-snug">{actionError}</p>
            )}

            <button
              type="button"
              onClick={addToScene}
              disabled={!validation.ok || busy}
              className="pressable flex items-center justify-center gap-1.5 py-2.5 bg-foil text-white rounded-xl font-bold text-[10px] font-label uppercase tracking-widest disabled:opacity-40 glow-accent transition"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {busy ? 'Adding…' : 'Add to scene'}
            </button>
            <p className="font-sans text-[9px] text-brand-muted/40 leading-relaxed px-1">
              Adds the gear and its trigger together. Fine-tune both any time in Properties → Magic Triggers.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Deep-clone the raw template with guestPick stamped on the customized region
 *  (the one whose hex the builder set — i.e. the lens). Raw-JSON level so the
 *  descriptor stays exactly what normalizeTemplate expects. */
function stampGuestPick(rawTemplate: unknown, customization: { parts?: Record<string, unknown> | null } | null): unknown {
  if (rawTemplate === null || typeof rawTemplate !== 'object') return rawTemplate;
  const partIds = customization?.parts ? Object.keys(customization.parts) : [];
  if (partIds.length === 0) return rawTemplate;
  const clone = JSON.parse(JSON.stringify(rawTemplate)) as Record<string, unknown>;
  const regions = clone.regions;
  if (Array.isArray(regions)) {
    for (const r of regions) {
      if (r !== null && typeof r === 'object' && partIds.includes((r as Record<string, unknown>).id as string)) {
        (r as Record<string, unknown>).guestPick = true;
      }
    }
  }
  return clone;
}
