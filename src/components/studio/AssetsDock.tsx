/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AssetsDock — the studio's left panel. Mode-aware source library:
 *   • 2D → experience-type selector, built-in frames/stickers, custom upload,
 *          AI frame generation
 *   • 3D → head-piece presets, GLB upload, anchor picker, AI 3D generation
 * Click-to-add wires each source into the reducer. (P3 adds a bucket-assets
 * tab and pointer drag-and-drop onto the stage.)
 */
import { useCallback, useRef, type ChangeEvent } from 'react';
import { Boxes, Crown, Image as ImageIcon, LayoutTemplate, Sparkles, Upload } from 'lucide-react';
import { FILTER_SHADERS, defaultParams } from '../../lib/shaders';
import { BUILTIN_BORDERS, toDataUrl } from '../../lib/borders';
import { HEAD_PIECES } from '../../lib/headPieces';
import { ANCHOR_PRESETS } from '../../lib/faceRig';
import { uploadAsset } from '../../lib/db';
import { useEvent } from '../../events/EventContext';
import { useEntitlements } from '../../lib/entitlements';
import type { StudioAction, StudioKind, StudioState } from '../../lib/studio/state';
import { SectionLabel } from './StudioControls';
import AiFramePanel from './AiFramePanel';
import AiGeneratePanel from '../admin/creator3d/AiGeneratePanel';
import type { DragPayload } from './useStudioDnd';
import type { Experience } from '../../types';

interface Props {
  state: StudioState;
  dispatch: React.Dispatch<StudioAction>;
  onOpenExperience: (exp: Experience) => void;
  beginDrag: (payload: DragPayload, e: React.PointerEvent) => void;
  consumedDrag: () => boolean;
}

const KIND_TABS: { id: StudioKind; label: string; icon: typeof Sparkles }[] = [
  { id: 'shader', label: 'Filter', icon: Sparkles },
  { id: 'border', label: 'Frame', icon: LayoutTemplate },
  { id: '2d_filter', label: 'Sticker', icon: ImageIcon },
  { id: '3d_attachment', label: '3D', icon: Boxes },
];

