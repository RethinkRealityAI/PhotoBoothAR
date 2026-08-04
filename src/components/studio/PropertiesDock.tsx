/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PropertiesDock — the studio's right panel. For a shader draft it shows effect
 * params; for a 2D/3D scene it shows a LAYERS list (the ordered objects) plus
 * the SELECTED object's properties:
 *   • overlay → Transform2D sliders + animation
 *   • 3d      → anchor offset/rotation/scale sliders + head-size calibration +
 *               per-object occlusion toggle + animation
 * Plus shared name / booth-icon / published / featured controls. All per-object
 * controls operate on selectedObject(draft).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowBigUp,
  Check,
  ChevronDown,
  Clapperboard,
  Eye,
  EyeOff,
  FileStack,
  Grab,
  Hand,
  HandFist,
  HandMetal,
  ScanFace,
  Image as ImageIcon,
  Laugh,
  Layers,
  Loader2,
  MousePointerClick,
  Palette,
  PartyPopper,
  Plus,
  RotateCcw,
  RotateCw,
  Ruler,
  Smile,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  Wand2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { HAND_ANCHORS } from '../../lib/handPose';
import { SHADER_MAP, FILTER_SHADERS, defaultParams } from '../../lib/shaders';
import { HEAD_SCALE_MIN, HEAD_SCALE_MAX } from '../../lib/studio/occluder';
import { ANCHOR_PRESETS, getHeadFitEstimate } from '../../lib/faceRig';
import { PROP_SCALE_MAX } from '../../lib/studio/bustFit';
import { OVERLAY_SCALE, OVERLAY_POSITION, OVERLAY_ROTATION, formatAtStep, defaultAnchorConfig } from '../../lib/studio/controlSpecs';
import { ASSET_CUSTOMIZATION, FINISH_TINT_STRENGTH } from '../../lib/studio/controlSpecs';
import { FINISHES, normalizeFinish, normalizeTintStrength, type FinishId } from '../../lib/studio/finish';
import { isConfigurable, normalizeTemplate, type AssetRegion } from '../../lib/studio/assetTemplate';
import {
  COLORWAYS,
  COLORWAY_ROLES,
  colorwayParts,
  outfitColorway,
  dominantOutfitColor,
  type Colorway,
} from '../../lib/studio/colorways';
import { HOST_LIGHTING_PRESETS, type LightingPresetId } from '../../lib/studio/lighting';
import { alignTransform, snapRotation, stepRotation, type AlignAction } from '../../lib/studio/align';
import { HEAD_PIECE_MAP } from '../../lib/headPieces';
import {
  DEFAULT_TRANSFORM,
  MAX_OBJECTS,
  MAX_TRIGGERS,
  SCENE_FULL_MESSAGE,
  sceneCounts,
  selectedObject,
  type Object3D,
  type Overlay2D,
  type StudioAction,
  type StudioDraft,
  type StudioState,
} from '../../lib/studio/state';
import {
  ANIMATE_PRESET_LABELS,
  ANIMATE_PRESETS,
  BEAM_STYLE_LABELS,
  BEAM_STYLES,
  BURST_STYLE_LABELS,
  BURST_STYLES,
  FACE_TRIGGER_SOURCES,
  HAND_TRIGGER_SOURCES,
  TRIGGER_HINT_LABELS,
  TRIGGER_SOURCE_LABELS,
  type AnimatePreset,
  type BeamStyle,
  type BurstStyle,
  type TriggerAction,
  type TriggerSource,
} from '../../lib/studio/triggers';
import { draftToPayload, existingUrlResolver, STUDIO_SAMPLE_GUEST_NAME } from '../../lib/studio/draftMapping';
import { createExperience, getStudioSettings, setStudioSettings } from '../../lib/db';
import { useEvent } from '../../events/EventContext';
import type { AssetLabelConfig, AssetPartStyle, GuestLetteringConfig, LayerAnimation, Transform2D } from '../../types';
import { DEFAULT_LETTERING_COLOR, type GuestLetteringStyle } from '../../lib/letteringFit';
import { NumberField, SectionLabel, StudioSlider, StudioToggle } from './StudioControls';
import LayerList from './LayerList';
import Tooltip from '../ui/Tooltip';
import HelpButton from './HelpButton';
import type { FeatureHelpTopic } from '../../lib/studio/featureHelp';

interface Props {
  state: StudioState;
  dispatch: React.Dispatch<StudioAction>;
  headScale: number;
  onHeadScaleChange: (v: number, persist?: boolean) => void;
  /** Event-wide 3D lighting rig (owned by StudioShell, persisted in the
   *  app_settings 'studio' key alongside headScale). */
  lighting: LightingPresetId;
  onLightingChange: (next: LightingPresetId) => void;
  onThumbUpload: (file: File) => void;
  onThumbClear: () => void;
}

const AXES = ['x', 'y', 'z'] as const;

/** Offset-axis labels with plain-language direction hints (head space). */
const AXIS_OFFSET_LABELS: Record<(typeof AXES)[number], string> = {
  x: 'X · left/right',
  y: 'Y · up/down',
  z: 'Z · forward/back',
};

/** Rotation-axis labels with the same plain-language hint idiom. */
const AXIS_ROTATION_LABELS: Record<(typeof AXES)[number], string> = {
  x: 'X · tilt up/down',
  y: 'Y · turn left/right',
  z: 'Z · lean sideways',
};

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Collapsible dock section — the one header idiom every group in this panel
 * shares.
 *
 * It used to be a 10px label with a bare 14px glyph in front of it and a hairline
 * under the group, which made six categories read as one long undifferentiated
 * scroll: the host could not tell at a glance what the panel CONTAINED, only
 * what happened to be expanded. So each section is now a CARD — an icon in a
 * tinted chip, a larger title, an optional count/name chip, and a rotating
 * chevron on one 44px row — and the open one is tinted and accent-bordered, so
 * "where am I" is answerable from the corner of the eye. Expand/collapse still
 * animates height/opacity via the PickerDrawer motion idiom (a fixed-width
 * column, so no layout-critical width ever animates); prefers-reduced-motion
 * collapses instantly. Children mount only while open (progressive disclosure +
 * no hidden polling).
 */
