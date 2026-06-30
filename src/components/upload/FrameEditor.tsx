/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FrameEditor — the "out-of-frame" editing section. Mobile-first: on phones the
 * preview sits on top with a horizontal frame rail beneath it; on sm+ the frame
 * rail moves to a vertical sidebar on the left. A reorderable thumbnail strip
 * runs along the bottom (drag on desktop, ◀/▶ move buttons on touch) with bulk
 * actions (apply-to-all / apply-to-selected / remove).
 */
import { useState } from 'react';
import { Experience } from '../../types';
import { UploadItem } from './types';
import { DEFAULT_CROP } from '../booth/capture';
import CropStage, { MIN_ZOOM, MAX_ZOOM, clampCrop } from './CropStage';
import UploadDropzone from './UploadDropzone';
import {
  Ban, RotateCcw, RotateCw, Maximize, Trash2, CheckSquare, Square,
  Layers, CheckCheck, Film, ChevronLeft, ChevronRight,
} from 'lucide-react';

interface Props {
  items: UploadItem[];
  frames: Experience[];
  activeId: string | null;
  selectedIds: Set<string>;
  onSetActive: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<UploadItem>) => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onApplyFrameToAll: (frameId: string | null) => void;
  onApplyFrameToSelected: (frameId: string | null) => void;
  onAddFiles: (files: File[]) => void;
}

function frameThumbSrc(exp: Experience): string | undefined {
  return exp.thumbnail_url || exp.asset_url || undefined;
}

