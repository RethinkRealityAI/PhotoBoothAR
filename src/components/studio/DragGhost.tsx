/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DragGhost — the floating preview that follows the pointer during a studio
 * drag. Portal-rendered so it escapes panel overflow; pointer-events-none so it
 * never eats the drop.
 */
import { createPortal } from 'react-dom';
import { Boxes, Crown, Image as ImageIcon } from 'lucide-react';
import type { DragPayload } from './useStudioDnd';

const ICONS = {
  overlay: ImageIcon,
  model: Boxes,
  headpiece: Crown,
} as const;

export default function DragGhost({ payload, ghost }: { payload: DragPayload | null; ghost: { x: number; y: number } | null }) {
  if (!payload || !ghost || typeof document === 'undefined') return null;
  const Icon = ICONS[payload.target];
  return createPortal(
    <div
      className="fixed z-[120] pointer-events-none -translate-x-1/2 -translate-y-1/2"
      style={{ left: ghost.x, top: ghost.y }}
    >
      <div className="flex items-center gap-2 rounded-xl liquid-glass px-2.5 py-2 shadow-2xl ring-1 ring-accent/40">
        {payload.previewUrl ? (
          <img src={payload.previewUrl} alt="" className="w-9 h-9 rounded-lg object-cover" />
        ) : (
          <span className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center">
            <Icon className="w-4 h-4 text-accent-2" />
          </span>
        )}
        <span className="font-label text-[9px] uppercase tracking-widest text-brand-fg max-w-[9rem] truncate">{payload.label}</span>
      </div>
    </div>,
    document.body,
  );
}