function DockSection({
  icon: Icon,
  title,
  open,
  onToggle,
  help,
  badge,
  badgeTone = 'default',
  children,
}: {
  icon: LucideIcon;
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Feature-help topic — shows a small "?" affordance beside the title. */
  help?: FeatureHelpTopic;
  /** Right-aligned chip: a count, a cap, or the name of what the section is
   *  currently about. Answers "is there anything in here" without opening it. */
  badge?: ReactNode;
  badgeTone?: 'default' | 'warn';
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  // ReactNode legitimately includes false/null/undefined, so this is an explicit
  // absence test, never a truthiness test — a badge of "0/20" must still render.
  const hasBadge = badge !== undefined && badge !== null && badge !== false;
  return (
    <section
      className={cn(
        'rounded-2xl border transition-colors',
        open ? 'border-accent/25 bg-accent/[0.04]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14]',
      )}
    >
      <div className="flex items-center gap-0.5 pr-1.5">
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="group flex flex-1 min-w-0 items-center gap-2.5 min-h-11 pl-2 pr-1 text-left"
        >
          <span
            className={cn(
              'grid place-items-center w-7 h-7 shrink-0 rounded-lg transition-colors',
              open ? 'bg-accent/15 text-accent-2' : 'bg-white/[0.05] text-brand-muted/50 group-hover:text-brand-fg',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
          </span>
          {/* The TITLE never truncates and the badge always does. The title is
              the panel's navigation — losing it to "SELECTED I…" so a filter
              called "Golden Hour Bloom" could be spelled out in full is exactly
              backwards, and it happened on the first screenshot at 19rem. */}
          <span
            className={cn(
              'shrink-0 font-label uppercase tracking-widest text-xs transition-colors',
              open ? 'text-brand-fg' : 'text-brand-muted/70 group-hover:text-brand-fg',
            )}
          >
            {title}
          </span>
          {hasBadge && (
            <span
              className={cn(
                'ml-auto min-w-0 max-w-[7rem] truncate rounded-full px-1.5 py-0.5 font-mono text-[9px]',
                badgeTone === 'warn' ? 'bg-amber-400/12 text-amber-300' : 'bg-white/[0.06] text-brand-muted/60',
              )}
            >
              {badge}
            </span>
          )}
          {!hasBadge && <span className="flex-1" />}
          <ChevronDown
            className={cn('w-4 h-4 shrink-0 transition-transform', open ? 'text-accent-2' : 'text-brand-muted/40 -rotate-90')}
          />
        </button>
        {help && <HelpButton topic={help} label={`How ${title} works`} side="bottom" />}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pt-1 pb-3 flex flex-col gap-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * StudioSlider + a TYPED NUMERIC FIELD + a per-row reset affordance.
 *
 * The numeric field is the precision half: every property in this dock used to
 * be a slider only, so a host could not type "rotate 90" or "x = 0" — position
 * stepped 0.5% and rotation 1°, and exact values were a matter of nudging until
 * the readout looked right. The field validates against the SAME spec the slider
 * uses (controlSpecs stays the one source of bounds), so the two can never
 * disagree about what is allowed.
 */
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  defaultValue,
  numericLabel,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  defaultValue: number;
  /** Accessible name for the numeric field (the visible label may be a node). */
  numericLabel?: string;
}) {
  const atDefault = Math.abs(value - defaultValue) < step / 2;
  return (
    <div className="flex items-end gap-1.5">
      <div className="flex-1 min-w-0">
        <StudioSlider label={label} value={value} min={min} max={max} step={step} onChange={onChange} format={format} compact />
      </div>
      <NumberField
        value={value}
        min={min}
        max={max}
        step={step}
        onCommit={onChange}
        label={numericLabel ?? (typeof label === 'string' ? label : 'Value')}
      />
      <button
        onClick={() => onChange(defaultValue)}
        disabled={atDefault}
        aria-label="Reset to default"
        title="Reset to default"
        className="shrink-0 p-1 -mb-0.5 rounded text-brand-muted/40 hover:text-accent-2 transition-colors disabled:opacity-15 disabled:pointer-events-none"
      >
        <RotateCcw className="w-3 h-3" />
      </button>
    </div>
  );
}

/**
 * Align / centre actions for the selected overlay, plus rotation snapping.
 *
 * None of this existed: snapping caught only the object's own centre against
 * three fixed lines, and there was no way at all to say "centre this" or "make
 * that exactly 90°". The maths is pure and tested in lib/studio/align.ts.
 */
function AlignRow({
  transform,
  kind,
  onChange,
}: {
  transform: Transform2D;
  kind: 'border' | '2d_filter';
  onChange: (t: Transform2D) => void;
}) {
  const actions: { id: AlignAction; icon: LucideIcon; title: string }[] = [
    { id: 'left', icon: AlignStartVertical, title: 'Align to the left edge' },
    { id: 'centerH', icon: AlignCenterVertical, title: 'Centre horizontally' },
    { id: 'right', icon: AlignEndVertical, title: 'Align to the right edge' },
    { id: 'top', icon: AlignStartHorizontal, title: 'Align to the top edge' },
    { id: 'centerV', icon: AlignCenterHorizontal, title: 'Centre vertically' },
    { id: 'bottom', icon: AlignEndHorizontal, title: 'Align to the bottom edge' },
  ];
  const btn = 'flex items-center justify-center h-8 rounded-lg bg-white/[0.03] text-brand-muted/60 hover:text-brand-fg hover:bg-white/[0.07] transition-colors';
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>Align &amp; snap</SectionLabel>
      <div className="grid grid-cols-6 gap-1">
        {actions.map(({ id, icon: Icon, title }) => (
          <button key={id} onClick={() => onChange(alignTransform(transform, id, kind))} title={title} aria-label={title} className={btn}>
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1">
        <button
          onClick={() => onChange({ ...transform, rotation: stepRotation(transform.rotation, -1) })}
          title="Rotate to the previous 45°"
          aria-label="Rotate to the previous 45 degrees"
          className={btn}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onChange({ ...transform, rotation: snapRotation(transform.rotation, 180) })}
          title="Snap to the nearest 0 / 45 / 90°"
          className={`${btn} font-label text-[8px] uppercase tracking-widest`}
        >
          Snap
        </button>
        <button
          onClick={() => onChange({ ...transform, rotation: stepRotation(transform.rotation, 1) })}
          title="Rotate to the next 45°"
          aria-label="Rotate to the next 45 degrees"
          className={btn}
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

const ANIMATIONS: { id: LayerAnimation; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'float', label: 'Float' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'spin', label: 'Spin' },
];

/* The Frame · Stickers · 3D-pieces BUCKETS that used to live here are gone.
   They were a lie about paint order — see LayerList.tsx, which renders the one
   flat list the reducer actually reorders. Kind now rides as a per-row badge. */

/** 4-chip animation picker → SET_OBJECT_ANIMATION on the object. */
function AnimationChips({
  value,
  onChange,
}: {
  value: LayerAnimation;
  onChange: (a: LayerAnimation) => void;
}) {
  return (
    <div>
      <SectionLabel>Animation</SectionLabel>
      <div className="grid grid-cols-4 gap-1.5">
        {ANIMATIONS.map((a) => {
          const active = a.id === value;
          return (
            <button
              key={a.id}
              onClick={() => onChange(a.id)}
              className={`py-2 rounded-lg text-[9px] font-label uppercase tracking-widest transition-colors ${active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'}`}
            >
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Material finish (3D objects) ─────────────────────────────────────────
 * Most AI-generated and imported GLBs arrive as untuned grey plastic — Meshy
 * hands back metalness ~0 / roughness ~1 and a flat albedo. The jewelry builder
 * had had a metal picker since W7, but it was locked inside that dialog and only
 * ever styled geometry the builder itself extruded. This is the general control:
 * five finishes plus an optional colour wash, on ANY selected 3D object.
 *
 * Head pieces are excluded on purpose — they ship hand-authored materials
 * (HeadPieces.tsx) that a blanket "chrome" would flatten.
 */
const TINT_SWATCHES: readonly string[] = [
  '#d4a017', '#c8ccd0', '#d8927f', '#7df9ff',
  '#ff4fd8', '#5b8cff', '#3ddc84', '#ffffff',
];

function FinishControls({ object, dispatch }: { object: Object3D; dispatch: React.Dispatch<StudioAction> }) {
  const finish = normalizeFinish(object.finish);
  const tint = object.tint ?? null;
  // Absent strength means FULL — see finish.normalizeTintStrength; reading it
  // as 0 would make a freshly-picked colour do nothing at all.
  const strength = normalizeTintStrength(object.tintStrength);

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Finish</SectionLabel>
      <div className="grid grid-cols-3 gap-1.5">
        {FINISHES.map((f) => {
          const active = f.id === finish;
          return (
            <Tooltip key={f.id} label={f.label} hint={f.hint} side="left">
              <button
                onClick={() => dispatch({ type: 'SET_FINISH', finish: f.id as FinishId })}
                aria-pressed={active}
                className={`w-full py-2 rounded-lg text-[9px] font-label uppercase tracking-widest transition-colors ${active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'}`}
              >
                {f.label}
              </button>
            </Tooltip>
          );
        })}
      </div>

      <SectionLabel>Colour</SectionLabel>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* "None" first, and it is the only way back to the exported colour —
            a swatch grid with no clear is a one-way door. */}
        <button
          onClick={() => dispatch({ type: 'SET_FINISH', tint: null })}
          aria-pressed={tint === null}
          title="No colour — keep the model's own"
          className={`w-6 h-6 rounded-md grid place-items-center bg-white/[0.03] transition-colors ${tint === null ? 'ring-1 ring-accent/60' : 'ring-1 ring-white/10 hover:ring-white/25'}`}
        >
          <X className="w-3 h-3 text-brand-muted/60" />
        </button>
        {TINT_SWATCHES.map((hex) => (
          <button
            key={hex}
            onClick={() => dispatch({ type: 'SET_FINISH', tint: hex })}
            aria-pressed={tint === hex}
            title={hex}
            style={{ backgroundColor: hex }}
            className={`w-6 h-6 rounded-md transition-transform ${tint === hex ? 'ring-2 ring-accent scale-110' : 'ring-1 ring-white/15 hover:scale-105'}`}
          />
        ))}
        {/* Any colour at all, not just the eight — an event has brand colours. */}
        <label className="w-6 h-6 rounded-md ring-1 ring-white/15 overflow-hidden cursor-pointer relative" title="Custom colour">
          <span className="absolute inset-0 bg-[conic-gradient(from_0deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)]" />
          <input
            type="color"
            value={tint ?? '#ffffff'}
            onChange={(e) => dispatch({ type: 'SET_FINISH', tint: e.target.value })}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="Custom colour"
          />
        </label>
      </div>

      {/* Strength only matters once there IS a colour. */}
      {tint && (
        <SliderRow
          label="Colour strength"
          value={strength}
          min={FINISH_TINT_STRENGTH.min}
          max={FINISH_TINT_STRENGTH.max}
          step={FINISH_TINT_STRENGTH.step}
          defaultValue={FINISH_TINT_STRENGTH.max}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => dispatch({ type: 'SET_FINISH', tintStrength: v })}
        />
      )}
    </div>
  );
}

/* ── Per-asset personalisation (the configurator) ─────────────────────────
 *
 * Shown ONLY for a model that ships a template (assetTemplate.ts): the template
 * is the only thing that knows which parts of an opaque GLB may be recoloured
 * and where a name may be engraved. `normalizeTemplate` returns null for
 * anything it does not fully understand, so a missing or corrupt descriptor
 * simply hides this section — the asset stays exactly as it was exported.
 *
 * Built-in procedural head pieces are excluded by the SAME gate FinishControls
 * uses (`type === 'model'`): their materials are hand-authored in R3F and
 * genuinely cannot be recoloured.
 */
const NO_FINISH = '__none__';

/**
 * The ONE persistent studio camera element. StudioStage mounts it for the whole
 * studio session (`<video id="studio-video">`, never unmounted so the stream
 * survives 2D/3D/Preview switches), which is why "Match my outfit" can read a
 * live frame from any view without asking for the camera itself.
 */
const STUDIO_VIDEO_ID = 'studio-video';

/**
 * Width the camera frame is downsampled to before its pixels are read.
 *
 * 160px is far more than `dominantOutfitColor`'s 12x3x3 histogram needs to be
 * stable, and keeps the synchronous drawImage + getImageData well under a
 * millisecond — a full-resolution read of a 1080p frame is ~2M pixels and would
 * stall the live preview behind the dock for a visible beat.
 */
const OUTFIT_SAMPLE_W = 160;

/** True when a stored `parts` map is exactly what this colorway would produce. */
function partsMatchColorway(
  want: Record<string, AssetPartStyle>,
  have: Record<string, AssetPartStyle>,
): boolean {
  const ids = Object.keys(want);
  if (ids.length === 0 || ids.length !== Object.keys(have).length) return false;
  // `finish` is absent rather than 'original' on both sides (state.ts drops the
  // default), so absence has to compare equal to absence — not to undefined vs
  // a string, which is why both are coerced to null.
  return ids.every((id) =>
    have[id]?.hex === want[id].hex && (have[id]?.finish ?? null) === (want[id].finish ?? null));
}

/**
 * Read the dominant colour of what the host is wearing off the live camera.
 *
 * Returns the hex, or a short reason the host can act on — never a throw. The
 * <video> is CSS-mirrored (`scaleX(-1)`); `drawImage` reads the UNMIRRORED
 * source, which makes no difference to a centre-weighted colour histogram.
 */
function sampleOutfitColor(): { hex: string } | { reason: string } {
  const video = document.getElementById(STUDIO_VIDEO_ID);
  if (!(video instanceof HTMLVideoElement)) {
    return { reason: 'The studio camera isn’t running — open the 3D or Preview view first.' };
  }
  if (!video.videoWidth || !video.videoHeight) {
    return { reason: 'The camera hasn’t sent a frame yet. Give it a second and try again.' };
  }
  const w = Math.min(OUTFIT_SAMPLE_W, video.videoWidth);
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { reason: 'This browser wouldn’t give us a canvas to read the frame with.' };
    ctx.drawImage(video, 0, 0, w, h);
    const hex = dominantOutfitColor(ctx.getImageData(0, 0, w, h).data, w, h);
    return hex
      ? { hex }
      : { reason: 'Couldn’t find a colour in that frame — step into the light and try again.' };
  } catch {
    // getImageData throws SecurityError on a tainted canvas, and drawImage
    // throws on a frame that is not decodable yet. Both are "try again".
    return { reason: 'Couldn’t read that frame. Try again in a moment.' };
  }
}

function RegionRow({
  region,
  style,
  dispatch,
}: {
  region: AssetRegion;
  style: AssetPartStyle | undefined;
  dispatch: React.Dispatch<StudioAction>;
}) {
  const hex = style?.hex ?? region.defaultHex;
  const styled = !!style?.hex || !!style?.finish;
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex-1 min-w-0 truncate text-[11px] text-brand-fg">{region.label}</span>
      <label className="w-6 h-6 shrink-0 rounded-md ring-1 ring-white/15 overflow-hidden cursor-pointer relative" title={`Colour · ${region.label}`}>
        <span className="absolute inset-0" style={{ backgroundColor: hex }} />
        <input
          type="color"
          value={hex}
          onChange={(e) => dispatch({ type: 'SET_CUSTOMIZATION', part: { id: region.id, hex: e.target.value } })}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={`Colour for ${region.label}`}
        />
      </label>
      <select
        value={style?.finish ?? NO_FINISH}
        onChange={(e) => dispatch({
          type: 'SET_CUSTOMIZATION',
          part: { id: region.id, finish: e.target.value === NO_FINISH ? null : e.target.value },
        })}
        aria-label={`Finish for ${region.label}`}
        title={`Finish · ${region.label} — how the surface catches light`}
        className="shrink-0 w-[86px] bg-white/[0.04] border border-white/10 rounded-lg px-1.5 py-1 text-[10px] text-brand-fg focus:outline-none focus:border-accent/40"
      >
        <option value={NO_FINISH}>As made</option>
        {FINISHES.filter((f) => f.id !== 'original').map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      <button
        onClick={() => dispatch({ type: 'SET_CUSTOMIZATION', part: { id: region.id, hex: null, finish: null } })}
        disabled={!styled}
        aria-label={`Reset ${region.label}`}
        title="Back to how it was made"
        className="shrink-0 p-1 rounded text-brand-muted/40 hover:text-accent-2 transition-colors disabled:opacity-15 disabled:pointer-events-none"
      >
        <RotateCcw className="w-3 h-3" />
      </button>
      {/* Guest colour opt-in: a swatch row appears in the booth for this
          region; the host's colour above stays the default. */}
      <button
        onClick={() => dispatch({ type: 'SET_TEMPLATE_GUEST_PICK', regionId: region.id, on: region.guestPick !== true })}
        aria-pressed={region.guestPick === true}
        aria-label={`Guests can pick the ${region.label} colour`}
        title={region.guestPick === true ? 'Guests can pick this colour in the booth — tap to lock' : 'Let guests pick this colour in the booth'}
        className={`shrink-0 p-1 rounded transition-colors ${region.guestPick === true ? 'text-accent-2' : 'text-brand-muted/30 hover:text-brand-fg'}`}
      >
        <Users className="w-3 h-3" />
      </button>
    </div>
  );
}

/**
 * Delay between the last keystroke and the dispatch that rebuilds the decal.
 *
 * MEASURED, not guessed: `BuiltLabelDecal.buildMs` reports 45-46 ms for a carve
 * on the 30k-triangle reference mesh, and DecalGeometry is O(triangles) with no
 * acceleration structure, so every keystroke is a synchronous main-thread stall
 * of that size. Live-ish typing is affordable at 46 ms; a rebuild PER keystroke
 * at typing speed is not, because they queue behind each other and the field
 * starts dropping characters. 220 ms is longer than the gap inside a word and
 * shorter than the pause between words, so the preview lands as the host stops.
 */
const LABEL_TEXT_DEBOUNCE_MS = 220;

/**
 * A text field that keeps up with typing while its consumer does not.
 *
 * Local state owns the keystrokes; the commit is trailing-debounced and FLUSHED
 * on blur and on unmount, so a host who types a name and immediately clicks away
 * (or closes the panel) still gets what they typed. `value` re-seeds the field
 * only when it changes from OUTSIDE — without that check, the debounced commit
 * echoing back would fight the cursor.
 */
function DebouncedTextInput({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (next: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const external = useRef(value);

  useEffect(() => {
    if (value === external.current) return;
    external.current = value;
    setLocal(value);
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    external.current = next;
    commitRef.current(next);
  }, []);

  // Unmount is a flush, not a cancel: closing the dock must not silently discard
  // the last word the host typed.
  useEffect(() => flush, [flush]);

  return (
    <input
      {...rest}
      type="text"
      value={local}
      onChange={(e) => {
        const next = e.target.value;
        setLocal(next);
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, LABEL_TEXT_DEBOUNCE_MS);
      }}
      onBlur={flush}
    />
  );
}

function AssetPersonalisation({ object, dispatch }: { object: Object3D; dispatch: React.Dispatch<StudioAction> }) {
  // Templates arrive as untrusted jsonb (they round-trip through the
  // experience's config), so they are validated on every read, never trusted.
  const template = useMemo(() => normalizeTemplate(object.template), [object.template]);

  /**
   * The editor's own echo of the label — and it is not redundant state.
   *
   * A 'fixed' engraving with no text NORMALIZES AWAY: state.ts `normalizeLabel`
   * drops it, on the same rule letteringFit applies to 2D lettering ("an
   * engraving with nothing to say is the same as no engraving"). That is right
   * for storage and wrong for an editor. Turning OFF "use each guest's own name"
   * sets `token: 'fixed'` with no text yet, so the stored label vanished and
   * took the whole section with it — the host could SEE the switch but could
   * never reach the text field behind it. Verified in the browser at 1440x900
   * and 390x844 before this echo existed.
   *
   * So the UI renders from `label ?? echo`, and the echo is cleared the moment
   * a real stored label exists again. Nothing extra is ever persisted: the
   * dispatch is unchanged and the normalizer still owns what gets written.
   *
   * ABOVE the `isConfigurable` guard, deliberately — hooks may not sit after an
   * early return, and this repo has already shipped one hooks-order crash.
   */
  const [echo, setEcho] = useState<AssetLabelConfig | null>(null);
  const storedLabel = object.customization?.label;
  useEffect(() => { if (storedLabel) setEcho(null); }, [storedLabel]);

  /**
   * What the last "Match my outfit" read, and what it dressed the piece in —
   * kept so the host can SEE the two colours the feature chose. Same
   * hooks-above-the-early-return rule as `echo` above.
   */
  const [matched, setMatched] = useState<{ outfit: string; body: string } | null>(null);
  /** A quiet, actionable one-liner when there was no frame to read. */
  const [matchHint, setMatchHint] = useState<string | null>(null);

  if (!template || !isConfigurable(template)) return null;

  const custom = object.customization;
  const parts = custom?.parts ?? {};
  const recolourable = template.regions.filter((r) => r.recolourable);
  const slots = template.textSlots;
  const label = storedLabel ?? echo ?? undefined;
  const slot = label ? slots.find((s) => s.id === label.slotId) ?? slots[0] : slots[0];
  const selectCls = 'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-brand-fg focus:outline-none focus:border-accent/40';

  const setLabel = (p: Partial<AssetLabelConfig>) => {
    if (!slot) return;
    const next: AssetLabelConfig = {
      slotId: label?.slotId ?? slot.id,
      token: label?.token ?? 'guestName',
      style: label?.style ?? 'script',
      hex: label?.hex ?? DEFAULT_LETTERING_COLOR,
      ...(label?.text ? { text: label.text } : {}),
      ...p,
    };
    setEcho(next);
    dispatch({ type: 'SET_CUSTOMIZATION', label: next });
  };

  const clearLabel = () => {
    setEcho(null);
    dispatch({ type: 'SET_CUSTOMIZATION', label: null });
  };

  /**
   * Apply a whole scheme, ONE region per dispatch.
   *
   * That is the reducer's own shape — `withCustomization` merges a single
   * `part` at a time — so no new action variant is needed and every existing
   * test of SET_CUSTOMIZATION still describes what happens here.
   *
   * `?? null` on both fields is the explicit CLEAR, and it is load-bearing:
   * moving from a gold-accent scheme to a plain one must DROP the gold, and
   * `undefined` means "leave it" (state.ts:374).
   */
  const applyParts = (next: Record<string, AssetPartStyle>) => {
    for (const id of Object.keys(next)) {
      dispatch({
        type: 'SET_CUSTOMIZATION',
        part: { id, hex: next[id].hex ?? null, finish: next[id].finish ?? null },
      });
    }
  };

  const applyColorway = (cw: Colorway) => {
    setMatched(null);
    setMatchHint(null);
    applyParts(colorwayParts(cw, template));
  };

  const matchOutfit = () => {
    const read = sampleOutfitColor();
    if ('reason' in read) {
      setMatched(null);
      setMatchHint(read.reason);
      return;
    }
    const cw = outfitColorway(read.hex);
    applyParts(colorwayParts(cw, template));
    setMatched({ outfit: read.hex, body: cw.styles.primary.hex });
    setMatchHint(null);
  };

  // Which shipped scheme, if any, the piece is currently wearing — so a chip
  // reads as selected instead of every chip looking equally untouched.
  const activeColorwayId =
    COLORWAYS.find((cw) => partsMatchColorway(colorwayParts(cw, template), parts))?.id ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 pt-1">
        <Palette className="w-3.5 h-3.5 text-accent-2" />
        <span className="font-label uppercase tracking-widest text-[9px] text-accent-2">Personalise</span>
        <Tooltip
          label={template.name}
          hint={
            template.preparedBy === 'auto'
              ? 'This asset’s parts were detected automatically and nobody has checked them — treat the regions below as a starting point.'
              : 'This asset ships with an authored map of which parts recolour and where a name is engraved.'
          }
          side="left"
        >
          <span className="ml-auto text-brand-muted/50 cursor-help text-[10px]">?</span>
        </Tooltip>
      </div>
      <p className="font-sans text-[10px] leading-relaxed text-brand-muted/50 -mt-1">
        Recolour this piece and put a name on it. Everything here shows up in the guest{'’'}s photo and video, not just in this preview.
      </p>
      {recolourable.length > 0 && (
        <>
          {/* One-tap schemes FIRST, per-part rows after: a host who just wants
              it to look good is done in one click, and the rows below are then
              a refinement of something rather than a blank slate. Roles are
              resolved against this template's own regions (colorways.ts), so
              the same eight chips work for every future asset. */}
          <SectionLabel>Colourways</SectionLabel>
          <p className="font-sans text-[10px] leading-relaxed text-brand-muted/50 -mt-1 mb-1.5">
            One tap dresses the whole piece — body, trim and details together.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {COLORWAYS.map((cw) => {
              const active = cw.id === activeColorwayId;
              return (
                <button
                  key={cw.id}
                  onClick={() => applyColorway(cw)}
                  aria-pressed={active}
                  title={`${cw.name} — recolours every part of this piece`}
                  className={`w-full flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 transition-colors motion-reduce:transition-none ${
                    active ? 'bg-accent/15 ring-1 ring-accent/30' : 'bg-white/[0.03] hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="shrink-0 w-7 h-4 rounded-[3px] overflow-hidden flex ring-1 ring-white/10">
                    {COLORWAY_ROLES.map((role) => (
                      <span key={role} className="flex-1" style={{ backgroundColor: cw.styles[role].hex }} />
                    ))}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-left text-[10px] ${active ? 'text-accent-2' : 'text-brand-muted/60'}`}>
                    {cw.name}
                  </span>
                </button>
              );
            })}
          </div>

          {/* THE ONE THAT IS NOT A LIST ITEM. Same accented-card idiom as the
              "use each guest's own name" headline below — a control nobody has
              seen in a photo booth before does not belong in a row of chips. */}
          <div className="rounded-xl border border-accent/30 bg-accent/[0.07] p-3 flex flex-col gap-2 mt-0.5">
            <button
              onClick={matchOutfit}
              title="Reads the live camera frame and dresses this piece to go with what you're wearing"
              className="flex items-center justify-center gap-2 w-full rounded-lg px-2.5 py-2 bg-accent/15 text-accent-2 ring-1 ring-accent/30 hover:bg-accent/25 transition-colors motion-reduce:transition-none"
            >
              <Wand2 className="w-3.5 h-3.5 shrink-0" />
              <span className="font-label uppercase tracking-widest text-[10px]">Match my outfit</span>
            </button>
            <p className="font-sans text-[10px] leading-relaxed text-brand-muted/60">
              {matched
                ? 'The trim and details take your outfit’s colour; the body takes a companion shade, so the piece still reads against you instead of disappearing into you.'
                : 'Reads what you’re wearing from the live camera and dresses this piece to go with it.'}
            </p>
            {matched && (
              <div className="flex items-center gap-1.5">
                <span
                  className="w-5 h-5 shrink-0 rounded-md ring-1 ring-white/15"
                  style={{ backgroundColor: matched.outfit }}
                  title={`Your outfit · ${matched.outfit}`}
                />
                <span
                  className="w-5 h-5 shrink-0 rounded-md ring-1 ring-white/15"
                  style={{ backgroundColor: matched.body }}
                  title={`The piece · ${matched.body}`}
                />
                <span className="min-w-0 truncate text-[10px] text-accent-2">Matched to your outfit</span>
              </div>
            )}
            {matchHint && (
              <p className="font-sans text-[10px] leading-relaxed text-brand-muted/50">{matchHint}</p>
            )}
          </div>

          <SectionLabel>Colours</SectionLabel>
          <p className="font-sans text-[10px] leading-relaxed text-brand-muted/50 -mt-1 mb-1.5">
            One row per part. Tap the swatch to recolour it, then pick a finish —
            {' '}“As made” leaves that part exactly as it was built.
          </p>
          <div className="flex flex-col gap-1.5">
            {recolourable.map((r) => (
              <RegionRow key={r.id} region={r} style={parts[r.id]} dispatch={dispatch} />
            ))}
          </div>
        </>
      )}

      {slots.length > 0 && (
        <>
          <SectionLabel>Engraved name</SectionLabel>
          <StudioToggle
            label="Engrave a name"
            hint="Cuts a name into the asset itself — in this studio, in the preview, in the guest's photo and video."
            value={!!label}
            onChange={(on) => (on ? setLabel({}) : clearLabel())}
          />
          {label && slot && (
            <div className="flex flex-col gap-2">
              {slots.length > 1 && (
                <div>
                  <SectionLabel>Where on the piece</SectionLabel>
                  <select value={label.slotId} onChange={(e) => setLabel({ slotId: e.target.value })} className={selectCls} aria-label="Engraving position" title="Which surface of this piece the name is cut into">
                    {slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              )}
              {/* THE HEADLINE. A per-guest 3D name is a thing no host has seen
                  before, so this is not a bare switch in a list of switches: it
                  gets its own accented card and says, in words, what each guest
                  will actually get. Same idiom as the Lighting block above —
                  accent-tinted rounded panel, semantic tokens only. */}
              <div className={`rounded-xl border p-3 flex flex-col gap-2 transition-colors ${
                label.token === 'guestName' ? 'border-accent/30 bg-accent/[0.07]' : 'border-white/10 bg-white/[0.02]'
              }`}>
                <StudioToggle
                  label="Use each guest's own name"
                  hint={`Every guest who gives their name gets it engraved on their own copy of this piece — in the booth, in their photo and in their video. Here it previews as “${STUDIO_SAMPLE_GUEST_NAME}”.`}
                  value={label.token === 'guestName'}
                  onChange={(on) => setLabel({ token: on ? 'guestName' : 'fixed' })}
                />
                <p className="font-sans text-[10px] leading-relaxed text-brand-muted/60">
                  {label.token === 'guestName' ? (
                    <>
                      Each guest sees <span className="text-brand-fg">their own name</span> on this
                      piece. You are previewing “{STUDIO_SAMPLE_GUEST_NAME}”. A guest who skips the
                      name prompt simply gets no engraving — never someone else’s name.
                    </>
                  ) : (
                    <>Everyone gets the same line, exactly as you type it below.</>
                  )}
                </p>
              </div>
              {label.token === 'fixed' && (
                <div>
                  <SectionLabel>The line to engrave</SectionLabel>
                  <DebouncedTextInput
                    value={label.text ?? ''}
                    onCommit={(text) => setLabel({ text })}
                    placeholder="e.g. Tolu — or “Class of 2026”"
                    maxLength={ASSET_CUSTOMIZATION.maxLabelLength}
                    aria-label="Engraved text"
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.03] text-sm text-brand-fg placeholder:text-brand-muted/30 focus:outline-none focus:ring-1 focus:ring-accent/30"
                  />
                  <p className="font-sans text-[10px] leading-relaxed text-brand-muted/50 mt-1">
                    Up to {ASSET_CUSTOMIZATION.maxLabelLength} characters. Every guest gets this same line.
                  </p>
                </div>
              )}
              <div>
                <SectionLabel>Lettering style</SectionLabel>
                <select value={label.style} onChange={(e) => setLabel({ style: e.target.value as GuestLetteringStyle })} className={selectCls} aria-label="Engraving style">
                  {LETTERING_STYLE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <SectionLabel>Engraving colour</SectionLabel>
                <input
                  type="color"
                  value={label.hex}
                  onChange={(e) => setLabel({ hex: e.target.value })}
                  aria-label="Engraving colour"
                  title="Colour of the engraved letters"
                  className="w-full h-8 rounded-lg bg-white/[0.04] border border-white/10 cursor-pointer"
                />
                <p className="font-sans text-[10px] leading-relaxed text-brand-muted/50 mt-1">
                  Pick a shade that contrasts with the part underneath — the default white
                  disappears on a pale surface.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Event lighting (shared by every 3D surface) ──────────────────────────
 * One rig for the booth, both studio 3D views, the preview and the jewelry
 * builder. It is an EVENT setting, not a per-object one: a scene lit two ways
 * at once is just a bug, and the guest's photo can only have one answer.
 */
function LightingPicker({ value, onChange }: { value: LightingPresetId; onChange: (v: LightingPresetId) => void }) {
  const hint = HOST_LIGHTING_PRESETS.find((p) => p.id === value)?.hint ?? '';
  return (
    <div className="rounded-xl border border-accent/15 bg-accent/[0.05] p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-accent-2" />
        <span className="font-label uppercase tracking-widest text-[9px] text-accent-2">Lighting</span>
        <Tooltip label="Lighting" hint="Lights every 3D piece — in this studio, in the preview and in the guest booth. Metal, glass and gems take their look from it." side="left">
          <span className="ml-auto text-brand-muted/50 cursor-help text-[10px]">?</span>
        </Tooltip>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {HOST_LIGHTING_PRESETS.map((p) => {
          const active = p.id === value;
          return (
            <button
              key={p.id}
              onClick={() => onChange(p.id)}
              aria-pressed={active}
              className={`py-2 rounded-lg text-[9px] font-label uppercase tracking-widest transition-colors ${active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <p className="font-sans text-[9px] text-brand-muted/50 leading-relaxed">{hint} Saved per event.</p>
    </div>
  );
}

/* ── Guest-name lettering (the free, live personalisation) ────────────────
 * Turning this on makes the booth draw the GUEST'S OWN NAME over the frame —
 * in the preview, the photo and the recorded video. Off (the default, and
 * every scene that predates it) writes no config key and changes nothing. */

const LETTERING_STYLE_OPTIONS: { id: GuestLetteringStyle; label: string }[] = [
  { id: 'script', label: 'Script' },
  { id: 'serif', label: 'Serif' },
  { id: 'block', label: 'Block' },
  { id: 'label', label: 'Label caps' },
];

/** What a freshly-enabled toggle stores — the guest's name, white, bottom. */
const DEFAULT_GUEST_LETTERING: GuestLetteringConfig = {
  token: 'guestName',
  style: 'script',
  color: DEFAULT_LETTERING_COLOR,
  placement: 'bottom',
};

function GuestLetteringControls({
  value,
  onChange,
}: {
  value: GuestLetteringConfig | undefined;
  onChange: (v: GuestLetteringConfig | undefined) => void;
}) {
  const selectCls = 'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-brand-fg focus:outline-none focus:border-accent/40';
  const on = !!value;
  const cfg = value ?? DEFAULT_GUEST_LETTERING;
  const patch = (p: Partial<GuestLetteringConfig>) => onChange({ ...cfg, ...p });
  return (
    <div className="flex flex-col gap-2">
      <StudioToggle
        label="Guest name lettering"
        hint="Each guest's own name is drawn onto this frame — in the preview, the photo and the video."
        value={on}
        onChange={(v) => onChange(v ? { ...DEFAULT_GUEST_LETTERING } : undefined)}
      />
      {on && (
        <div className="flex flex-col gap-2">
          <div>
            <SectionLabel>Style</SectionLabel>
            <select value={cfg.style} onChange={(e) => patch({ style: e.target.value as GuestLetteringStyle })} className={selectCls}>
              {LETTERING_STYLE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Position</SectionLabel>
            <select value={cfg.placement} onChange={(e) => patch({ placement: e.target.value as 'top' | 'bottom' })} className={selectCls}>
              <option value="bottom">Bottom of the frame</option>
              <option value="top">Top of the frame</option>
            </select>
          </div>
          <div>
            <SectionLabel>Colour</SectionLabel>
            <input
              type="color"
              value={cfg.color}
              onChange={(e) => patch({ color: e.target.value })}
              aria-label="Lettering colour"
              className="w-full h-8 rounded-lg bg-white/[0.04] border border-white/10 cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* The "EDITING · <name>" caption that used to head every properties block is
   gone. The Selected-item section header now carries that name as its badge, so
   the caption repeated it one line lower — and for the filter slot it repeated
   a name the body prints again two lines further down. */

/* — Magic Triggers (face-triggered effects) --------------------------------- */

const SOURCE_ICON: Record<TriggerSource, LucideIcon> = {
  smile: Smile,
  mouthOpen: Laugh,
  wink: Eye,
  browRaise: ArrowBigUp,
  fistClench: HandFist,
  palmOpen: Hand,
  pinch: Grab,
  peaceSign: HandMetal,
  handToTemple: ScanFace,
};

type NewActionType = 'burst' | 'beam' | 'reveal' | 'animate' | 'filterPulse';
const ACTION_CHOICES: { id: NewActionType; label: string; icon: LucideIcon }[] = [
  { id: 'burst', label: 'Burst', icon: PartyPopper },
  { id: 'beam', label: 'Blast', icon: Zap },
  { id: 'reveal', label: 'Reveal', icon: Wand2 },
  { id: 'animate', label: 'Animate', icon: Clapperboard },
  { id: 'filterPulse', label: 'Filter', icon: Palette },
];

function newTriggerId(): string {
  return `trg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function triggerActionLabel(
  a: TriggerAction,
  pieceName: (id: string) => string,
  shaderName: (id: string) => string,
): string {
  if (a.type === 'burst') return `${BURST_STYLE_LABELS[a.style]} burst`;
  if (a.type === 'reveal') return `Reveal ${pieceName(a.objectId)}`;
  if (a.type === 'beam') return BEAM_STYLE_LABELS[a.style];
  if (a.type === 'animate') return `${ANIMATE_PRESET_LABELS[a.preset]} ${pieceName(a.objectId)}`;
  return `${a.shaderId ? shaderName(a.shaderId) : 'Filter'} pulse`;
}

/**
 * Scene-level face-triggered effects. Lists existing triggers (source icon +
 * "Smile → Confetti burst" + remove) and an add flow: pick a face source, an
 * action, and its parameter. Reveal targets a current scene piece by name;
 * Filter pulse picks from FILTER_SHADERS (defaulting to the scene's ambient).
 */
function MagicTriggers({
  draft,
  dispatch,
  pieceName,
  ambientShaderId,
}: {
  draft: StudioDraft;
  dispatch: React.Dispatch<StudioAction>;
  pieceName: (id: string) => string;
  ambientShaderId: string | null;
}) {
  const defaultFilter = ambientShaderId && ambientShaderId !== 'none' ? ambientShaderId : FILTER_SHADERS[0]?.id ?? '';
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState<TriggerSource>('smile');
  const [actionType, setActionType] = useState<NewActionType>('burst');
  const [burstStyle, setBurstStyle] = useState<BurstStyle>('confetti');
  const [beamStyle, setBeamStyle] = useState<BeamStyle>('optic');
  const [beamColorMode, setBeamColorMode] = useState<'auto' | 'custom'>('auto');
  const [beamHex, setBeamHex] = useState<string>('#ff2b4a');
  const [beamEmitterId, setBeamEmitterId] = useState<string>('');
  const [animatePreset, setAnimatePreset] = useState<AnimatePreset>('shake');
  const [animateId, setAnimateId] = useState<string>('');
  const [revealId, setRevealId] = useState<string>('');
  const [filterId, setFilterId] = useState<string>(defaultFilter);

  const pieces = draft.objects;
  const atCap = draft.triggers.length >= MAX_TRIGGERS;
  const shaderName = (id: string) => SHADER_MAP[id]?.name ?? id;

  const resetForm = () => {
    setAdding(false);
    setSource('smile');
    setActionType('burst');
    setBurstStyle('confetti');
    setBeamStyle('optic');
    setBeamColorMode('auto');
    setBeamHex('#ff2b4a');
    setBeamEmitterId('');
    setAnimatePreset('shake');
    setAnimateId('');
    setRevealId('');
    setFilterId(defaultFilter);
  };

  // The action the form would commit — mirrors the branch logic in commit() so we
  // can block an EXACT duplicate (same source + action type + style/target/shader)
  // before dispatch. null when the form can't yet commit (reveal with no piece).
  const pendingAction = useMemo<TriggerAction | null>(() => {
    if (actionType === 'burst') return { type: 'burst', style: burstStyle };
    if (actionType === 'beam') {
      const act: Extract<TriggerAction, { type: 'beam' }> = {
        type: 'beam',
        style: beamStyle,
        color: beamColorMode === 'custom' ? beamHex : 'auto',
      };
      if (beamEmitterId !== '') act.objectId = beamEmitterId;
      return act;
    }
    if (actionType === 'reveal') {
      const target = revealId || pieces[0]?.id;
      return target ? { type: 'reveal', objectId: target } : null;
    }
    if (actionType === 'animate') {
      const target = animateId || pieces[0]?.id;
      return target ? { type: 'animate', objectId: target, preset: animatePreset } : null;
    }
    return filterId ? { type: 'filterPulse', shaderId: filterId } : { type: 'filterPulse' };
  }, [actionType, burstStyle, beamStyle, beamColorMode, beamHex, beamEmitterId, animatePreset, animateId, revealId, filterId, pieces]);

  const sameAction = (a: TriggerAction, b: TriggerAction): boolean => {
    if (a.type !== b.type) return false;
    if (a.type === 'burst' && b.type === 'burst') return a.style === b.style;
    if (a.type === 'beam' && b.type === 'beam') {
      return a.style === b.style && (a.color ?? 'auto') === (b.color ?? 'auto') && (a.objectId ?? '') === (b.objectId ?? '');
    }
    if (a.type === 'reveal' && b.type === 'reveal') return a.objectId === b.objectId;
    if (a.type === 'animate' && b.type === 'animate') return a.objectId === b.objectId && a.preset === b.preset;
    if (a.type === 'filterPulse' && b.type === 'filterPulse') return (a.shaderId ?? '') === (b.shaderId ?? '');
    return false;
  };
  const isDuplicate = !!pendingAction && draft.triggers.some(
    (t) => t.source === source && sameAction(t.action, pendingAction),
  );

  const commit = () => {
    if (!pendingAction || isDuplicate) return;
    dispatch({ type: 'ADD_TRIGGER', trigger: { id: newTriggerId(), source, action: pendingAction } });
    resetForm();
  };

  const chip = (active: boolean) =>
    `flex flex-col items-center gap-1 py-2 rounded-lg text-[8px] font-label uppercase tracking-wide transition-colors ${
      active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'
    }`;
  const selectCls = 'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-brand-fg focus:outline-none focus:border-accent/40';

  return (
    <div>
      {/* No count row here: the section header's badge carries it, so an inner
          one was the same number twice, 20px apart. */}
      {draft.triggers.length > 0 ? (
        <ul className="flex flex-col gap-1 mb-2">
          {draft.triggers.map((t) => {
            const Icon = SOURCE_ICON[t.source];
            return (
              <li key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-white/[0.03]">
                <Icon className="w-3.5 h-3.5 shrink-0 text-accent-2" />
                <span className="text-[11px] font-sans truncate flex-1 min-w-0 text-brand-muted/80">
                  {TRIGGER_SOURCE_LABELS[t.source]} → {triggerActionLabel(t.action, pieceName, shaderName)}
                </span>
                <button
                  onClick={() => dispatch({ type: 'REMOVE_TRIGGER', id: t.id })}
                  aria-label="Remove trigger"
                  className="p-0.5 rounded text-brand-muted/40 hover:text-rose-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[10px] text-brand-muted/40 font-sans mb-2 px-1">
          Guests set off effects with a face or a hand — smile, wink, clench a fist, open a palm.
        </p>
      )}

      {adding ? (
        <div className="rounded-xl border border-accent/15 bg-accent/[0.05] p-3 flex flex-col gap-3">
          <div>
            <SectionLabel>When guest…</SectionLabel>
            <p className="text-[8px] font-label uppercase tracking-widest text-brand-muted/35 mb-1">Face</p>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {FACE_TRIGGER_SOURCES.map((s) => {
                const Icon = SOURCE_ICON[s];
                return (
                  <button key={s} onClick={() => setSource(s)} title={TRIGGER_SOURCE_LABELS[s]} className={chip(s === source)}>
                    <Icon className="w-4 h-4" />
                    <span className="text-center leading-tight">{TRIGGER_SOURCE_LABELS[s]}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[8px] font-label uppercase tracking-widest text-brand-muted/35 mb-1">Hands</p>
            <div className="grid grid-cols-4 gap-1.5">
              {HAND_TRIGGER_SOURCES.map((s) => {
                const Icon = SOURCE_ICON[s];
                return (
                  <button key={s} onClick={() => setSource(s)} title={TRIGGER_SOURCE_LABELS[s]} className={chip(s === source)}>
                    <Icon className="w-4 h-4" />
                    <span className="text-center leading-tight">{TRIGGER_SOURCE_LABELS[s]}</span>
                  </button>
                );
              })}
            </div>
            {/* The exact hint the guest will read in the booth for this source. */}
            <p className="text-[9px] text-brand-muted/45 font-sans mt-1.5">Guest sees: “{TRIGGER_HINT_LABELS[source]}”</p>
          </div>

          <div>
            <SectionLabel>Do…</SectionLabel>
            <div className="grid grid-cols-5 gap-1.5">
              {ACTION_CHOICES.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setActionType(id)} className={chip(id === actionType)}>
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {actionType === 'burst' && (
            <div>
              <SectionLabel>Style</SectionLabel>
              <div className="grid grid-cols-4 gap-1.5">
                {BURST_STYLES.map((st) => (
                  <button key={st} onClick={() => setBurstStyle(st)} className={chip(st === burstStyle)}>
                    <span className="text-center leading-tight">{BURST_STYLE_LABELS[st]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {actionType === 'beam' && (
            <>
              <div>
                <SectionLabel>Blast style</SectionLabel>
                <div className="grid grid-cols-4 gap-1.5">
                  {BEAM_STYLES.map((st) => (
                    <button key={st} onClick={() => setBeamStyle(st)} className={chip(st === beamStyle)}>
                      <span className="text-center leading-tight">{BEAM_STYLE_LABELS[st]}</span>
                    </button>
                  ))}
                </div>
              </div>
              {pieces.length > 0 && (
                <div>
                  <SectionLabel>Fires from</SectionLabel>
                  <select value={beamEmitterId} onChange={(e) => setBeamEmitterId(e.target.value)} className={selectCls}>
                    <option value="" className="bg-noir-900">Scene default</option>
                    {pieces.map((o) => (
                      <option key={o.id} value={o.id} className="bg-noir-900">{pieceName(o.id)}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <SectionLabel>Colour</SectionLabel>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setBeamColorMode('auto')} className={`${chip(beamColorMode === 'auto')} flex-1`}>
                    <span>Match the piece</span>
                  </button>
                  <button onClick={() => setBeamColorMode('custom')} className={`${chip(beamColorMode === 'custom')} flex-1`}>
                    <span>Override</span>
                  </button>
                  {beamColorMode === 'custom' && (
                    <input
                      type="color"
                      value={beamHex}
                      onChange={(e) => setBeamHex(e.target.value)}
                      aria-label="Blast colour"
                      className="w-9 h-9 rounded-lg bg-transparent border border-white/10 cursor-pointer shrink-0"
                    />
                  )}
                </div>
                {beamColorMode === 'auto' && (
                  <p className="text-[9px] text-brand-muted/40 font-sans mt-1">Follows the piece's lens colour — including a guest's pick.</p>
                )}
              </div>
            </>
          )}

          {actionType === 'animate' && (
            <div>
              <SectionLabel>Animate which piece</SectionLabel>
              {pieces.length > 0 ? (
                <>
                  <select value={animateId || pieces[0].id} onChange={(e) => setAnimateId(e.target.value)} className={selectCls}>
                    {pieces.map((o) => (
                      <option key={o.id} value={o.id} className="bg-noir-900">{pieceName(o.id)}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {ANIMATE_PRESETS.map((p) => (
                      <button key={p} onClick={() => setAnimatePreset(p)} className={chip(p === animatePreset)}>
                        <span>{ANIMATE_PRESET_LABELS[p]}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-[10px] text-brand-muted/40 font-sans">Add a scene piece first — the gesture plays a one-shot animation on it.</p>
              )}
            </div>
          )}

          {actionType === 'reveal' && (
            <div>
              <SectionLabel>Reveal which piece</SectionLabel>
              {pieces.length > 0 ? (
                <select value={revealId || pieces[0].id} onChange={(e) => setRevealId(e.target.value)} className={selectCls}>
                  {pieces.map((o) => (
                    <option key={o.id} value={o.id} className="bg-noir-900">{pieceName(o.id)}</option>
                  ))}
                </select>
              ) : (
                <p className="text-[10px] text-brand-muted/40 font-sans">Add a scene piece first — reveal keeps it hidden until the trigger fires.</p>
              )}
            </div>
          )}

          {actionType === 'filterPulse' && (
            <div>
              <SectionLabel>Filter</SectionLabel>
              <select value={filterId} onChange={(e) => setFilterId(e.target.value)} className={selectCls}>
                {FILTER_SHADERS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-noir-900">{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {isDuplicate && (
            <p className="text-[9px] text-brand-muted/50 font-sans -mt-1">This exact trigger is already added.</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={commit}
              disabled={((actionType === 'reveal' || actionType === 'animate') && pieces.length === 0) || isDuplicate}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-label uppercase tracking-widest bg-accent/15 text-accent-2 ring-1 ring-accent/30 hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <Check className="w-3.5 h-3.5" /> Add
            </button>
            <button onClick={resetForm} className="px-3 py-2 rounded-xl text-[10px] font-label uppercase tracking-widest bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        !atCap && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-label uppercase tracking-widest bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add trigger
          </button>
        )
      )}
      {atCap && !adding && <p className="text-[9px] text-brand-muted/40 font-sans mt-1">Up to {MAX_TRIGGERS} triggers per scene.</p>}
      <p className="text-[9px] text-brand-muted/40 font-sans mt-2 leading-relaxed">Try it live — the tracker runs in 2D, 3D Live, and Preview.</p>
    </div>
  );
}

/**
 * Head-size calibration — the manual slider PLUS an "auto head size" helper.
 *
 * The live tracker (3D Live view) feeds a fit estimator in faceRig; while this
 * section is mounted we poll getHeadFitEstimate() ~2×/s. When it differs from
 * 1× we surface a one-tap suggestion. HONEST COPY by design: the matrix scale
 * already normalizes face size (the occluder sits inside the scaled group), so
 * this is a STARTING POINT from the tracker's fit, not a measurement — hence
 * "Tracker estimate … fine-tune below". Apply seeds the slider AND persists a
 * `baselineFit` so the booth can (opt-in) transfer per-guest fit as a RATIO to
 * this baseline. `headScale`/`onHeadScaleChange` stay owned by StudioShell; the
 * baseline + toggle are loaded/saved here directly (StudioShell only writes
 * headScale), both through the same normalized setStudioSettings flow.
 */
function HeadSizeCalibration({
  headScale,
  onHeadScaleChange,
}: {
  headScale: number;
  /** persist=false seeds the slider without the shell's debounced write (M-A4). */
  onHeadScaleChange: (v: number, persist?: boolean) => void;
}) {
  const { eventId } = useEvent();
  const [fit, setFit] = useState<{ factor: number; samples: number } | null>(null);
  const [baselineFit, setBaselineFit] = useState<number | null>(null);
  const [autoFit, setAutoFit] = useState(true);

  // Load the persisted baseline once (autoHeadScale defaults true when present).
  useEffect(() => {
    let alive = true;
    getStudioSettings(eventId)
      .then((s) => {
        if (!alive) return;
        setBaselineFit(s.baselineFit ?? null);
        setAutoFit(s.autoHeadScale !== false);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [eventId]);

  // Poll the live estimate only while this section is mounted. null until the
  // 3D Live view has tracked a face for ~10 detections → no chip (failure path).
  useEffect(() => {
    setFit(getHeadFitEstimate());
    const id = window.setInterval(() => setFit(getHeadFitEstimate()), 500);
    return () => window.clearInterval(id);
  }, []);

  const factor = fit?.factor ?? null;
  // Hide the chip when there's no estimate or it's within noise of 1× (nothing
  // to suggest). |factor − 1| < 0.03 → the tracker fit already matches 1×.
  const suggest = factor !== null && Math.abs(factor - 1) >= 0.03;

  const applyFit = useCallback(() => {
    if (factor === null) return;
    const clamped = Math.min(HEAD_SCALE_MAX, Math.max(HEAD_SCALE_MIN, factor));
    // persist=false: seed the slider WITHOUT scheduling the shell's debounced
    // {headScale} write — the combined write below is the single writer, so a
    // stale debounced RMW can never land after it and drop the baseline (M-A4).
    onHeadScaleChange(clamped, false);
    setBaselineFit(factor);
    setAutoFit(true);
    setStudioSettings(eventId, { headScale: clamped, baselineFit: factor, autoHeadScale: true }).catch(() => {});
  }, [factor, onHeadScaleChange, eventId]);

  const toggleAuto = useCallback(
    (v: boolean) => {
      setAutoFit(v);
      setStudioSettings(eventId, { autoHeadScale: v }).catch(() => {});
    },
    [eventId],
  );

  return (
    <div className="rounded-xl border border-accent/15 bg-accent/[0.05] p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Ruler className="w-3.5 h-3.5 text-accent-2" />
        <span className="font-label uppercase tracking-widest text-[9px] text-accent-2">Head size calibration</span>
        <Tooltip label="Head size" hint="An invisible stand-in head hides props behind the guest's real head. Increase if props peek through where the head should block them." side="left">
          <span className="ml-auto text-brand-muted/50 cursor-help text-[10px]">?</span>
        </Tooltip>
      </div>

      {/* Live tracker suggestion — only when the estimate meaningfully differs from 1×. */}
      {suggest && factor !== null && (
        <button
          onClick={applyFit}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-label uppercase tracking-wide bg-accent/15 text-accent-2 ring-1 ring-accent/30 hover:bg-accent/25 transition-colors"
        >
          <Wand2 className="w-3.5 h-3.5 shrink-0" />
          <span>Tracker estimate ×{factor.toFixed(2)} — Apply</span>
        </button>
      )}

      <StudioSlider
        label="Scale to real head"
        value={headScale}
        min={HEAD_SCALE_MIN}
        max={HEAD_SCALE_MAX}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={onHeadScaleChange}
      />
      <p className="font-sans text-[9px] text-brand-muted/50 leading-relaxed">
        Tracker estimate, not exact — fine-tune below. Saved per event; applies in every guest booth.
      </p>

      {/* Per-guest auto-fit — only offered once a baseline has been captured. */}
      {baselineFit !== null && (
        <StudioToggle
          label="Auto-fit each guest"
          hint="Nudge the occluder to each guest's tracked head size, relative to your calibration. Small adjustment only."
          value={autoFit}
          onChange={toggleAuto}
        />
      )}
    </div>
  );
}

export default function PropertiesDock({ state, dispatch, headScale, onHeadScaleChange, lighting, onLightingChange, onThumbUpload, onThumbClear }: Props) {
  const { draft } = state;
  const { eventId } = useEvent();
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // "Save as template" — persists a SNAPSHOT of the current draft as a new,
  // always-unpublished experience with config.template:true (so it can never
  // surface in the guest booth — see catalog.ts's is_published filter) that
  // AssetsDock's Mine tab lists as a reusable starting point. Reuses each
  // object's URL as-is (existingUrlResolver) rather than re-uploading, so an
  // object with a pending un-uploaded blob blocks the save with a clear ask.
  const handleSaveTemplate = useCallback(async () => {
    setTemplateError(null);
    const resolver = existingUrlResolver(draft);
    if (!resolver) {
      setTemplateError('Save your experience first.');
      return;
    }
    setTemplateSaving(true);
    try {
      const thumbnailUrl = draft.thumbUrl && draft.thumbUrl.startsWith('http') ? draft.thumbUrl : null;
      const payload = draftToPayload(draft, resolver, thumbnailUrl);
      payload.name = `${draft.name} (template)`;
      payload.is_published = false;
      payload.config = { ...payload.config, template: true };
      const result = await createExperience(eventId, payload);
      if (!result) {
        setTemplateError('Save failed — try again.');
      } else {
        setTemplateSaved(true);
        setTimeout(() => setTemplateSaved(false), 2400);
      }
    } catch (err) {
      console.error('[PropertiesDock] save template', err);
      setTemplateError('Unexpected error — see console.');
    } finally {
      setTemplateSaving(false);
    }
  }, [draft, eventId]);
  const shaderDef = useMemo(() => SHADER_MAP[draft.shaderId], [draft.shaderId]);
  // Mixed scenes: the filter slot (shaderId !== 'none') and the objects list are
  // independent — filter params show whenever a filter is set, the layers/selection/
  // booth-icon controls show whenever the scene has objects.
  const filterActive = draft.shaderId !== 'none';
  const hasObjects = draft.objects.length > 0;
  const counts = sceneCounts(draft);
  /** Scene at the object cap — surfaced up front, not discovered by an add that does nothing. */
  const atCap = counts.capped >= MAX_OBJECTS;
  // Display-only numbering for same-name layers ("Golden Crown 2") — adding the
  // same catalog item twice must leave the rows tellable apart. Numbered in
  // scene order; nothing is written back to the objects.
  const displayNames = new Map<string, string>();
  {
    const totals = new Map<string, number>();
    for (const o of draft.objects) totals.set(o.name, (totals.get(o.name) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const o of draft.objects) {
      const n = (seen.get(o.name) ?? 0) + 1;
      seen.set(o.name, n);
      displayNames.set(o.id, (totals.get(o.name) ?? 1) > 1 ? `${o.name} ${n}` : o.name);
    }
  }
  const selected = selectedObject(draft);
  const selOverlay: Overlay2D | null = selected && selected.type === 'overlay' ? selected : null;
  const sel3D: Object3D | null = selected && selected.type !== 'overlay' ? selected : null;
  // Reset targets: a built-in head piece's tuned preset, else zero. Passing a
  // literal 0 reset four of the five built-ins AWAY from where they belong, and
  // inverted the reset button's enabled state along with it.
  const sel3DDefaults = defaultAnchorConfig(sel3D ?? { type: 'model' }, HEAD_PIECE_MAP);
  /** What the Selected-item header says it is about — the layer's display name,
   *  or the filter's name when the filter slot is what the section is showing.
   *  Undefined (no chip) when the section is empty-handed. */
  const selectedBadge: string | undefined = selected
    ? displayNames.get(selected.id) ?? selected.name
    : filterActive && shaderDef
      ? shaderDef.name
      : undefined;
  /** Kind chip beside the pronounced asset name. */
  const selectedKind: string | undefined = selected
    ? (selOverlay ? (selOverlay.overlayKind === 'border' ? 'Frame' : 'Sticker') : '3D piece')
    : filterActive && shaderDef
      ? 'Filter'
      : undefined;

  const handleThumbInput = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onThumbUpload(f);
    e.target.value = '';
  };

  // Any 3D piece in the scene → the Head & fit section applies (head-size
  // calibration is scene/event-level, not per-selection).
  const has3D = draft.objects.some((o) => o.type !== 'overlay');

  // Two high-level tabs (owner IA): "Assets" — the scene-asset hierarchy first,
  // then the selected asset's properties — is the default, because configuring
  // assets is what the studio session is mostly made of; "Scene" holds the
  // scene-wide sections (Triggers · Scene · Booth look · Lighting & fit).
  const [tab, setTab] = useState<'assets' | 'scene'>('assets');

  // Collapsible-section state — Scene assets open by default (it is how you
  // select); the scene-wide sections start collapsed (progressive disclosure).
  // The asset-properties block is not collapsible: it IS the Assets tab.
  const [open, setOpen] = useState<Record<string, boolean>>({
    layers: true,
    triggers: false,
    scene: false,
    booth: false,
    headfit: false,
  });
  const toggleSection = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const reduced = useReducedMotion() ?? false;
  const selectedSectionRef = useRef<HTMLDivElement>(null);
  const sceneSectionRef = useRef<HTMLDivElement>(null);

  // Picking an object on the stage (or in Scene assets) jumps to the Assets
  // tab and brings the properties block into view — the host immediately sees
  // what they can edit, without hunting.
  useEffect(() => {
    if (!draft.selectedId) return;
    setTab('assets');
    const t = window.setTimeout(() => {
      selectedSectionRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [draft.selectedId, reduced]);

  /**
   * The same courtesy for the FILTER slot, which is the one thing in the studio
   * that is picked in the left dock and edited in a section whose identity
   * depends on the selection: its params live in the Assets tab's block when nothing
   * is selected and under Scene when something is. Since the left dock stopped
   * carrying its own copy of the sliders, a host who picks a filter with a layer
   * selected would otherwise be looking at a collapsed section with no clue.
   * Only real CHANGES fire it — `prevShader` is seeded from the current value,
   * so loading an experience that already has a filter does not pop a section
   * open on arrival.
   *
   * A WHOLESALE LOAD (starter scene, template, duplicate, undo to a different
   * scene) changes the filter and the selection in the same commit. That is
   * not a host reaching for the filter, and treating it as one sent the panel
   * to the Scene tab the instant a starter look was picked — the host landed
   * on scene settings instead of the asset they had just been given. So a
   * shader change that arrives WITH a selection change defers to the effect
   * above, which puts them on Assets.
   */
  const prevShader = useRef(draft.shaderId);
  const prevSelectedForShader = useRef(draft.selectedId);
  useEffect(() => {
    const changed = prevShader.current !== draft.shaderId;
    const selectionAlsoChanged = prevSelectedForShader.current !== draft.selectedId;
    prevShader.current = draft.shaderId;
    prevSelectedForShader.current = draft.selectedId;
    if (!changed || selectionAlsoChanged || draft.shaderId === 'none') return;
    if (draft.selectedId) {
      // A layer is selected, so the filter edits under Scene → Scene section.
      setTab('scene');
      setOpen((o) => (o.scene ? o : { ...o, scene: true }));
    } else {
      // The filter IS the selected thing — it edits in the Assets tab's block.
      setTab('assets');
    }
    const target = draft.selectedId ? sceneSectionRef : selectedSectionRef;
    const t = window.setTimeout(() => {
      target.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [draft.shaderId, draft.selectedId, reduced]);

  /** Filter-slot params — rendered in the Assets tab's properties block when
   *  nothing is selected (the filter IS the thing being edited) or under the
   *  Scene tab's "Scene" section otherwise. */
  const filterParams = (): ReactNode =>
    filterActive && shaderDef ? (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="font-sans text-xs text-brand-fg font-medium">{shaderDef.name}</p>
          {shaderDef.params.length > 0 && (
            <button
              onClick={() => dispatch({ type: 'SET_SHADER_PARAMS', params: defaultParams(draft.shaderId) })}
              className="flex items-center gap-1 text-[9px] text-brand-muted/50 hover:text-accent-2 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset all
            </button>
          )}
        </div>
        {shaderDef.params.length > 0 ? (
          shaderDef.params.map((p) => (
            <SliderRow
              key={p.key}
              label={p.label}
              value={draft.shaderParams[p.key] ?? p.default}
              min={p.min}
              max={p.max}
              step={p.step}
              defaultValue={p.default}
              onChange={(v) => dispatch({ type: 'SET_SHADER_PARAM', key: p.key, value: v })}
            />
          ))
        ) : (
          <p className="text-[10px] text-brand-muted/40 font-sans">No adjustable parameters.</p>
        )}
        <p className="text-[9px] text-brand-muted/40 font-sans leading-relaxed">{shaderDef.description}</p>
      </div>
    ) : null;

  return (
    <div className="h-full flex flex-col">
      {/* ASSETS | SCENE — the panel's two high-level tabs. Assets is the
          default and holds the hierarchy + the selected asset's properties;
          Scene holds the scene-wide sections. */}
      <div className="shrink-0 px-3 pt-3">
        <div role="tablist" aria-label="Properties" className="liquid-glass-inset flex gap-1 rounded-full p-1">
          {(['assets', 'scene'] as const).map((id) => {
            const on = tab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(id)}
                className={cn(
                  'flex-1 min-h-9 rounded-full font-label uppercase tracking-widest text-[10px] transition-colors',
                  on ? 'bg-foil text-[color:var(--on-accent)]' : 'text-brand-muted/60 hover:text-brand-fg',
                )}
              >
                {id === 'assets' ? 'Assets' : 'Scene'}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar p-3 flex flex-col gap-2.5">
        {tab === 'assets' && (
          <>
      {/* Empty scene + empty filter slot — the hint is the panel's only guidance. */}
      {!hasObjects && !filterActive && (
        <p className="text-[10px] text-brand-muted/40 font-sans px-1">Add a frame, sticker or 3D piece from the left dock to start a scene.</p>
      )}

      {/* SCENE ASSETS — the hierarchy leads the tab: select here, edit below.
          ONE flat list in true paint order (LayerList); the object counter
          rides in the badge, amber at the cap. */}
      {hasObjects && (
        <DockSection
          icon={Layers}
          title="Scene assets"
          open={!!open.layers}
          onToggle={() => toggleSection('layers')}
          badge={`${counts.capped}/${MAX_OBJECTS}`}
          badgeTone={atCap ? 'warn' : 'default'}
        >
          {atCap && (
            <p role="status" className="text-[10px] text-amber-300/80 font-sans leading-snug px-1 -mt-1">
              {SCENE_FULL_MESSAGE}
            </p>
          )}
          <LayerList
            objects={draft.objects}
            selectedId={draft.selectedId}
            displayNames={displayNames}
            dispatch={dispatch}
          />
        </DockSection>
      )}

      {/* ASSET PROPERTIES — not collapsible: it IS the Assets tab. The header
          carries the selected asset's name at display size (the owner's
          "make the selected item name more pronounced"), with a kind chip. */}
      {(hasObjects || filterActive) && (
        <div ref={selectedSectionRef} className="rounded-2xl border border-accent/25 bg-accent/[0.04]">
          <div className="flex items-center gap-2.5 px-2.5 pt-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-2">
              <MousePointerClick className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-label text-[9px] uppercase tracking-widest text-brand-muted/50">Asset properties</p>
              <p className="truncate font-serif text-lg leading-snug text-brand-fg">{selectedBadge ?? 'Nothing selected'}</p>
            </div>
            {selectedKind && (
              <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 font-label text-[8px] uppercase tracking-widest text-brand-muted/60">
                {selectedKind}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-4 px-2.5 pb-3 pt-3">
            {/* Selected 2D overlay properties */}
            {selOverlay && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <p className="font-sans text-xs text-brand-fg font-medium">{selOverlay.overlayKind === 'border' ? 'Frame placement' : 'Sticker placement'}</p>
                  <button
                    onClick={() => dispatch({ type: 'SET_TRANSFORM', transform: { ...DEFAULT_TRANSFORM } })}
                    className="flex items-center gap-1 text-[9px] text-brand-muted/50 hover:text-accent-2 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset all
                  </button>
                </div>
                <SliderRow label="Size" value={selOverlay.transform.scale} min={OVERLAY_SCALE.min} max={OVERLAY_SCALE.max} step={OVERLAY_SCALE.step} defaultValue={DEFAULT_TRANSFORM.scale} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, scale: v } })} />
                <SliderRow label="Position · left/right" value={selOverlay.transform.x} min={OVERLAY_POSITION.min} max={OVERLAY_POSITION.max} step={OVERLAY_POSITION.step} defaultValue={DEFAULT_TRANSFORM.x} format={(v) => formatAtStep(v, OVERLAY_POSITION.step, '%')} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, x: v } })} />
                <SliderRow label="Position · up/down" value={selOverlay.transform.y} min={OVERLAY_POSITION.min} max={OVERLAY_POSITION.max} step={OVERLAY_POSITION.step} defaultValue={DEFAULT_TRANSFORM.y} format={(v) => formatAtStep(v, OVERLAY_POSITION.step, '%')} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, y: v } })} />
                <SliderRow label="Rotation" value={selOverlay.transform.rotation} min={OVERLAY_ROTATION.min} max={OVERLAY_ROTATION.max} step={OVERLAY_ROTATION.step} defaultValue={DEFAULT_TRANSFORM.rotation} format={(v) => formatAtStep(v, OVERLAY_ROTATION.step, '°')} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, rotation: v } })} />
                <AlignRow
                  transform={selOverlay.transform}
                  kind={selOverlay.overlayKind}
                  onChange={(t) => dispatch({ type: 'SET_TRANSFORM', transform: t })}
                />
                <AnimationChips value={selOverlay.animation} onChange={(a) => dispatch({ type: 'SET_OBJECT_ANIMATION', id: selOverlay.id, animation: a })} />
                {/* Guest-name lettering lives on the FRAME only — a sticker is
                    placed anywhere on the canvas, so a name band under it has
                    no meaning. Absent on every scene that never turns it on. */}
                {selOverlay.overlayKind === 'border' && (
                  <GuestLetteringControls
                    value={selOverlay.lettering}
                    onChange={(lettering) => dispatch({ type: 'UPDATE_OBJECT', id: selOverlay.id, patch: { lettering } })}
                  />
                )}
              </div>
            )}

            {/* Selected 3D object properties */}
            {sel3D && (
              <div className="flex flex-col gap-4">
                {/* TRACKS ON — head or hand. The same wand can be an earring
                    (head-tracked at the ear) or held in the fist (hand-tracked
                    at the grip); this is the explicit family switch, so the
                    orbit view's anchor dots never have to guess. Switching
                    families zeroes offset/rotation (a brow nudge is
                    meaningless on a wrist) but keeps the auto-fit scale. */}
                <div>
                  <SectionLabel>Tracks on</SectionLabel>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { id: 'head' as const, label: 'Head', Icon: ScanFace },
                      { id: 'hand' as const, label: 'Hand', Icon: Hand },
                    ]).map(({ id, label, Icon }) => {
                      const active = (sel3D.handAnchor !== undefined) === (id === 'hand');
                      return (
                        <button
                          key={id}
                          onClick={() => dispatch({ type: 'SET_OBJECT_TRACKING', id: sel3D.id, tracking: id })}
                          aria-pressed={active}
                          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-[9px] font-label uppercase tracking-wide transition-colors ${active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'}`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* ATTACHMENT POINT — the first question about any 3D piece
                    ("where on the head does this ride?"), and until now it was
                    only answerable in the LEFT dock's inline card or by dragging
                    onto a dot in the 3D stage view. It is a property of the
                    selected object, so it belongs here, above the nudges that
                    refine it. Hand-tracked pieces swap in the hand's three
                    mounts instead. */}
                {sel3D.handAnchor !== undefined ? (
                  <div>
                    <SectionLabel>Attachment point</SectionLabel>
                    <div className="grid grid-cols-3 gap-1.5">
                      {HAND_ANCHORS.map((a) => {
                        const active = a.id === sel3D.handAnchor;
                        return (
                          <Tooltip key={a.id} label={a.label} side="left">
                            <button
                              onClick={() => dispatch({ type: 'SET_OBJECT_TRACKING', id: sel3D.id, tracking: 'hand', handAnchor: a.id })}
                              aria-pressed={active}
                              className={`w-full py-2 rounded-lg text-[9px] font-label uppercase tracking-wide truncate transition-colors ${active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'}`}
                            >
                              {a.id === 'grip' ? 'Grip' : a.id === 'wristBack' ? 'Wrist' : 'Palm'}
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                <div>
                  <SectionLabel>Attachment point</SectionLabel>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ANCHOR_PRESETS.map((p) => {
                      const active = p.id === sel3D.anchor;
                      return (
                        <Tooltip key={p.id} label={p.label} hint={p.hint} side="left">
                          <button
                            onClick={() => dispatch({ type: 'SELECT_ANCHOR', anchor: p.id })}
                            aria-pressed={active}
                            className={`w-full py-2 rounded-lg text-[9px] font-label uppercase tracking-wide truncate transition-colors ${active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'}`}
                          >
                            {p.label}
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
                )}
                <div className="flex items-center justify-between">
                  <p className="font-sans text-xs text-brand-fg font-medium">Placement</p>
                  <button
                    onClick={() => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { ...sel3DDefaults.offset }, rotation: { ...sel3DDefaults.rotation } } })}
                    className="flex items-center gap-1 text-[9px] text-brand-muted/50 hover:text-accent-2 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset all
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  <SectionLabel>Nudge position (cm)</SectionLabel>
                  {AXES.map((axis) => (
                    <SliderRow
                      key={`o${axis}`}
                      label={AXIS_OFFSET_LABELS[axis]}
                      value={sel3D.anchorConfig.offset[axis]}
                      min={-20}
                      max={20}
                      step={0.1}
                      defaultValue={sel3DDefaults.offset[axis]}
                      format={(v) => `${v.toFixed(1)} cm`}
                      onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { ...sel3D.anchorConfig.offset, [axis]: v } } })}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  {/* State stays radians (anchorConfig contract); the slider converts
                      deg↔rad at its boundary so hosts see familiar degrees. */}
                  <SectionLabel>Rotation (°)</SectionLabel>
                  {AXES.map((axis) => (
                    <SliderRow
                      key={`r${axis}`}
                      label={AXIS_ROTATION_LABELS[axis]}
                      value={sel3D.anchorConfig.rotation[axis] * RAD_TO_DEG}
                      min={-180}
                      max={180}
                      step={1}
                      defaultValue={sel3DDefaults.rotation[axis] * RAD_TO_DEG}
                      format={(v) => `${v.toFixed(0)}°`}
                      onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { rotation: { ...sel3D.anchorConfig.rotation, [axis]: v / RAD_TO_DEG } } })}
                    />
                  ))}
                </div>
                <SliderRow
                  label="Size"
                  value={Math.min(sel3D.anchorConfig.scale, PROP_SCALE_MAX)}
                  min={0.05}
                  max={PROP_SCALE_MAX}
                  step={0.05}
                  defaultValue={sel3DDefaults.scale}
                  onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { scale: v } })}
                />
                <p className="font-sans text-[9px] text-brand-muted/40 leading-relaxed -mt-2">
                  Arrow keys nudge this piece (hold Shift for a bigger step).
                </p>
                <StudioToggle
                  label="Occlude behind head"
                  hint="Hide parts of this piece behind the real head"
                  value={sel3D.occlusion}
                  onChange={(v) => dispatch({ type: 'SET_OCCLUSION', occlusion: v })}
                />
                {/* Finish is for IMPORTED/GENERATED geometry only: built-in head
                    pieces ship hand-authored materials that a blanket restyle
                    would flatten. */}
                {sel3D.type === 'model' && <FinishControls object={sel3D} dispatch={dispatch} />}
                {/* Same gate as FinishControls, for the same reason: a built-in
                    head piece is procedural R3F with authored colours and has no
                    template to configure. Renders nothing unless the asset ships
                    one (normalizeTemplate -> null = not configurable). */}
                {sel3D.type === 'model' && <AssetPersonalisation object={sel3D} dispatch={dispatch} />}
                <AnimationChips value={sel3D.animation} onChange={(a) => dispatch({ type: 'SET_OBJECT_ANIMATION', id: sel3D.id, animation: a })} />
              </div>
            )}

            {/* THE REMOVE PATH. Before this there was none in the properties
                panel at all: the only two ways to delete a layer were a 14px
                trash glyph at the tail of a five-icon huddle in the layer list
                and the Del key — which is why the owner reported "there is no
                clear way to remove them". Danger-tinted (the repo's rose idiom,
                ui/pillStyles.ts) and last in the section, because destructive
                actions belong past everything you might have meant instead. */}
            {selected && (
              <button
                onClick={() => dispatch({ type: 'DELETE_OBJECT', id: selected.id })}
                aria-label={`Remove ${displayNames.get(selected.id) ?? selected.name} from the scene`}
                className="pressable flex items-center justify-center gap-2 w-full min-h-11 rounded-xl bg-rose-500/[0.12] text-rose-300 ring-1 ring-rose-400/25 hover:bg-rose-500/20 hover:text-rose-200 transition-colors font-label uppercase tracking-widest text-[10px]"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                Remove from scene
                <span className="font-mono text-[9px] normal-case tracking-normal opacity-60">Del</span>
              </button>
            )}

            {/* No object selected: the filter (when set) IS the thing being
                edited — otherwise a plain how-to-select hint. */}
            {!selected && filterParams()}
            {hasObjects && !selected && !filterActive && (
              <p className="text-[10px] text-brand-muted/40 font-sans px-1">
                Nothing selected — tap an item on the stage, or pick one in Scene assets above.
              </p>
            )}
          </div>
        </div>
      )}
          </>
        )}

        {tab === 'scene' && (
          <>
      {/* MAGIC TRIGGERS — scene-level face-triggered effects, shown once the scene
          has content (or already carries triggers) since they ride on the scene. */}
      {(hasObjects || filterActive || draft.triggers.length > 0) && (
        <DockSection
          icon={Sparkles}
          title="Magic Triggers"
          open={!!open.triggers}
          onToggle={() => toggleSection('triggers')}
          help="triggers"
          badge={`${draft.triggers.length}/${MAX_TRIGGERS}`}
        >
          <MagicTriggers
            draft={draft}
            dispatch={dispatch}
            pieceName={(id) => displayNames.get(id) ?? draft.objects.find((o) => o.id === id)?.name ?? 'piece'}
            ambientShaderId={filterActive ? draft.shaderId : null}
          />
        </DockSection>
      )}

      {/* SCENE — the filter slot (surfaced here only while an object is
          selected; otherwise it lives in the Assets tab) + how this experience
          surfaces in the booth: Live/Hidden, Featured, Save-as-template.
          Hidden while the scene is completely EMPTY (no objects, no filter):
          flipping a blank experience to "Live" would publish nothing to
          guests, and the empty-state hint is the only guidance the panel
          should give at that point. */}
      {(hasObjects || filterActive) && (
        <div ref={sceneSectionRef}>
        <DockSection
          icon={Clapperboard}
          title="Scene"
          open={!!open.scene}
          onToggle={() => toggleSection('scene')}
          badge={selected && filterActive && shaderDef ? shaderDef.name : undefined}
        >
          {selected ? filterParams() : null}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
          <Tooltip label={draft.isPublished ? 'Live' : 'Hidden'} hint="Whether guests can pick this in the booth">
            <button
              onClick={() => dispatch({ type: 'TOGGLE_PUBLISHED' })}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-label uppercase tracking-widest transition-colors ${draft.isPublished ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.04] text-brand-muted/50 hover:text-brand-fg'}`}
            >
              {draft.isPublished ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {draft.isPublished ? 'Live' : 'Hidden'}
            </button>
          </Tooltip>
          <Tooltip label={draft.featured ? 'Featured' : 'Not featured'} hint="Featured pieces surface first in the booth">
            <button
              onClick={() => dispatch({ type: 'TOGGLE_FEATURED' })}
              className={`flex items-center justify-center w-9 h-9 rounded-xl transition-colors ${draft.featured ? 'bg-accent/15 text-accent-2' : 'bg-white/[0.04] text-brand-muted/40 hover:text-brand-fg'}`}
            >
              <Star className={`w-4 h-4 ${draft.featured ? 'fill-current' : ''}`} />
            </button>
          </Tooltip>
          <Tooltip label="Save as template" hint="Saves a reusable copy of this scene to start new experiences from — never shown to guests">
            <button
              onClick={handleSaveTemplate}
              disabled={templateSaving}
              aria-label="Save as template"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-label uppercase tracking-widest bg-white/[0.04] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-50"
            >
              {templateSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : templateSaved ? <Check className="w-3.5 h-3.5" /> : <FileStack className="w-3.5 h-3.5" />}
              {templateSaving ? 'Saving…' : templateSaved ? 'Saved' : 'Template'}
            </button>
          </Tooltip>
        </div>
            {templateError && <p className="text-[9px] text-rose-400 font-sans">{templateError}</p>}
          </div>
        </DockSection>
        </div>
      )}

      {/* BOOTH LOOK — how this experience presents in the guest booth picker. */}
      {hasObjects && (
        <DockSection icon={Palette} title="Booth look" open={!!open.booth} onToggle={() => toggleSection('booth')}>
          <div>
            <SectionLabel>Booth icon (optional)</SectionLabel>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl overflow-hidden bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0">
              {draft.thumbUrl ? <img src={draft.thumbUrl} alt="icon" className="w-full h-full object-cover" /> : <ImageIcon className="w-5 h-5 text-brand-muted/40" />}
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 cursor-pointer hover:bg-white/[0.07] transition-colors text-xs text-brand-muted/70">
                <Upload className="w-3.5 h-3.5 text-accent-2 shrink-0" />
                {draft.thumbUrl ? 'Replace icon' : 'Upload icon'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={handleThumbInput} />
              </label>
              {draft.thumbUrl && (
                <button onClick={onThumbClear} className="flex items-center justify-center gap-1.5 px-3 py-1 rounded-xl bg-white/[0.04] border border-white/10 text-[9px] font-label uppercase tracking-widest text-rose-400/70 hover:text-rose-400 transition-colors">
                  <X className="w-3 h-3" /> Remove icon
                </button>
              )}
            </div>
          </div>
          </div>
        </DockSection>
      )}

      {/* LIGHTING & FIT — the two SCENE-level 3D settings: the shared lighting
          rig every surface renders with, and head-size calibration + per-guest
          auto-fit. Offered whenever the scene has a 3D piece; mounted only while
          open so the tracker-estimate polling runs only while the host is
          calibrating. */}
      {has3D && (
        <DockSection icon={Ruler} title="Lighting & fit" open={!!open.headfit} onToggle={() => toggleSection('headfit')}>
          <LightingPicker value={lighting} onChange={onLightingChange} />
          <HeadSizeCalibration headScale={headScale} onHeadScaleChange={onHeadScaleChange} />
        </DockSection>
      )}

      {/* An empty scene has nothing scene-wide to configure yet. */}
      {!hasObjects && !filterActive && draft.triggers.length === 0 && (
        <p className="text-[10px] text-brand-muted/40 font-sans px-1">
          Scene settings appear once your scene has content — start from the Assets tab.
        </p>
      )}
          </>
        )}
      </div>
    </div>
  );
}
