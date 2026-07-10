/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useStudioDnd — hand-rolled pointer drag-and-drop for the studio (no dnd-kit).
 * Drag a source from the AssetsDock onto the stage:
 *   • image/frame/sticker → sets the overlay and positions it at the drop point
 *     using booth Transform2D semantics (pointToTransform2D).
 *   • 3D model / head piece → selects it, enters 3D mode, and (when a live head
 *     is tracked) snaps to the nearest projected anchor.
 * A movement threshold distinguishes a drag from a plain click, so click-to-add
 * still works on the same source elements.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ANCHOR_PRESETS, RIG_CAMERA } from '../../lib/faceRig';
import { pointToTransform2D, projectAnchorsToScreen, nearestAnchor, type AnchorPoint } from '../../lib/studio/dnd';
import { DEFAULT_TRANSFORM, MAX_OBJECTS, sceneCounts, type StudioAction, type StudioDraft } from '../../lib/studio/state';

export interface DragPayload {
  target: 'overlay' | 'model' | 'headpiece';
  label: string;
  previewUrl?: string | null;
  overlayKind?: 'border' | '2d_filter';
  builtinId?: string;
  builtinUrl?: string;
  assetUrl?: string;
  pieceId?: string;
}

const THRESHOLD = 6; // px before a press becomes a drag
const SNAP_RADIUS = 70; // px to snap a 3D drop to an anchor

const ANCHOR_POINTS: AnchorPoint[] = ANCHOR_PRESETS.map((p) => ({ id: p.id, offset: p.offset }));

interface Options {
  dispatch: React.Dispatch<StudioAction>;
  stageBodyRef: React.RefObject<HTMLElement | null>;
  headMatrixRef: React.RefObject<number[] | null>;
  /** Always-current draft (a ref, not state — window listeners must not close
   *  over stale drops). Used to reject drops at the MAX_OBJECTS cap, where the
   *  add would no-op and the follow-up SET_TRANSFORM would otherwise relocate
   *  the previously-selected object to the drop point. */
  draftRef: React.RefObject<StudioDraft | null>;
}

