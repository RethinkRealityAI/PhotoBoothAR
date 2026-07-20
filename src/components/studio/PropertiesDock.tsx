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
  ArrowBigUp,
  Boxes,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Crown,
  Eye,
  EyeOff,
  FileStack,
  Image as ImageIcon,
  Laugh,
  LayoutTemplate,
  Layers,
  Loader2,
  MousePointerClick,
  Palette,
  PartyPopper,
  Plus,
  RotateCcw,
  Ruler,
  Smile,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { SHADER_MAP, FILTER_SHADERS, defaultParams } from '../../lib/shaders';
import { HEAD_SCALE_MIN, HEAD_SCALE_MAX } from '../../lib/studio/occluder';
import { getHeadFitEstimate } from '../../lib/faceRig';
import { PROP_SCALE_MAX } from '../../lib/studio/bustFit';
import {
  DEFAULT_TRANSFORM,
  MAX_OBJECTS,
  MAX_TRIGGERS,
  sceneCounts,
  selectedObject,
  type Object3D,
  type Overlay2D,
  type StudioAction,
  type StudioDraft,
  type StudioObject,
  type StudioState,
} from '../../lib/studio/state';
import {
  BURST_STYLE_LABELS,
  BURST_STYLES,
  TRIGGER_SOURCE_LABELS,
  TRIGGER_SOURCES,
  type BurstStyle,
  type TriggerAction,
  type TriggerSource,
} from '../../lib/studio/triggers';
import { draftToPayload, existingUrlResolver } from '../../lib/studio/draftMapping';
import { createExperience, getStudioSettings, setStudioSettings } from '../../lib/db';
import { useEvent } from '../../events/EventContext';
import type { LayerAnimation } from '../../types';
import { SectionLabel, StudioSlider, StudioToggle } from './StudioControls';
import Tooltip from '../ui/Tooltip';
import HelpButton from './HelpButton';
import type { FeatureHelpTopic } from '../../lib/studio/featureHelp';