export default function AssetsDock({ state, dispatch, onOpenExperience, beginDrag, consumedDrag }: Props) {
  const { draft, mode } = state;
  const { source } = useEvent();
  const entitlements = useEntitlements();
  const imgInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);

  const show3dAi = source === 'db' && entitlements.aiStudio;

  const onImageUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    dispatch({ type: 'SET_OVERLAY_UPLOAD', url: URL.createObjectURL(file), blob: file });
    e.target.value = '';
  }, [dispatch]);

  const onGlbUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const url = await uploadAsset(file, file.name);
    if (url) dispatch({ type: 'SET_MODEL_ASSET', url, name: file.name });
  }, [dispatch]);

  return (
    <div className="h-full overflow-y-auto hide-scrollbar p-4 flex flex-col gap-5">
      {/* Experience-type selector */}
      <div>
        <SectionLabel>Experience type</SectionLabel>
        <div className="grid grid-cols-4 gap-1.5">
          {KIND_TABS.map((t) => {
            const active = draft.kind === t.id;
            return (
              <button
                key={t.id}
                onClick={() => dispatch({ type: 'SET_KIND', kind: t.id })}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-[8px] font-label uppercase tracking-widest transition-all ${active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'}`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* SHADER list */}
      {draft.kind === 'shader' && mode === '2d' && (
        <div>
          <SectionLabel>Filter effect</SectionLabel>
          <div className="flex flex-col gap-1">
            {FILTER_SHADERS.map((s) => {
              const active = draft.shaderId === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => dispatch({ type: 'SELECT_SHADER', shaderId: s.id, params: defaultParams(s.id) })}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${active ? 'bg-accent/15 ring-1 ring-accent/30' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}
                >
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-sans font-medium ${active ? 'text-accent-2' : 'text-brand-fg'}`}>{s.name}</p>
                    {s.animated && <span className="text-[7px] font-label uppercase tracking-widest text-accent-2/60 bg-accent/10 px-1.5 py-0.5 rounded-full">Anim</span>}
                  </div>
                  <p className="text-[9px] text-brand-muted/40 mt-0.5 leading-tight">{s.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* BORDER / STICKER built-ins */}
      {(draft.kind === 'border' || draft.kind === '2d_filter') && mode === '2d' && (
        <>
          <div>
            <SectionLabel>{draft.kind === 'border' ? 'Built-in frames' : 'Built-in stickers'}</SectionLabel>
            <div className="flex flex-col gap-1">
              {BUILTIN_BORDERS.filter((b) => b.kind === draft.kind).map((b) => {
                const active = draft.selectedBorderId === b.id && draft.overlayIsBuiltin;
                const url = toDataUrl(b.svg);
                return (
                  <button
                    key={b.id}
                    onPointerDown={(e) => beginDrag({ target: 'overlay', label: b.name, overlayKind: b.kind, builtinId: b.id, builtinUrl: url, previewUrl: url }, e)}
                    onClick={() => { if (consumedDrag()) return; dispatch({ type: 'SELECT_BUILTIN', borderId: b.id, url }); }}
                    title="Click to add · drag onto the canvas to place"
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors text-xs font-sans cursor-grab active:cursor-grabbing ${active ? 'bg-accent/15 ring-1 ring-accent/30 text-accent-2' : 'bg-white/[0.03] hover:bg-white/[0.06] text-brand-muted/70 hover:text-brand-fg'}`}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <SectionLabel>Upload custom (PNG / SVG)</SectionLabel>
            <button
              onClick={() => imgInputRef.current?.click()}
              className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-xs text-brand-muted/70"
            >
              <Upload className="w-3.5 h-3.5 text-accent-2" /> Browse file…
            </button>
            <input ref={imgInputRef} type="file" accept="image/png,image/svg+xml,image/webp" className="sr-only" onChange={onImageUpload} />
          </div>
          <AiFramePanel
            kind={draft.kind}
            freeTrial={!entitlements.aiStudio}
            onGenerated={(exp) => {
              if (exp.asset_url) dispatch({ type: 'SET_OVERLAY_UPLOAD', url: exp.asset_url, blob: null });
              if (draft.name.startsWith('Untitled') && exp.name) dispatch({ type: 'SET_NAME', name: exp.name });
            }}
          />
        </>
      )}

      {/* 3D asset + anchors */}
      {draft.kind === '3d_attachment' && (
        <>
          <div>
            <SectionLabel><span className="inline-flex items-center gap-1.5"><Crown className="w-3 h-3 text-accent-2" /> Head pieces</span></SectionLabel>
            <div className="grid grid-cols-2 gap-1.5">
              {HEAD_PIECES.map((p) => {
                const active = draft.proceduralId === p.id;
                return (
                  <button
                    key={p.id}
                    onPointerDown={(e) => beginDrag({ target: 'headpiece', label: p.name, pieceId: p.id }, e)}
                    onClick={() => { if (consumedDrag()) return; dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: p.id }); }}
                    title="Click to add · drag onto the head to place"
                    className={`rounded-xl px-2 py-2 text-left transition-all border cursor-grab active:cursor-grabbing ${active ? 'bg-accent/15 border-accent/40 text-accent-2' : 'bg-white/[0.03] border-white/10 text-brand-muted/60 hover:text-brand-fg hover:border-accent/25'}`}
                  >
                    <span className="font-label text-[9px] uppercase tracking-wide leading-tight block">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <SectionLabel>Upload model (.glb / .gltf)</SectionLabel>
            <button
              onClick={() => glbInputRef.current?.click()}
              className="flex flex-col items-center gap-1.5 w-full px-3 py-4 rounded-xl border border-dashed border-white/15 bg-white/[0.02] hover:border-accent/40 transition-colors text-brand-muted/60"
            >
              <Upload className="w-4 h-4 text-accent-2" />
              <span className="font-label text-[9px] uppercase tracking-widest text-center">{draft.assetName ?? 'Drop a .glb or click'}</span>
            </button>
            <input ref={glbInputRef} type="file" accept=".glb,.gltf" className="sr-only" onChange={onGlbUpload} />
          </div>

          <div>
            <SectionLabel>Anchor point</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {ANCHOR_PRESETS.map((p) => {
                const active = p.id === draft.anchor;
                return (
                  <button
                    key={p.id}
                    onClick={() => dispatch({ type: 'SELECT_ANCHOR', anchor: p.id })}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-all flex flex-col gap-0.5 ${active ? 'bg-accent/10 ring-1 ring-accent/25' : 'hover:bg-white/[0.05]'}`}
                  >
                    <span className={`font-label text-[10px] uppercase tracking-widest ${active ? 'text-accent-2' : 'text-brand-fg/80'}`}>{p.label}</span>
                    <span className="font-sans text-[9px] text-brand-muted/40 leading-tight">{p.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {show3dAi && <AiGeneratePanel onOpenExperience={onOpenExperience} />}
        </>
      )}
    </div>
  );
}
