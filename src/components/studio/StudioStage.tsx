/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StudioStage — the studio's single center canvas. It owns the ONE persistent
 * <video id="studio-video"> (never unmounted, so the shared stream survives
 * every mode switch) and layers the right content over it per mode:
 *   • 2d      — mirrored video + shader canvas (shader kind) OR draggable
 *               border/sticker overlay (Transform2D, booth semantics)
 *   • 3d      — Studio3DView (live face rig / orbit) reading the same video
 *   • preview — StudioPreview (booth-parity composite)
 * The in-canvas segmented mode switcher lives here as a floating liquid-glass
 * pill; 3D adds a Live/Orbit + Pause sub-control.
 */
import { useCallback, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Boxes, Eye, Layers, Pause, Play, ScanFace, Sparkles, Rotate3d, AlertTriangle } from 'lucide-react';
import { ShaderRunner } from '../../lib/shaders';
import { pointToTransform2D } from '../../lib/studio/dnd';
import type { StudioState, StudioAction } from '../../lib/studio/state';
import Studio3DView from './Studio3DView';
import StudioPreview from './StudioPreview';
import Tooltip from '../ui/Tooltip';

interface CamState {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  error: string | null;
  retry: () => void;
}

interface Props {
  state: StudioState;
  dispatch: React.Dispatch<StudioAction>;
  cam: CamState;
  headScale: number;
  occlusionEnabled: boolean;
  debugOcclusion: boolean;
  faceVisible: boolean;
  onFaceVisible: (v: boolean) => void;
  /** Drop-target ref + live-head matrix for drag-and-drop. */
  stageBodyRef?: React.RefObject<HTMLDivElement | null>;
  headMatrixRef?: React.MutableRefObject<number[] | null>;
  /** True while a dock item is being dragged over the stage (drop highlight). */
  dropActive?: boolean;
}

const MODE_TABS = [
  { id: '2d' as const, label: '2D', icon: Layers, hint: 'Frames, stickers & filters' },
  { id: '3d' as const, label: '3D', icon: Boxes, hint: 'Head-anchored AR pieces' },
  { id: 'preview' as const, label: 'Preview', icon: Eye, hint: 'See it exactly as guests will' },
];

