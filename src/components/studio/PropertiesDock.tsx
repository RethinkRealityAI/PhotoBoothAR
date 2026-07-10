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
import { useMemo, type ChangeEvent } from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  Crown,
  Eye,
  EyeOff,
  Image as ImageIcon,
  LayoutTemplate,
  RotateCcw,
  Ruler,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { SHADER_MAP, defaultParams } from '../../lib/shaders';
import { HEAD_SCALE_MIN, HEAD_SCALE_MAX } from '../../lib/studio/occluder';
import {
  DEFAULT_TRANSFORM,
  MAX_OBJECTS,
  sceneCounts,
  selectedObject,
  type Object3D,
  type Overlay2D,
  type StudioAction,
  type StudioObject,
  type StudioState,
} from '../../lib/studio/state';
import type { LayerAnimation } from '../../types';
import { SectionLabel, StudioSlider, StudioToggle } from './StudioControls';
import Tooltip from '../ui/Tooltip';

interface Props {
  state: StudioState;
  dispatch: React.Dispatch<StudioAction>;
  headScale: number;
  onHeadScaleChange: (v: number) => void;
  onThumbUpload: (file: File) => void;
  onThumbClear: () => void;
}

const AXES = ['x', 'y', 'z'] as const;

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

export default function PropertiesDock({ state, dispatch, headScale, onHeadScaleChange, onThumbUpload, onThumbClear }: Props) {
  const { draft } = state;
  const shaderDef = useMemo(() => SHADER_MAP[draft.shaderId], [draft.shaderId]);
  // Mixed scenes: the filter slot (shaderId !== 'none') and the objects list are
  // independent — filter params show whenever a filter is set, the layers/selection/
  // booth-icon controls show whenever the scene has objects.
  const filterActive = draft.shaderId !== 'none';
  const hasObjects = draft.objects.length > 0;
  const counts = sceneCounts(draft);
  const selected = selectedObject(draft);
  const selOverlay: Overlay2D | null = selected && selected.type === 'overlay' ? selected : null;
  const sel3D: Object3D | null = selected && selected.type !== 'overlay' ? selected : null;

  const handleThumbInput = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onThumbUpload(f);
    e.target.value = '';
  };

  return (
    <div className="h-full overflow-y-auto hide-scrollbar p-4 flex flex-col gap-5">
      {/* Name */}
      <div>
        <SectionLabel>Name</SectionLabel>
        <input
          value={draft.name}
          onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
          placeholder="Experience name…"
          className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 text-sm text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/60 transition"
        />
      </div>

      {/* Publish / feature */}
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
      </div>

      {/* Filter slot params — shown whenever the scene's filter slot is filled,
          alongside any object controls below. */}
      {filterActive && shaderDef && (
        <div className="flex flex-col gap-4">
          <SectionLabel>Filter</SectionLabel>
          <div className="flex items-center justify-between">
            <p className="font-sans text-xs text-brand-fg font-medium">{shaderDef.name}</p>
            {shaderDef.params.length > 0 && (
              <button
                onClick={() => dispatch({ type: 'SET_SHADER_PARAMS', params: defaultParams(draft.shaderId) })}
                className="flex items-center gap-1 text-[9px] text-brand-muted/50 hover:text-accent-2 transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            )}
          </div>
          {shaderDef.params.length > 0 ? (
            shaderDef.params.map((p) => (
              <StudioSlider
                key={p.key}
                label={p.label}
                value={draft.shaderParams[p.key] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(v) => dispatch({ type: 'SET_SHADER_PARAM', key: p.key, value: v })}
              />
            ))
          ) : (
            <p className="text-[10px] text-brand-muted/40 font-sans">No adjustable parameters.</p>
          )}
          <p className="text-[9px] text-brand-muted/40 font-sans leading-relaxed">{shaderDef.description}</p>
        </div>
      )}

      {/* LAYERS — grouped by kind (Frame · Stickers · 3D pieces). Within a group,
          rows show top-most first; reorder acts on the flat objects[] paint order,
          the eye toggles the editor-only hidden flag, delete removes the object. */}
      {hasObjects ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <SectionLabel>Layers</SectionLabel>
            {counts.capped >= 15 && (
              <Tooltip
                label={`${counts.capped} / ${MAX_OBJECTS} objects`}
                hint="Up to 20 stickers + 3D pieces per scene — the frame is exempt. Adds past the cap are ignored."
                side="left"
              >
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded-full cursor-help ${counts.capped >= MAX_OBJECTS ? 'text-amber-400 bg-amber-400/10' : 'text-brand-muted/50 bg-white/[0.04]'}`}>
                  {counts.capped}/{MAX_OBJECTS}
                </span>
              </Tooltip>
            )}
          </div>
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
                          <span className={`text-[11px] font-sans truncate flex-1 min-w-0 ${isSel ? 'text-brand-fg' : 'text-brand-muted/70'}`}>{o.name}</span>
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
        </div>
      ) : !filterActive ? (
        <p className="text-[10px] text-brand-muted/40 font-sans px-1">Add a frame, sticker or 3D piece from the left dock to start a scene.</p>
      ) : null}

      {/* Selected 2D overlay properties */}
      {selOverlay && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="font-sans text-xs text-brand-fg font-medium">{selOverlay.overlayKind === 'border' ? 'Frame placement' : 'Sticker transform'}</p>
            <button
              onClick={() => dispatch({ type: 'SET_TRANSFORM', transform: { ...DEFAULT_TRANSFORM } })}
              className="flex items-center gap-1 text-[9px] text-brand-muted/50 hover:text-accent-2 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
          <StudioSlider label="Scale" value={selOverlay.transform.scale} min={0.1} max={3} step={0.05} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, scale: v } })} />
          <StudioSlider label="X position (%)" value={selOverlay.transform.x} min={-100} max={100} step={0.5} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, x: v } })} format={(v) => v.toFixed(0)} />
          <StudioSlider label="Y position (%)" value={selOverlay.transform.y} min={-100} max={100} step={0.5} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, y: v } })} format={(v) => v.toFixed(0)} />
          <StudioSlider label="Rotation (°)" value={selOverlay.transform.rotation} min={-180} max={180} step={1} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...selOverlay.transform, rotation: v } })} format={(v) => v.toFixed(0)} />
          <AnimationChips value={selOverlay.animation} onChange={(a) => dispatch({ type: 'SET_OBJECT_ANIMATION', id: selOverlay.id, animation: a })} />
        </div>
      )}

      {/* Selected 3D object properties */}
      {sel3D && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="font-sans text-xs text-brand-fg font-medium">Placement</p>
            <button
              onClick={() => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } })}
              className="flex items-center gap-1 text-[9px] text-brand-muted/50 hover:text-accent-2 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <SectionLabel>Offset (cm)</SectionLabel>
            {AXES.map((axis) => (
              <StudioSlider
                key={`o${axis}`}
                label={axis.toUpperCase()}
                value={sel3D.anchorConfig.offset[axis]}
                min={-20}
                max={20}
                step={0.1}
                compact
                onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { ...sel3D.anchorConfig.offset, [axis]: v } } })}
              />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <SectionLabel>Rotation (rad)</SectionLabel>
            {AXES.map((axis) => (
              <StudioSlider
                key={`r${axis}`}
                label={axis.toUpperCase()}
                value={sel3D.anchorConfig.rotation[axis]}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                compact
                onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { rotation: { ...sel3D.anchorConfig.rotation, [axis]: v } } })}
              />
            ))}
          </div>
          <StudioSlider label="Scale" value={Math.min(sel3D.anchorConfig.scale, 15)} min={0.05} max={15} step={0.05} onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { scale: v } })} />

          {/* Head-size calibration */}
          <div className="rounded-xl border border-accent/15 bg-accent/[0.05] p-3 flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Ruler className="w-3.5 h-3.5 text-accent-2" />
              <span className="font-label uppercase tracking-widest text-[9px] text-accent-2">Head size calibration</span>
              <Tooltip label="Head size" hint="Sizes the invisible head occluder to match a real head, so props are hidden behind it correctly. Increase if the occluder looks smaller than real heads in Preview." side="left">
                <span className="ml-auto text-brand-muted/50 cursor-help text-[10px]">?</span>
              </Tooltip>
            </div>
            <StudioSlider
              label="Scale to real head"
              value={headScale}
              min={HEAD_SCALE_MIN}
              max={HEAD_SCALE_MAX}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={onHeadScaleChange}
            />
            <p className="font-sans text-[9px] text-brand-muted/50 leading-relaxed">Saved per event — applies in every guest booth.</p>
          </div>

          <StudioToggle
            label="Occlude behind head"
            hint="Hide parts of this piece behind the real head"
            value={sel3D.occlusion}
            onChange={(v) => dispatch({ type: 'SET_OCCLUSION', occlusion: v })}
          />

          <AnimationChips value={sel3D.animation} onChange={(a) => dispatch({ type: 'SET_OBJECT_ANIMATION', id: sel3D.id, animation: a })} />
        </div>
      )}

      {/* Nothing selected in a populated scene */}
      {hasObjects && !selected && (
        <p className="text-[10px] text-brand-muted/40 font-sans px-1">Select an object above to edit its properties.</p>
      )}

      {/* Booth icon */}
      {hasObjects && (
        <div className="border-t border-white/10 pt-4">
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
      )}
    </div>
  );
}