interface Props {
  state: StudioState;
  dispatch: React.Dispatch<StudioAction>;
  headScale: number;
  onHeadScaleChange: (v: number, persist?: boolean) => void;
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
 * shares: icon + name + chevron. Expand/collapse animates height/opacity via
 * the PickerDrawer motion idiom (a fixed-width column, so no layout-critical
 * width ever animates); prefers-reduced-motion collapses instantly. Children
 * mount only while open (progressive disclosure + no hidden polling).
 */
function DockSection({
  icon: Icon,
  title,
  open,
  onToggle,
  help,
  children,
}: {
  icon: LucideIcon;
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Feature-help topic — shows a small "?" affordance beside the title. */
  help?: FeatureHelpTopic;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <section className="border-b border-white/5 pb-4 last:border-b-0 last:pb-0">
      <div className="group flex items-center gap-2 w-full py-1">
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          <Icon className={`w-3.5 h-3.5 shrink-0 transition-colors ${open ? 'text-accent-2' : 'text-brand-muted/50 group-hover:text-brand-fg'}`} />
          <span className={`flex-1 min-w-0 truncate font-label uppercase tracking-widest text-[10px] transition-colors ${open ? 'text-brand-fg' : 'text-brand-muted/60 group-hover:text-brand-fg'}`}>
            {title}
          </span>
        </button>
        {help && <HelpButton topic={help} label={`How ${title} works`} side="bottom" />}
        <button onClick={onToggle} aria-label={open ? `Collapse ${title}` : `Expand ${title}`} className="shrink-0 p-0.5">
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-brand-muted/40 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
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
            <div className="pt-3 flex flex-col gap-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * StudioSlider + a small per-row reset affordance (shown wherever a default
 * exists). The reset sits beside the slider track, dims to near-invisible while
 * the value is already at its default, and never reflows the row.
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
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  defaultValue: number;
}) {
  const atDefault = Math.abs(value - defaultValue) < step / 2;
  return (
    <div className="flex items-end gap-1.5">
      <div className="flex-1 min-w-0">
        <StudioSlider label={label} value={value} min={min} max={max} step={step} onChange={onChange} format={format} />
      </div>
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

const ANIMATIONS: { id: LayerAnimation; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'float', label: 'Float' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'spin', label: 'Spin' },
];

function objectIcon(o: StudioObject) {
  if (o.type === 'overlay') return o.overlayKind === 'border' ? LayoutTemplate : ImageIcon;
  return o.type === 'headpiece' ? Crown : Boxes;
}

/** Layers-panel groups (in paint-family order): the single frame, then stickers,
 *  then 3D pieces. Within a group rows keep objects[] order; reorder still acts on
 *  the flat objects[] list (which sets paint order). */
const LAYER_GROUPS: { id: string; label: string; match: (o: StudioObject) => boolean }[] = [
  { id: 'frame', label: 'Frame', match: (o) => o.type === 'overlay' && o.overlayKind === 'border' },
  { id: 'stickers', label: 'Stickers', match: (o) => o.type === 'overlay' && o.overlayKind === '2d_filter' },
  { id: '3d', label: '3D pieces', match: (o) => o.type !== 'overlay' },
];

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

/** "EDITING · <name>" caption above a properties section, so it's always clear
 *  which layer (or the filter slot) the controls directly below it act on. */
function EditingCaption({ name }: { name: string }) {
  return (
    <p className="flex items-baseline gap-1.5 min-w-0">
      <span className="font-label text-[9px] uppercase tracking-widest text-brand-muted/50 shrink-0">Editing</span>
      <span className="text-brand-muted/30 shrink-0">·</span>
      <span className="text-xs text-brand-fg font-medium truncate">{name}</span>
    </p>
  );
}

/* — Magic Triggers (face-triggered effects) --------------------------------- */

const SOURCE_ICON: Record<TriggerSource, LucideIcon> = {
  smile: Smile,
  mouthOpen: Laugh,
  wink: Eye,
  browRaise: ArrowBigUp,
};

type NewActionType = 'burst' | 'reveal' | 'filterPulse';
const ACTION_CHOICES: { id: NewActionType; label: string; icon: LucideIcon }[] = [
  { id: 'burst', label: 'Burst', icon: PartyPopper },
  { id: 'reveal', label: 'Reveal', icon: Wand2 },
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
    setRevealId('');
    setFilterId(defaultFilter);
  };

  // The action the form would commit — mirrors the branch logic in commit() so we
  // can block an EXACT duplicate (same source + action type + style/target/shader)
  // before dispatch. null when the form can't yet commit (reveal with no piece).
  const pendingAction = useMemo<TriggerAction | null>(() => {
    if (actionType === 'burst') return { type: 'burst', style: burstStyle };
    if (actionType === 'reveal') {
      const target = revealId || pieces[0]?.id;
      return target ? { type: 'reveal', objectId: target } : null;
    }
    return filterId ? { type: 'filterPulse', shaderId: filterId } : { type: 'filterPulse' };
  }, [actionType, burstStyle, revealId, filterId, pieces]);

  const sameAction = (a: TriggerAction, b: TriggerAction): boolean => {
    if (a.type !== b.type) return false;
    if (a.type === 'burst' && b.type === 'burst') return a.style === b.style;
    if (a.type === 'reveal' && b.type === 'reveal') return a.objectId === b.objectId;
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
      {/* The section header (DockSection) already names this group — only the
          count rides inside. */}
      <div className="flex items-center justify-end mb-2">
        <span className="font-mono text-[9px] text-brand-muted/50">{draft.triggers.length}/{MAX_TRIGGERS}</span>
      </div>

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
          Guests set off effects with their face — smile, open mouth, wink, or raise brows.
        </p>
      )}

      {adding ? (
        <div className="rounded-xl border border-accent/15 bg-accent/[0.05] p-3 flex flex-col gap-3">
          <div>
            <SectionLabel>When guest…</SectionLabel>
            <div className="grid grid-cols-4 gap-1.5">
              {TRIGGER_SOURCES.map((s) => {
                const Icon = SOURCE_ICON[s];
                return (
                  <button key={s} onClick={() => setSource(s)} title={TRIGGER_SOURCE_LABELS[s]} className={chip(s === source)}>
                    <Icon className="w-4 h-4" />
                    <span className="text-center leading-tight">{TRIGGER_SOURCE_LABELS[s]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <SectionLabel>Do…</SectionLabel>
            <div className="grid grid-cols-3 gap-1.5">
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
              disabled={(actionType === 'reveal' && pieces.length === 0) || isDuplicate}
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

export default function PropertiesDock({ state, dispatch, headScale, onHeadScaleChange, onThumbUpload, onThumbClear }: Props) {
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

  const handleThumbInput = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onThumbUpload(f);
    e.target.value = '';
  };

  // Any 3D piece in the scene → the Head & fit section applies (head-size
  // calibration is scene/event-level, not per-selection).
  const has3D = draft.objects.some((o) => o.type !== 'overlay');

  // Collapsible-section state — Selected item + Layers open by default (the
  // first is the editing surface, the second is how you select); everything
  // else starts collapsed (progressive disclosure).
  const [open, setOpen] = useState<Record<string, boolean>>({
    selected: true,
    layers: true,
    triggers: false,
    scene: false,
    booth: false,
    headfit: false,
  });
  const toggleSection = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const reduced = useReducedMotion() ?? false;
  const selectedSectionRef = useRef<HTMLDivElement>(null);

  // Picking an object on the stage (or in Layers) auto-opens the Selected-item
  // section and brings it into view — the host immediately sees what they can
  // edit, without hunting.
  useEffect(() => {
    if (!draft.selectedId) return;
    setOpen((o) => (o.selected ? o : { ...o, selected: true }));
    const t = window.setTimeout(() => {
      selectedSectionRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [draft.selectedId, reduced]);

  /** Filter-slot params — rendered in "Selected item" when nothing is selected
   *  (the filter IS the thing being edited) or under "Scene" otherwise. */
  const filterParams = (withCaption: boolean): ReactNode =>
    filterActive && shaderDef ? (
      <div className="flex flex-col gap-4">
        {withCaption ? <EditingCaption name={shaderDef.name} /> : null}
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
    <div className="h-full overflow-y-auto hide-scrollbar p-4 flex flex-col gap-4">
      {/* Empty scene + empty filter slot — the hint is the panel's only guidance. */}
      {!hasObjects && !filterActive && (
        <p className="text-[10px] text-brand-muted/40 font-sans px-1">Add a frame, sticker or 3D piece from the left dock to start a scene.</p>
      )}

      {/* SELECTED ITEM — always the first section; auto-opens + scrolls into
          view whenever the host picks an object on the stage or in Layers. */}
      {(hasObjects || filterActive) && (
        <div ref={selectedSectionRef}>
          <DockSection icon={MousePointerClick} title="Selected item" open={!!open.selected} onToggle={() => toggleSection('selected')}>
            {/* Selected 2D overlay properties */}
            {selOverlay && (
              <div className="flex flex-col gap-4">
                <EditingCaption name={displayNames.get(selOverlay.id) ?? selOverlay.name} />
                <div className="flex items-center justify-between">
                  <p className="font-sans text-xs text-brand-fg font-medium">{selOverlay.overlayKind === 'border' ? 'Frame placement' : 'Sticker placement'}</p>
                  <button
                    onClick={() => dispatch({ type: 'SET_TRANSFORM', transform: { ...DEFAULT_TRANSFORM } })}
                    className="flex items-center gap-1 text-[9px] text-brand-muted/50 hover:text-accent-2 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset all
                  </button>
                </div>
                <SliderRow label="Size" value={selOverlay.transform.scale} min={0.1} max={3} step={0.05} defaultValue={DEFAULT_TRANSFORM.scale} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, scale: v } })} />
                <SliderRow label="Position · left/right" value={selOverlay.transform.x} min={-100} max={100} step={0.5} defaultValue={DEFAULT_TRANSFORM.x} format={(v) => `${v.toFixed(0)}%`} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, x: v } })} />
                <SliderRow label="Position · up/down" value={selOverlay.transform.y} min={-100} max={100} step={0.5} defaultValue={DEFAULT_TRANSFORM.y} format={(v) => `${v.toFixed(0)}%`} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, y: v } })} />
                <SliderRow label="Rotation" value={selOverlay.transform.rotation} min={-180} max={180} step={1} defaultValue={DEFAULT_TRANSFORM.rotation} format={(v) => `${v.toFixed(0)}°`} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, rotation: v } })} />
                <AnimationChips value={selOverlay.animation} onChange={(a) => dispatch({ type: 'SET_OBJECT_ANIMATION', id: selOverlay.id, animation: a })} />
              </div>
            )}

            {/* Selected 3D object properties */}
            {sel3D && (
              <div className="flex flex-col gap-4">
                <EditingCaption name={displayNames.get(sel3D.id) ?? sel3D.name} />
                <div className="flex items-center justify-between">
                  <p className="font-sans text-xs text-brand-fg font-medium">Placement</p>
                  <button
                    onClick={() => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } })}
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
                      defaultValue={0}
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
                      defaultValue={0}
                      format={(v) => `${v.toFixed(0)}°`}
                      onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { rotation: { ...sel3D.anchorConfig.rotation, [axis]: v / RAD_TO_DEG } } })}
                    />
                  ))}
                </div>
                <StudioSlider label="Size" value={Math.min(sel3D.anchorConfig.scale, PROP_SCALE_MAX)} min={0.05} max={PROP_SCALE_MAX} step={0.05} onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { scale: v } })} />
                <StudioToggle
                  label="Occlude behind head"
                  hint="Hide parts of this piece behind the real head"
                  value={sel3D.occlusion}
                  onChange={(v) => dispatch({ type: 'SET_OCCLUSION', occlusion: v })}
                />
                <AnimationChips value={sel3D.animation} onChange={(a) => dispatch({ type: 'SET_OBJECT_ANIMATION', id: sel3D.id, animation: a })} />
              </div>
            )}

            {/* No object selected: the filter (when set) IS the thing being
                edited — otherwise a plain how-to-select hint. */}
            {!selected && filterParams(true)}
            {hasObjects && !selected && !filterActive && (
              <p className="text-[10px] text-brand-muted/40 font-sans px-1">Tap an object on the stage — or pick a layer below — to edit it.</p>
            )}
          </DockSection>
        </div>
      )}

      {/* LAYERS — grouped by kind (Frame · Stickers · 3D pieces). Within a group,
          rows show top-most first; reorder acts on the flat objects[] paint order,
          the eye toggles the editor-only hidden flag, delete removes the object. */}
      {hasObjects && (
        <DockSection icon={Layers} title="Layers" open={!!open.layers} onToggle={() => toggleSection('layers')}>
          {counts.capped >= 15 && (
            <div className="flex items-center justify-end -mb-2">
              <Tooltip
                label={`${counts.capped} / ${MAX_OBJECTS} objects`}
                hint="Up to 20 stickers + 3D pieces per scene — the frame is exempt. Adds past the cap are ignored."
                side="left"
              >
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded-full cursor-help ${counts.capped >= MAX_OBJECTS ? 'text-amber-400 bg-amber-400/10' : 'text-brand-muted/50 bg-white/[0.04]'}`}>
                  {counts.capped}/{MAX_OBJECTS}
                </span>
              </Tooltip>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {LAYER_GROUPS.map((g) => {
              const items = draft.objects.filter(g.match);
              if (items.length === 0) return null;
              return (
                <div key={g.id}>
                  <p className="font-label text-[8px] uppercase tracking-widest text-brand-muted/40 mb-1 px-1">{g.label}</p>
                  <ul className="flex flex-col gap-1">
                    {/* Reversed so the top of the list is the top-most rendered
                        object (objects[last] paints last / on top). */}
                    {[...items].reverse().map((o) => {
                      const arrayIdx = draft.objects.indexOf(o);
                      const isSel = o.id === draft.selectedId;
                      const Icon = objectIcon(o);
                      const canForward = arrayIdx < draft.objects.length - 1; // move up in list
                      const canBack = arrayIdx > 0; // move down in list
                      const hidden = !!o.hidden;
                      return (
                        <li
                          key={o.id}
                          onClick={() => dispatch({ type: 'SELECT_OBJECT', id: o.id })}
                          className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer transition-colors ${isSel ? 'bg-accent/12 ring-1 ring-accent/30' : 'bg-white/[0.03] hover:bg-white/[0.06]'} ${hidden ? 'opacity-40' : ''}`}
                        >
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${isSel ? 'text-accent-2' : 'text-brand-muted/50'}`} />
                          <span className={`text-[11px] font-sans truncate flex-1 min-w-0 ${isSel ? 'text-brand-fg' : 'text-brand-muted/70'}`}>{displayNames.get(o.id) ?? o.name}</span>
                          {o.animation !== 'none' && (
                            <span className="text-[7px] font-label uppercase tracking-widest text-accent-2/70 bg-accent/10 px-1.5 py-0.5 rounded-full shrink-0">{o.animation}</span>
                          )}
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); dispatch({ type: 'UPDATE_OBJECT', id: o.id, patch: { hidden: !hidden } }); }}
                              aria-label={hidden ? 'Show layer' : 'Hide layer'}
                              className="p-0.5 rounded text-brand-muted/50 hover:text-brand-fg transition-colors"
                            >
                              {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); dispatch({ type: 'REORDER_OBJECT', id: o.id, dir: 'down' }); }}
                              disabled={!canForward}
                              aria-label="Move layer up"
                              className="p-0.5 rounded text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-20 disabled:pointer-events-none"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); dispatch({ type: 'REORDER_OBJECT', id: o.id, dir: 'up' }); }}
                              disabled={!canBack}
                              aria-label="Move layer down"
                              className="p-0.5 rounded text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-20 disabled:pointer-events-none"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); dispatch({ type: 'DELETE_OBJECT', id: o.id }); }}
                              aria-label="Delete layer"
                              className="p-0.5 rounded text-brand-muted/40 hover:text-rose-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </DockSection>
      )}

      {/* MAGIC TRIGGERS — scene-level face-triggered effects, shown once the scene
          has content (or already carries triggers) since they ride on the scene. */}
      {(hasObjects || filterActive || draft.triggers.length > 0) && (
        <DockSection icon={Sparkles} title="Magic Triggers" open={!!open.triggers} onToggle={() => toggleSection('triggers')} help="triggers">
          <MagicTriggers
            draft={draft}
            dispatch={dispatch}
            pieceName={(id) => displayNames.get(id) ?? draft.objects.find((o) => o.id === id)?.name ?? 'piece'}
            ambientShaderId={filterActive ? draft.shaderId : null}
          />
        </DockSection>
      )}

      {/* SCENE — the filter slot (surfaced here only while an object is
          selected; otherwise it lives in Selected item) + how this experience
          surfaces in the booth: Live/Hidden, Featured, Save-as-template.
          Hidden while the scene is completely EMPTY (no objects, no filter):
          flipping a blank experience to "Live" would publish nothing to
          guests, and the empty-state hint is the only guidance the panel
          should give at that point. */}
      {(hasObjects || filterActive) && (
        <DockSection icon={Clapperboard} title="Scene" open={!!open.scene} onToggle={() => toggleSection('scene')}>
          {selected ? filterParams(false) : null}
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

      {/* HEAD & FIT — scene-level head-size calibration + per-guest auto-fit.
          Offered whenever the scene has a 3D piece; mounted only while open so
          the tracker-estimate polling runs only while the host is calibrating. */}
      {has3D && (
        <DockSection icon={Ruler} title="Head & fit" open={!!open.headfit} onToggle={() => toggleSection('headfit')}>
          <HeadSizeCalibration headScale={headScale} onHeadScaleChange={onHeadScaleChange} />
        </DockSection>
      )}
    </div>
  );
}