export function useStudioDnd({ dispatch, stageBodyRef, headMatrixRef, draftRef }: Options) {
  const [payload, setPayload] = useState<DragPayload | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [overStage, setOverStage] = useState(false);

  const pending = useRef<{ payload: DragPayload; startX: number; startY: number } | null>(null);
  const active = useRef(false);
  const wasDrag = useRef(false);

  const insideStage = useCallback((x: number, y: number) => {
    const el = stageBodyRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? r : null;
  }, [stageBodyRef]);

  const resolveDrop = useCallback((p: DragPayload, x: number, y: number, rect: DOMRect) => {
    // Cap guard: the cappable count (stickers + 3D) is what the reducer's add
    // actions reject on — the single frame is EXEMPT (it swaps via placeFrame,
    // which always succeeds), so frame drops skip this guard entirely. For the
    // rest, at the cap the add no-ops and the follow-up SET_TRANSFORM would then
    // relocate the previously-selected object to the drop point — reject the
    // whole drop instead. (Slight over-reject: an untouched same-kind swap could
    // still fit at the cap, but that's a non-case worth the simplicity.)
    const isFrameDrop = p.target === 'overlay' && (p.overlayKind ?? 'border') === 'border';
    const cur = draftRef.current;
    if (!isFrameDrop && cur && sceneCounts(cur).capped >= MAX_OBJECTS) return;
    // NOTE on add semantics: the click-to-add actions (SELECT_BUILTIN,
    // SET_OVERLAY_UPLOAD, SELECT_HEAD_PIECE, SET_MODEL_ASSET) ALWAYS APPEND in
    // the reducer (state.ts appendObject; the one frame swaps via placeFrame)
    // AND flip the view to the right world. So a drop dispatches the SAME
    // actions as a click, then positions the now-selected object — no
    // dnd-specific ADD_OBJECT and no SET_KIND view-flip needed.
    if (p.target === 'overlay') {
      if (p.builtinUrl && p.builtinId) {
        dispatch({ type: 'SELECT_BUILTIN', borderId: p.builtinId, url: p.builtinUrl });
      } else if (p.assetUrl) {
        // Pass the drag payload's sub-kind through — a sticker dragged from the
        // Sticker catalog must not default to 'border' in the reducer.
        dispatch({ type: 'SET_OVERLAY_UPLOAD', url: p.assetUrl, blob: null, overlayKind: p.overlayKind });
      }
      // Position the just-added/replaced (now-selected) overlay at the drop point.
      dispatch({
        type: 'SET_TRANSFORM',
        transform: pointToTransform2D(x, y, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, DEFAULT_TRANSFORM),
      });
      return;
    }

    if (p.target === 'headpiece' && p.pieceId) {
      dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: p.pieceId });
    } else if (p.target === 'model' && p.assetUrl) {
      dispatch({ type: 'SET_MODEL_ASSET', url: p.assetUrl, name: p.label });
    }

    // Snap to the nearest live-tracked anchor if the head is visible.
    const matrix = headMatrixRef.current;
    if (matrix) {
      const projected = projectAnchorsToScreen(ANCHOR_POINTS, matrix, { width: rect.width, height: rect.height }, RIG_CAMERA.fov);
      const hit = nearestAnchor(projected, x - rect.left, y - rect.top, SNAP_RADIUS);
      if (hit) dispatch({ type: 'SELECT_ANCHOR', anchor: hit });
    }
  }, [dispatch, headMatrixRef, draftRef]);

  const endDrag = useCallback((clientX: number, clientY: number) => {
    // Read the payload from the ref (window listeners captured at beginDrag time
    // would otherwise see a stale `payload` state value).
    const p = active.current ? pending.current?.payload ?? null : null;
    if (p) {
      const rect = insideStage(clientX, clientY);
      if (rect) resolveDrop(p, clientX, clientY, rect);
    }
    active.current = false;
    pending.current = null;
    setPayload(null);
    setGhost(null);
    setOverStage(false);
  }, [insideStage, resolveDrop]);

  const onMove = useCallback((e: PointerEvent) => {
    const pend = pending.current;
    if (!pend) return;
    if (!active.current) {
      if (Math.hypot(e.clientX - pend.startX, e.clientY - pend.startY) < THRESHOLD) return;
      active.current = true;
      wasDrag.current = true;
      setPayload(pend.payload);
    }
    setGhost({ x: e.clientX, y: e.clientY });
    setOverStage(!!insideStage(e.clientX, e.clientY));
  }, [insideStage]);

  const detach = useCallback((fn: (e: PointerEvent) => void) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', fn);
    window.removeEventListener('pointercancel', fn);
  }, [onMove]);

  const onUp = useCallback((e: PointerEvent) => {
    detach(onUp);
    if (e.type === 'pointercancel') {
      // Aborted — e.g. a touch-drag inside a scrollable dock became a scroll.
      // Reset without resolving a drop, and never leak the window listeners.
      active.current = false;
      pending.current = null;
      setPayload(null);
      setGhost(null);
      setOverStage(false);
    } else {
      endDrag(e.clientX, e.clientY);
    }
  }, [detach, endDrag]);

  const beginDrag = useCallback((p: DragPayload, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    wasDrag.current = false;
    pending.current = { payload: p, startX: e.clientX, startY: e.clientY };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [onMove, onUp]);

  // Never leave a drag's window listeners attached past unmount.
  useEffect(() => () => detach(onUp), [detach, onUp]);

  /** True if the last pointer interaction became a drag (guards onClick). */
  const consumedDrag = useCallback(() => {
    const d = wasDrag.current;
    wasDrag.current = false;
    return d;
  }, []);

  return { payload, ghost, overStage, dragging: !!payload, beginDrag, consumedDrag };
}