export default function FrameEditor({
  items, frames, activeId, selectedIds,
  onSetActive, onToggleSelect, onUpdate, onRemove, onReorder,
  onApplyFrameToAll, onApplyFrameToSelected, onAddFiles,
}: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const active = items.find((i) => i.id === activeId) ?? null;
  const activeIsVideo = active?.kind === 'video';
  const activeFramed = !!active && !activeIsVideo && !!active.frameId;

  const setFrameForActive = (frameId: string | null) => {
    if (!active || activeIsVideo) return;
    onUpdate(active.id, { frameId });
  };

  const patchCrop = (patch: Partial<UploadItem['crop']>) => {
    if (!active) return;
    onUpdate(active.id, {
      crop: clampCrop({ ...active.crop, ...patch }, active.naturalW ?? 1, active.naturalH ?? 1),
    });
  };

  const frameCells = (
    <>
      <FrameCell
        label="No frame"
        selected={!active?.frameId}
        disabled={activeIsVideo}
        onClick={() => setFrameForActive(null)}
      >
        <Ban className="w-5 h-5 text-champagne/40" />
      </FrameCell>
      {frames.map((exp) => {
        const src = frameThumbSrc(exp);
        return (
          <FrameCell
            key={exp.id}
            label={exp.name}
            selected={active?.frameId === exp.id}
            disabled={activeIsVideo}
            onClick={() => setFrameForActive(exp.id)}
          >
            {src ? (
              <img src={src} alt={exp.name} className="w-full h-full object-contain p-1" />
            ) : (
              <span className="text-gold-400/60 text-lg">▣</span>
            )}
          </FrameCell>
        );
      })}
      {frames.length === 0 && (
        <p className="text-[10px] text-champagne/30 font-label italic px-1">Loading frames…</p>
      )}
    </>
  );

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 sm:gap-4">
      <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-3 sm:gap-4">
        {/* ── Frame rail — sidebar on sm+, horizontal scroller on mobile ── */}
        <div className="order-2 sm:order-1 shrink-0 sm:w-[148px] flex flex-col glass rounded-2xl border border-gold-400/15 overflow-hidden">
          <div className="px-3 py-2 sm:py-2.5 border-b border-gold-400/10 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-gold-400/70" />
            <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/50">Frames</span>
            {activeIsVideo && (
              <span className="ml-auto font-label uppercase tracking-wide text-[8px] text-champagne/35">Photos only</span>
            )}
          </div>
          <div className="flex flex-row sm:flex-col gap-2 sm:gap-2.5 p-2.5 overflow-x-auto sm:overflow-y-auto hide-scrollbar [&>button]:w-16 sm:[&>button]:w-full [&>button]:shrink-0">
            {frameCells}
          </div>
        </div>

        {/* ── Preview + tools ────────────────────────────────────── */}
        <div className="order-1 sm:order-2 flex-1 min-w-0 min-h-0 flex flex-col gap-3">
          <div className="flex-1 min-h-0 max-h-[50vh] sm:max-h-none">
            {!active ? (
              <div className="h-full flex items-center justify-center text-champagne/30 font-serif italic text-lg">
                Select a photo below
              </div>
            ) : activeIsVideo ? (
              <div className="relative mx-auto h-full max-h-full aspect-[9/16] overflow-hidden rounded-2xl bg-noir-900 shadow-2xl flex items-center justify-center" style={{ border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
                <video src={active.srcUrl} className="max-h-full max-w-full object-contain" autoPlay loop muted playsInline />
                <div className="absolute top-3 left-3 glass rounded-full px-2.5 py-1 flex items-center gap-1.5">
                  <Film className="w-3 h-3 text-champagne/70" />
                  <span className="font-label text-[8px] uppercase tracking-wide text-champagne/60">Video · no frame</span>
                </div>
              </div>
            ) : (
              <CropStage
                srcUrl={active.srcUrl}
                imgW={active.naturalW ?? 1080}
                imgH={active.naturalH ?? 1920}
                frameUrl={
                  active.frameId
                    ? frames.find((f) => f.id === active.frameId)?.asset_url ?? null
                    : null
                }
                crop={active.crop}
                onChange={(crop) => onUpdate(active.id, { crop })}
              />
            )}
          </div>

          {/* Crop tools (only meaningful for a framed image) */}
          {active && !activeIsVideo && (
            <div className="shrink-0 glass rounded-2xl border border-gold-400/15 px-4 py-3">
              {activeFramed ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                    <Maximize className="w-3.5 h-3.5 text-gold-400/70 shrink-0" />
                    <input
                      type="range"
                      min={MIN_ZOOM}
                      max={MAX_ZOOM}
                      step={0.01}
                      value={active.crop.zoom}
                      onChange={(e) => patchCrop({ zoom: parseFloat(e.target.value) })}
                      className="w-full accent-gold-400"
                      aria-label="Zoom"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ToolBtn title="Rotate left" onClick={() => patchCrop({ rotation: (active.crop.rotation - 90) % 360 })}>
                      <RotateCcw className="w-4 h-4" />
                    </ToolBtn>
                    <ToolBtn title="Rotate right" onClick={() => patchCrop({ rotation: (active.crop.rotation + 90) % 360 })}>
                      <RotateCw className="w-4 h-4" />
                    </ToolBtn>
                    <ToolBtn title="Reset crop" onClick={() => onUpdate(active.id, { crop: { ...DEFAULT_CROP } })}>
                      <span className="font-label text-[9px] uppercase tracking-wide px-1">Reset</span>
                    </ToolBtn>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-champagne/45 font-sans text-center">
                  Pick a frame to crop &amp; position — drag to pan, pinch or scroll to zoom. With no frame, the photo uploads at its original size.
                </p>
              )}
            </div>
          )}

          {/* Bulk actions */}
          {active && (
            <div className="shrink-0 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onApplyFrameToAll(active.frameId)}
                className="flex items-center gap-1.5 px-3 py-2 glass rounded-xl text-[9px] font-label uppercase tracking-luxe text-champagne/70 hover:text-gold-300 border border-gold-400/15 hover:border-gold-400/35 transition-colors"
                title="Use the current photo's frame on every photo"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Apply frame to all
              </button>
              <button
                onClick={() => onApplyFrameToSelected(active.frameId)}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1.5 px-3 py-2 glass rounded-xl text-[9px] font-label uppercase tracking-luxe text-champagne/70 hover:text-gold-300 border border-gold-400/15 hover:border-gold-400/35 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                title="Apply to checked photos"
              >
                <CheckSquare className="w-3.5 h-3.5" /> Apply to selected ({selectedIds.size})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Thumbnail strip (reorder + select + remove) ──────────── */}
      <div className="shrink-0">
        <div className="flex items-center gap-3 overflow-x-auto hide-scrollbar pb-1">
          {items.map((item, index) => {
            const checked = selectedIds.has(item.id);
            const isActive = item.id === activeId;
            const frameSrc = item.frameId ? frames.find((f) => f.id === item.frameId)?.asset_url : null;
            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index);
                  setDragIndex(null);
                }}
                onClick={() => onSetActive(item.id)}
                className={`group relative shrink-0 w-16 h-[114px] rounded-xl overflow-hidden cursor-pointer transition-all ${
                  isActive
                    ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-noir-900'
                    : 'opacity-75 hover:opacity-100'
                }`}
                style={{ background: 'linear-gradient(135deg, #1A130C, #2a1f0f)' }}
              >
                {item.kind === 'video' ? (
                  <video src={item.srcUrl} className="w-full h-full object-cover" muted />
                ) : (
                  <img src={item.srcUrl} alt="" className="w-full h-full object-cover" />
                )}
                {frameSrc && (
                  <img src={frameSrc} alt="" aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" />
                )}
                {item.kind === 'video' && (
                  <div className="absolute inset-x-0 bottom-7 flex justify-center pointer-events-none">
                    <span className="bg-noir-900/70 rounded-full px-1.5 py-0.5 flex items-center gap-1">
                      <Film className="w-2.5 h-2.5 text-champagne/80" />
                    </span>
                  </div>
                )}

                {/* select checkbox */}
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleSelect(item.id); }}
                  className="absolute top-1 right-1 text-gold-300 bg-noir-900/60 rounded p-0.5"
                  title={checked ? 'Deselect' : 'Select'}
                >
                  {checked ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5 opacity-70" />}
                </button>

                {/* remove */}
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                  className="absolute top-1 left-1 text-red-300/90 bg-noir-900/60 rounded p-0.5 opacity-70 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {/* touch-friendly move controls (always tappable; the active item
                    is highlighted so it's clear what moves) */}
                <button
                  onClick={(e) => { e.stopPropagation(); onSetActive(item.id); if (index > 0) onReorder(index, index - 1); }}
                  disabled={index === 0}
                  className="absolute bottom-1 left-1 text-champagne/80 bg-noir-900/65 rounded p-0.5 disabled:opacity-20"
                  title="Move left"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onSetActive(item.id); if (index < items.length - 1) onReorder(index, index + 1); }}
                  disabled={index === items.length - 1}
                  className="absolute bottom-1 right-1 text-champagne/80 bg-noir-900/65 rounded p-0.5 disabled:opacity-20"
                  title="Move right"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          <div className="shrink-0 self-center">
            <UploadDropzone count={items.length} onAdd={onAddFiles} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

function FrameCell({
  children, label, selected, disabled, onClick,
}: {
  children: React.ReactNode; label: string; selected: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 group disabled:opacity-30 disabled:pointer-events-none"
      aria-pressed={selected}
    >
      <div
        className={`w-full aspect-[9/16] rounded-lg overflow-hidden flex items-center justify-center border transition-all ${
          selected
            ? 'ring-2 ring-gold-400 border-gold-400/40'
            : 'border-ivory/10 group-hover:border-gold-400/30'
        }`}
        style={{ background: 'linear-gradient(135deg, #15100a, #221806)' }}
      >
        {children}
      </div>
      <span className={`font-label text-[7px] uppercase tracking-wide text-center leading-tight line-clamp-1 ${selected ? 'text-gold-300' : 'text-champagne/45'}`}>
        {label}
      </span>
    </button>
  );
}

function ToolBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center min-w-8 h-8 px-1.5 glass rounded-lg text-champagne/60 hover:text-gold-300 transition-colors"
    >
      {children}
    </button>
  );
}
