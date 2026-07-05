/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UploadStack — the premium "review your uploads" gallery shown right after a
 * bulk drop. Every photo/video lands here as a card in a responsive stack so
 * guests can see the whole batch at a glance and curate it before framing:
 *   • tap the ✕ to delete any single shot,
 *   • multi-select and remove several at once, or clear the batch,
 *   • see which shots already carry a frame, and add more any time.
 *
 * Cards render through FramedThumb, so a framed shot previews exactly as it will
 * appear on the wall.
 */
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, X, CheckSquare, Square, Layers, Images, Film } from 'lucide-react';
import { Experience } from '../../types';
import { UploadItem } from './types';
import FramedThumb from './FramedThumb';
import UploadDropzone from './UploadDropzone';

interface Props {
  items: UploadItem[];
  frames: Experience[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onRemoveSelected: () => void;
  onClearAll: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onAddFiles: (files: File[]) => void;
  /** Jump straight into framing this card. */
  onOpenItem: (id: string) => void;
}

export default function UploadStack({
  items, frames, selectedIds,
  onToggleSelect, onRemove, onRemoveSelected, onClearAll,
  onSelectAll, onClearSelection, onAddFiles, onOpenItem,
}: Props) {
  const framedCount = items.filter((i) => i.kind === 'image' && i.frameId).length;
  const selCount = selectedIds.size;
  const allSelected = selCount > 0 && selCount === items.length;

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Toolbar — counts + bulk actions */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-champagne/70">
            <Images className="w-4 h-4 text-gold-400/80" /> {items.length} {items.length === 1 ? 'shot' : 'shots'}
          </span>
          {framedCount > 0 && (
            <span className="hidden sm:flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-gold-300/70">
              <Layers className="w-3.5 h-3.5" /> {framedCount} framed
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={allSelected ? onClearSelection : onSelectAll}
            className="flex items-center gap-1.5 px-3 py-2 glass rounded-xl text-[9px] font-label uppercase tracking-luxe text-champagne/70 hover:text-gold-300 border border-gold-400/15 hover:border-gold-400/35 transition-colors"
          >
            {allSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
            {allSelected ? 'Clear' : 'Select all'}
          </button>
          <AnimatePresence>
            {selCount > 0 && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={onRemoveSelected}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-label uppercase tracking-luxe text-red-200 bg-red-500/15 border border-red-400/30 hover:bg-red-500/25 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove ({selCount})
              </motion.button>
            )}
          </AnimatePresence>
          <button
            onClick={onClearAll}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 glass rounded-xl text-[9px] font-label uppercase tracking-luxe text-champagne/50 hover:text-red-200 border border-transparent hover:border-red-400/25 transition-colors"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* Stack grid */}
      <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar -mx-1 px-1 pb-1">
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))' }}
        >
          <AnimatePresence initial={false}>
            {items.map((item, i) => {
              const checked = selectedIds.has(item.id);
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 16, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.4, delay: Math.min(i * 0.025, 0.5), ease: [0.22, 1, 0.36, 1] }}
                  className={`group relative aspect-[9/16] rounded-xl overflow-hidden cursor-pointer transition-shadow ${
                    checked ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-noir-900' : 'ring-1 ring-gold-400/10'
                  }`}
                  onClick={() => onOpenItem(item.id)}
                  style={{ boxShadow: '0 6px 24px rgba(0,0,0,0.5)' }}
                >
                  <FramedThumb item={item} frames={frames} fit="contain" className="w-full h-full" rounded="rounded-xl" />

                  {/* top scrim for controls legibility */}
                  <div className="absolute inset-x-0 top-0 h-11 pointer-events-none"
                    style={{ background: 'linear-gradient(to bottom, rgba(10,7,3,0.6), transparent)' }} />

                  {/* index */}
                  <span className="absolute bottom-1.5 left-2 font-label text-[9px] tracking-wide text-champagne/70 bg-noir-900/50 rounded px-1.5 py-0.5">
                    {i + 1}
                  </span>

                  {/* frame badge */}
                  {item.kind === 'image' && item.frameId && (
                    <span className="absolute bottom-1.5 right-2 flex items-center gap-1 bg-noir-900/55 rounded px-1.5 py-0.5">
                      <Layers className="w-2.5 h-2.5 text-gold-300" />
                    </span>
                  )}
                  {item.kind === 'video' && (
                    <span className="absolute bottom-1.5 right-2 flex items-center gap-1 bg-noir-900/55 rounded px-1.5 py-0.5">
                      <Film className="w-2.5 h-2.5 text-champagne/80" />
                    </span>
                  )}

                  {/* select */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(item.id); }}
                    className="absolute top-1.5 left-1.5 text-gold-200 bg-noir-900/55 rounded-md p-1 hover:bg-noir-900/80 transition-colors"
                    aria-label={checked ? 'Deselect' : 'Select'}
                    title={checked ? 'Deselect' : 'Select'}
                  >
                    {checked ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5 opacity-80" />}
                  </button>

                  {/* delete */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                    className="absolute top-1.5 right-1.5 text-red-200 bg-noir-900/55 rounded-md p-1 opacity-80 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500/40 transition-all"
                    aria-label="Delete this shot"
                    title="Delete"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Add-more tile */}
          <div className="aspect-[9/16] rounded-xl flex items-center justify-center border border-dashed border-gold-400/25 hover:border-gold-400/50 transition-colors">
            <UploadDropzone count={items.length} onAdd={onAddFiles} tile />
          </div>
        </div>
      </div>
    </div>
  );
}
