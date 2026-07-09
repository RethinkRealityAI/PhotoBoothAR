/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PropertiesDock — the studio's right panel. Adapts to the draft kind:
 *   • shader → effect params (from the shader registry)
 *   • border/sticker → Transform2D sliders
 *   • 3d → anchor offset/rotation/scale sliders + head-size calibration +
 *          per-experience occlusion toggle
 * Plus shared name / booth-icon / published / featured controls. Ports the
 * old Creator2D + Creator3D right panels onto platform tokens.
 */
import { useMemo, type ChangeEvent } from 'react';
import { Eye, EyeOff, Image as ImageIcon, RotateCcw, Ruler, Star, Upload, X } from 'lucide-react';
import { SHADER_MAP, defaultParams } from '../../lib/shaders';
import { HEAD_SCALE_MIN, HEAD_SCALE_MAX } from '../../lib/studio/occluder';
import { DEFAULT_TRANSFORM, type StudioAction, type StudioState } from '../../lib/studio/state';
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

export default function PropertiesDock({ state, dispatch, headScale, onHeadScaleChange, onThumbUpload, onThumbClear }: Props) {
  const { draft } = state;
  const shaderDef = useMemo(() => SHADER_MAP[draft.shaderId], [draft.shaderId]);
  const is3D = draft.kind === '3d_attachment';
  const isOverlay = draft.kind === 'border' || draft.kind === '2d_filter';

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

      {/* Shader params */}
      {draft.kind === 'shader' && shaderDef && (
        <div className="flex flex-col gap-4">
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

      {/* 2D transform */}
      {isOverlay && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="font-sans text-xs text-brand-fg font-medium">{draft.kind === 'border' ? 'Frame placement' : 'Sticker transform'}</p>
            <button
              onClick={() => dispatch({ type: 'SET_TRANSFORM', transform: { ...DEFAULT_TRANSFORM } })}
              className="flex items-center gap-1 text-[9px] text-brand-muted/50 hover:text-accent-2 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
          <StudioSlider label="Scale" value={draft.transform.scale} min={0.1} max={3} step={0.05} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...draft.transform, scale: v } })} />
          <StudioSlider label="X position (%)" value={draft.transform.x} min={-100} max={100} step={0.5} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...draft.transform, x: v } })} format={(v) => v.toFixed(0)} />
          <StudioSlider label="Y position (%)" value={draft.transform.y} min={-100} max={100} step={0.5} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...draft.transform, y: v } })} format={(v) => v.toFixed(0)} />
          <StudioSlider label="Rotation (°)" value={draft.transform.rotation} min={-180} max={180} step={1} onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...draft.transform, rotation: v } })} format={(v) => v.toFixed(0)} />
        </div>
      )}

      {/* 3D anchor transform */}
      {is3D && (
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
                value={draft.anchorConfig.offset[axis]}
                min={-20}
                max={20}
                step={0.1}
                compact
                onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { ...draft.anchorConfig.offset, [axis]: v } } })}
              />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <SectionLabel>Rotation (rad)</SectionLabel>
            {AXES.map((axis) => (
              <StudioSlider
                key={`r${axis}`}
                label={axis.toUpperCase()}
                value={draft.anchorConfig.rotation[axis]}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                compact
                onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { rotation: { ...draft.anchorConfig.rotation, [axis]: v } } })}
              />
            ))}
          </div>
          <StudioSlider label="Scale" value={Math.min(draft.anchorConfig.scale, 15)} min={0.05} max={15} step={0.05} onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { scale: v } })} />

          {/* Head-size calibration */}
          <div className="rounded-xl border border-accent/15 bg-accent/[0.05] p-3 flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Ruler className="w-3.5 h-3.5 text-accent-2" />
              <span className="font-label uppercase tracking-widest text-[9px] text-accent-2">Head size calibration</span>
              <Tooltip label="Head size" hint="Scales the whole tracked head (occluder + reference) to match a real head. Increase if props sit too small on faces in Preview." side="left">
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
            value={draft.occlusion}
            onChange={(v) => dispatch({ type: 'SET_OCCLUSION', occlusion: v })}
          />
        </div>
      )}

      {/* Booth icon */}
      {(isOverlay || is3D) && (
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