export default function StudioStage({
  state,
  dispatch,
  cam,
  headScale,
  occlusionEnabled,
  debugOcclusion,
  faceVisible,
  onFaceVisible,
  stageBodyRef,
  headMatrixRef,
  dropActive = false,
}: Props) {
  const { mode, draft, threeView, paused } = state;
  const shaderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<ShaderRunner | null>(null);
  const rafRef = useRef<number>(0);
  const overlayBoxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);

  // Shader runner — created once, disposed on unmount.
  useEffect(() => {
    try {
      runnerRef.current = new ShaderRunner(720, 1280);
    } catch {
      runnerRef.current = null;
    }
    return () => { runnerRef.current?.dispose?.(); };
  }, []);

  // Shader render loop — ONLY in 2D shader mode (avoids the ghosted double
  // camera and needless GPU work otherwise).
  const shaderActive = mode === '2d' && draft.kind === 'shader';
  const { shaderId, shaderParams } = draft;
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (!shaderActive) return;
    const loop = () => {
      const video = cam.videoRef.current;
      const canvas = shaderCanvasRef.current;
      const runner = runnerRef.current;
      if (video && video.readyState >= 2 && canvas && runner?.available) {
        const result = runner.draw(video, shaderId, shaderParams);
        if (result) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = canvas.offsetWidth || 540;
            canvas.height = canvas.offsetHeight || 960;
            ctx.drawImage(result, 0, 0, canvas.width, canvas.height);
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [shaderActive, shaderId, shaderParams, cam.videoRef]);

  // 2D overlay reposition via pointer drag (border/sticker). Booth Transform2D
  // semantics — x/y are % of the frame from centre (see StageCanvas).
  const isOverlayKind = draft.kind === 'border' || draft.kind === '2d_filter';
  const canDragOverlay = mode === '2d' && isOverlayKind && !!draft.overlayUrl;

  const onOverlayPointerDown = useCallback((e: React.PointerEvent) => {
    if (!canDragOverlay) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, tx: draft.transform.x, ty: draft.transform.y };
  }, [canDragOverlay, draft.transform.x, draft.transform.y]);

  const onOverlayPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const box = overlayBoxRef.current;
    if (!d || !box) return;
    const rect = box.getBoundingClientRect();
    const dx = ((e.clientX - d.startX) / rect.width) * 100;
    const dy = ((e.clientY - d.startY) / rect.height) * 100;
    dispatch({
      type: 'SET_TRANSFORM',
      transform: {
        ...draft.transform,
        x: Math.max(-100, Math.min(100, d.tx + dx)),
        y: Math.max(-100, Math.min(100, d.ty + dy)),
      },
    });
  }, [dispatch, draft.transform]);

  const onOverlayPointerUp = useCallback(() => { drag.current = null; }, []);

  const onOverlayWheel = useCallback((e: React.WheelEvent) => {
    if (!canDragOverlay) return;
    const next = Math.max(0.1, Math.min(5, draft.transform.scale + (e.deltaY > 0 ? -0.05 : 0.05)));
    dispatch({ type: 'SET_TRANSFORM', transform: { ...draft.transform, scale: next } });
  }, [canDragOverlay, dispatch, draft.transform]);

  const showVideo = mode !== 'preview';

  return (
    <div className="relative h-full w-full flex items-center justify-center p-3 md:p-5">
      {/* Mode switcher — floating pill */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30">
        <div className="flex items-center gap-1 liquid-glass rounded-full p-1">
          {MODE_TABS.map((t) => {
            const active = mode === t.id;
            return (
              <Tooltip key={t.id} label={t.label} hint={t.hint} side="bottom">
                <button
                  onClick={() => dispatch({ type: 'SET_MODE', mode: t.id })}
                  className="relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] font-label uppercase tracking-widest transition-colors"
                >
                  {active && (
                    <motion.span
                      layoutId="studio-mode-pill"
                      className="absolute inset-0 rounded-full bg-accent/20 ring-1 ring-accent/40"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <t.icon className={`relative w-3.5 h-3.5 ${active ? 'text-accent-2' : 'text-brand-muted/60'}`} />
                  <span className={`relative ${active ? 'text-brand-fg' : 'text-brand-muted/60'}`}>{t.label}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* 3D sub-controls */}
      {mode === '3d' && (
        <div className="absolute top-3 right-4 z-30 flex items-center gap-2">
          <div className="flex items-center gap-1 liquid-glass rounded-full p-1">
            {([
              { v: 'live' as const, icon: ScanFace, label: 'Live', hint: 'Track your real face (WYSIWYG)' },
              { v: 'orbit' as const, icon: Rotate3d, label: 'Orbit', hint: 'Reference head — orbit to inspect' },
            ]).map(({ v, icon: Icon, label, hint }) => (
              <Tooltip key={v} label={label} hint={hint} side="bottom">
                <button
                  onClick={() => dispatch({ type: 'SET_THREE_VIEW', view: v })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-label uppercase tracking-widest transition-colors ${threeView === v ? 'bg-accent/20 text-brand-fg ring-1 ring-accent/40' : 'text-brand-muted/60 hover:text-brand-fg'}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              </Tooltip>
            ))}
          </div>
          {threeView === 'live' && (
            <Tooltip label={paused ? 'Resume' : 'Pause'} hint="Freeze tracking to fine-tune placement" side="bottom">
              <button
                onClick={() => dispatch({ type: 'SET_PAUSED', paused: !paused })}
                className={`flex items-center justify-center w-8 h-8 rounded-full liquid-glass transition-colors ${paused ? 'text-accent-2 ring-1 ring-accent/40' : 'text-brand-muted/60 hover:text-brand-fg'}`}
              >
                {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {/* Stage body — 9:16 */}
      <div
        ref={stageBodyRef}
        className={`relative h-full rounded-2xl overflow-hidden liquid-glass transition-shadow ${dropActive ? 'ring-2 ring-accent shadow-[0_0_40px_-4px_var(--color-accent)]' : ''}`}
        style={{ aspectRatio: '9/16', maxWidth: '100%' }}
      >
        {/* The ONE camera element — always mounted so the stream persists. */}
        <video
          id="studio-video"
          ref={cam.videoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)', opacity: showVideo ? 1 : 0, pointerEvents: 'none' }}
        />

        {/* Shader output canvas (2D shader mode only) */}
        <canvas
          ref={shaderCanvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ transform: 'scaleX(-1)', opacity: shaderActive ? 1 : 0 }}
        />

        {/* 2D overlay (border / sticker) with drag-to-place */}
        {mode === '2d' && isOverlayKind && (
          <div
            ref={overlayBoxRef}
            className="absolute inset-0"
            onPointerDown={onOverlayPointerDown}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            onWheel={onOverlayWheel}
            style={{ touchAction: 'none', cursor: canDragOverlay ? 'grab' : 'default' }}
          >
            {draft.overlayUrl && (
              <img
                src={draft.overlayUrl}
                alt="overlay"
                draggable={false}
                className="absolute select-none"
                style={{
                  left: `calc(50% + ${draft.transform.x}%)`,
                  top: `calc(50% + ${draft.transform.y}%)`,
                  width: draft.kind === '2d_filter' ? '60%' : '100%',
                  height: draft.kind === '2d_filter' ? '60%' : '100%',
                  transform: `translate(-50%, -50%) scale(${draft.transform.scale}) rotate(${draft.transform.rotation}deg)`,
                  objectFit: 'contain',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        )}

        {/* 3D view */}
        {mode === '3d' && (
          <div className="absolute inset-0">
            <Studio3DView
              view={threeView}
              videoId="studio-video"
              assetUrl={draft.assetUrl}
              proceduralId={draft.proceduralId}
              anchor={draft.anchor}
              anchorConfig={draft.anchorConfig}
              paused={paused}
              headScale={headScale}
              debugOcclusion={debugOcclusion}
              matrixRef={headMatrixRef}
              onAnchorSelect={(a) => dispatch({ type: 'SELECT_ANCHOR', anchor: a })}
              onTransformChange={(patch) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch })}
              onFaceVisible={onFaceVisible}
              onGizmoDragStart={() => dispatch({ type: 'SET_PAUSED', paused: true })}
              onGizmoDragEnd={() => dispatch({ type: 'SET_PAUSED', paused: false })}
            />
          </div>
        )}

        {/* Preview */}
        {mode === 'preview' && (
          <div className="absolute inset-0">
            <StudioPreview
              videoRef={cam.videoRef}
              draft={draft}
              headScale={headScale}
              occlusionEnabled={occlusionEnabled}
              onFaceVisible={onFaceVisible}
            />
          </div>
        )}

        {/* Camera error */}
        {cam.error && showVideo && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-brand-bg/80 px-8 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <p className="font-label text-[11px] uppercase tracking-widest text-brand-muted">{cam.error}</p>
            <button onClick={cam.retry} className="rounded-full bg-foil px-4 py-2 text-[10px] font-label uppercase tracking-widest text-white">Retry camera</button>
          </div>
        )}

        {/* Status caption */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <StageCaption mode={mode} threeView={threeView} paused={paused} faceVisible={faceVisible} kind={draft.kind} />
        </div>
      </div>
    </div>
  );
}

function StageCaption({
  mode,
  threeView,
  paused,
  faceVisible,
  kind,
}: {
  mode: string;
  threeView: string;
  paused: boolean;
  faceVisible: boolean;
  kind: string;
}) {
  let text = '';
  let tone = 'text-brand-muted/60';
  if (mode === 'preview') text = 'Live preview — exactly what guests capture';
  else if (mode === '2d' && kind === 'shader') text = 'Live filter preview';
  else if (mode === '2d') text = 'Drag to place · scroll to scale';
  else if (mode === '3d' && threeView === 'orbit') text = 'Drag to orbit · click a dot to anchor · gizmo to place';
  else if (mode === '3d' && paused) { text = 'Tracking paused — adjust, then resume'; tone = 'text-accent-2'; }
  else if (mode === '3d' && faceVisible) { text = 'Face detected — drag the gizmo to place'; tone = 'text-emerald-400/90'; }
  else if (mode === '3d') text = 'Look into the camera to preview placement';
  if (!text) return null;
  return (
    <div className="liquid-glass rounded-full px-3.5 py-1.5 flex items-center gap-2">
      {mode === '2d' && kind === 'shader' && <Sparkles className="w-3 h-3 text-accent-2" />}
      <span className={`font-label text-[9px] uppercase tracking-widest ${tone}`}>{text}</span>
    </div>
  );
}
