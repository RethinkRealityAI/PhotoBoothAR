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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Boxes, Eye, Layers, Pause, Play, ScanFace, Smartphone, Sparkles, Rotate3d, AlertTriangle } from 'lucide-react';
import { ShaderRunner } from '../../lib/shaders';
import { snapTransform, type SnapResult } from '../../lib/studio/snap';
import { selectedObject, type StudioState, type StudioAction, type Overlay2D, type Object3D } from '../../lib/studio/state';
import Studio3DView from './Studio3DView';
import StudioPreview from './StudioPreview';
import Tooltip from '../ui/Tooltip';
import ErrorBoundary from '../ui/ErrorBoundary';
import TriggerEffects, { type TriggerEffectsHandle } from '../booth/TriggerEffects';
import { createTriggerEngine, TRIGGER_SOURCE_LABELS, type TriggerEvent } from '../../lib/studio/triggers';
import { getLatestBlendshapes, detectFaceNow } from '../../lib/faceRig';
import { initializeFaceLandmarker, isFaceLandmarkerReady } from '../../lib/faceTracking';
import { REVEAL_SHIMMER_MS } from '../../lib/studio/reveal';

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
  /** Opens the "Test on phone" QR hand-off (shown in every mode). */
  onTestOnPhone?: () => void;
  /** Opens the mobile Assets drawer (<lg the docks are drawers, so the
      empty-state hint becomes a tappable CTA instead of dead-end copy). */
  onOpenAssets?: () => void;
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
  onTestOnPhone,
  onOpenAssets,
}: Props) {
  const { mode, draft, threeView, paused } = state;
  const shaderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<ShaderRunner | null>(null);
  const rafRef = useRef<number>(0);
  const overlayBoxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);
  // Snap guide lines shown while dragging the selected overlay (null = free).
  const [guides, setGuides] = useState<SnapResult['guides']>({ v: null, h: null });

  // Scene objects split by family. 2D overlays render as stacked <img>s; the
  // selected one is draggable and shows an outline. Layers flagged `hidden` in the
  // panel are excluded from the render (editor-only, never persisted).
  const overlays = draft.objects.filter((o): o is Overlay2D => o.type === 'overlay' && !o.hidden);
  const objects3d = draft.objects.filter((o): o is Object3D => o.type !== 'overlay' && !o.hidden);
  // True content presence (ignoring hidden) — drives the empty-state copy so a
  // scene whose only object is hidden doesn't read as "add something".
  const hasAnyOverlay = draft.objects.some((o) => o.type === 'overlay');
  const selected = selectedObject(draft);
  const selectedOverlay = selected && selected.type === 'overlay' ? selected : null;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  // Shader runner — created once, disposed on unmount.
  useEffect(() => {
    try {
      runnerRef.current = new ShaderRunner(720, 1280);
    } catch {
      runnerRef.current = null;
    }
    return () => { runnerRef.current?.dispose?.(); };
  }, []);

  // Shader render loop — runs whenever the 2D view is showing AND the scene's
  // single filter slot is filled (shaderId !== 'none'), so the live filter
  // composites UNDER any overlays. Off otherwise (avoids the ghosted double
  // camera and needless GPU work).
  const shaderActive = mode === '2d' && draft.shaderId !== 'none';
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
  // semantics — x/y are % of the frame from centre (see StageCanvas). Only the
  // SELECTED overlay is draggable; clicking another selects it.
  const onOverlayPointerDown = useCallback((e: React.PointerEvent, o: Overlay2D) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, tx: o.transform.x, ty: o.transform.y };
  }, []);

  const onOverlayPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const box = overlayBoxRef.current;
    if (!d || !box || !selectedOverlay) return;
    const rect = box.getBoundingClientRect();
    const dx = ((e.clientX - d.startX) / rect.width) * 100;
    const dy = ((e.clientY - d.startY) / rect.height) * 100;
    const raw = { ...selectedOverlay.transform, x: clamp(d.tx + dx, -100, 100), y: clamp(d.ty + dy, -100, 100) };
    const snapped = snapTransform(raw);
    dispatch({ type: 'UPDATE_OBJECT', id: selectedOverlay.id, patch: { transform: snapped.transform } });
    setGuides(snapped.guides);
  }, [dispatch, selectedOverlay]);

  const onOverlayPointerUp = useCallback(() => {
    drag.current = null;
    setGuides({ v: null, h: null });
  }, []);

  const onOverlayWheel = useCallback((e: React.WheelEvent) => {
    if (!selectedOverlay) return;
    const next = clamp(selectedOverlay.transform.scale + (e.deltaY > 0 ? -0.05 : 0.05), 0.1, 5);
    dispatch({ type: 'UPDATE_OBJECT', id: selectedOverlay.id, patch: { transform: { ...selectedOverlay.transform, scale: next } } });
  }, [dispatch, selectedOverlay]);

  const showVideo = mode !== 'preview';

  // ── Trigger effects in the studio's own views ─────────────────────────────
  // Zero cost unless the scene actually carries triggers: no engine, no rAF, no
  // TriggerEffects canvas, and the preview simulation state stays inert.
  const triggers = draft.triggers;
  const hasTriggers = triggers.length > 0;
  // The tracker is genuinely live in 2D, 3D-Live (not paused), and Preview.
  // 3D-Orbit has no camera feed, so triggers never run there.
  const trackerLive =
    mode === 'preview' || mode === '2d' || (mode === '3d' && threeView === 'live' && !paused);
  const triggersActive = hasTriggers && trackerLive && cam.ready;

  // The landmarker is normally initialized by a mounted FaceRig (3D Live) — but
  // 2D live and a filter-only Preview mount none, so on a fresh session nothing
  // would ever load it and detectFaceNow would no-op silently (audit H-A8).
  // Initialize it ourselves (idempotent) and track readiness so the indicator
  // below never claims a live tracker that isn't.
  const [trackerReady, setTrackerReady] = useState(false);
  useEffect(() => {
    if (!triggersActive) return;
    void initializeFaceLandmarker();
    if (isFaceLandmarkerReady()) { setTrackerReady(true); return; }
    const id = window.setInterval(() => {
      if (isFaceLandmarkerReady()) { setTrackerReady(true); window.clearInterval(id); }
    }, 400);
    return () => { window.clearInterval(id); setTrackerReady(false); };
  }, [triggersActive]);

  const triggerFxRef = useRef<TriggerEffectsHandle>(null);

  // Preview-only full simulation: reveal-target pieces stay hidden until fired,
  // and a filterPulse temporarily swaps the preview's shader. The live editing
  // views never mutate the scene — they surface a transient toast instead.
  const revealTargetIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of triggers) if (t.action.type === 'reveal') s.add(t.action.objectId);
    return s;
  }, [triggers]);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
  const [reveal, setReveal] = useState(false);
  const revealTimerRef = useRef<number | null>(null);
  // Restart the simulation whenever the trigger set changes or the view leaves
  // preview, so re-entering Preview replays every reveal from hidden.
  useEffect(() => { setRevealedIds(new Set()); setReveal(false); }, [mode, triggers]);
  const hiddenObjectIds = useMemo(() => {
    if (revealTargetIds.size === 0) return revealTargetIds; // shared empty set
    const s = new Set<string>();
    for (const id of revealTargetIds) if (!revealedIds.has(id)) s.add(id);
    return s;
  }, [revealTargetIds, revealedIds]);

  // filterPulse (preview): swap to the pulse shader for ~1.2s, then restore the
  // scene's own filter. One pulse at a time; clean-cancelled on unmount / mode
  // switch so a stale timer never stomps the next view.
  const [pulseShaderId, setPulseShaderId] = useState<string | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const endPulse = useCallback(() => {
    if (pulseTimerRef.current) { window.clearTimeout(pulseTimerRef.current); pulseTimerRef.current = null; }
    setPulseShaderId(null);
  }, []);
  const startPulse = useCallback((shaderId: string | undefined, durationMs: number | undefined) => {
    if (pulseTimerRef.current) return;
    const target = shaderId || draft.shaderId;
    if (!target || target === 'none' || target === draft.shaderId) return; // nothing distinct to pulse to
    setPulseShaderId(target);
    const dur = durationMs && durationMs > 0 ? durationMs : 1200;
    pulseTimerRef.current = window.setTimeout(() => { pulseTimerRef.current = null; setPulseShaderId(null); }, dur);
  }, [draft.shaderId]);
  useEffect(() => () => endPulse(), [mode, triggers, endPulse]);

  // Live-view toast: reveal/filterPulse must NOT lie about the editing scene, so
  // instead of applying them we flash a chip that the trigger registered.
  const [triggerToast, setTriggerToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setTriggerToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setTriggerToast(null), 1600);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
  }, []);

  // One fired trigger → its effect. Bursts fire the shared canvas in every view.
  // Reveal/filterPulse fully simulate in Preview, and toast in the live editors.
  const handleTriggerEvent = useCallback((e: TriggerEvent) => {
    const a = e.action;
    const label = TRIGGER_SOURCE_LABELS[e.source];
    if (a.type === 'burst') {
      triggerFxRef.current?.fire(a.style);
      return;
    }
    if (a.type === 'reveal') {
      if (mode === 'preview') {
        setRevealedIds((prev) => (prev.has(a.objectId) ? prev : new Set(prev).add(a.objectId)));
        setReveal(true);
        if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = window.setTimeout(() => setReveal(false), REVEAL_SHIMMER_MS);
      } else {
        const name = draft.objects.find((o) => o.id === a.objectId)?.name ?? 'piece';
        showToast(`${label} → reveal "${name}"`);
      }
      return;
    }
    // filterPulse
    if (mode === 'preview') startPulse(a.shaderId, a.durationMs);
    else showToast(`${label} → filter pulse`);
  }, [mode, draft.objects, showToast, startPulse]);
  const handlerRef = useRef(handleTriggerEvent);
  useEffect(() => { handlerRef.current = handleTriggerEvent; }, [handleTriggerEvent]);

  // Detection + engine loop — mounted only while the tracker is live AND the
  // scene carries triggers. Drives detection itself (detectFaceNow self-throttles
  // and is shared with any mounted FaceRig) so blendshapes refresh even in 2D /
  // filter-only preview, and steps the engine once per NEW detection frame.
  // Rebuilds (cheaply) whenever the trigger set changes → no leaked rAF/engine.
  useEffect(() => {
    if (!triggersActive) return;
    const engine = createTriggerEngine(triggers);
    let raf = 0;
    let lastT = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = cam.videoRef.current;
      if (!v) return;
      detectFaceNow(v);
      const b = getLatestBlendshapes();
      if (!b || b.t === lastT) return;
      lastT = b.t;
      for (const ev of engine.step(b.scores, performance.now())) handlerRef.current(ev);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [triggersActive, triggers, cam.videoRef]);

  // All three views are always available — switching can no longer destroy
  // content (SET_MODE is a pure view flip; the scene persists across 2D/3D/Preview).
  const visibleTabs = MODE_TABS;

  return (
    <div className="relative h-full w-full flex items-center justify-center p-3 md:p-5">
      {/* Mode switcher — floating pill */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30">
        <div className="flex items-center gap-1 liquid-glass rounded-full p-1">
          {visibleTabs.map((t) => {
            const active = mode === t.id;
            // In 3D/Preview a sub-pill / caption band sits right below this
            // pill (top-[3.35rem]) — push the tooltip past it so it never
            // covers the control it describes.
            const tipOffset = mode === '2d' ? undefined : 56;
            return (
              <Tooltip key={t.id} label={t.label} hint={t.hint} side="bottom" offset={tipOffset}>
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

      {/* 3D sub-controls — sit BELOW the main switcher (centred) so they never
          overlap it on narrow screens. */}
      {mode === '3d' && (
        <div className="absolute top-[3.35rem] left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
          <div className="flex items-center gap-1 liquid-glass rounded-full p-1">
            {([
              { v: 'orbit' as const, icon: Rotate3d, label: 'Model', hint: 'Reference head — drag to orbit, place with the gizmo' },
              { v: 'live' as const, icon: ScanFace, label: 'Live', hint: 'Track your real face (WYSIWYG)' },
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
        {/* Legibility scrim: the floating pills/captions are translucent glass —
            over bright frame art or dense sticker stacks they lose contrast.
            A soft top fade keeps the chrome readable without boxing it in. */}
        <div className="absolute inset-x-0 top-0 h-24 z-10 pointer-events-none bg-gradient-to-b from-black/45 via-black/15 to-transparent" />

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

        {/* 2D overlay(s) (border / sticker) with drag-to-place. Every visible
            overlay renders in array order OVER the filter canvas; the selected
            one is draggable + outlined, others select on click. Always mounted in
            2D so a mixed or filter-only scene still gets its overlay layer + hints. */}
        {mode === '2d' && (
          <div
            ref={overlayBoxRef}
            className="absolute inset-0"
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            style={{ touchAction: 'none' }}
          >
            {overlays.map((o) => {
              const isSel = o.id === draft.selectedId;
              return (
                <div
                  key={o.id}
                  onPointerDown={(e) => {
                    if (isSel) onOverlayPointerDown(e, o);
                    else { e.stopPropagation(); dispatch({ type: 'SELECT_OBJECT', id: o.id }); }
                  }}
                  onWheel={isSel ? onOverlayWheel : undefined}
                  className="absolute"
                  style={{
                    left: `calc(50% + ${o.transform.x}%)`,
                    top: `calc(50% + ${o.transform.y}%)`,
                    width: o.overlayKind === '2d_filter' ? '60%' : '100%',
                    height: o.overlayKind === '2d_filter' ? '60%' : '100%',
                    transform: `translate(-50%, -50%) scale(${o.transform.scale}) rotate(${o.transform.rotation}deg)`,
                    touchAction: 'none',
                    cursor: isSel ? 'grab' : 'pointer',
                    outline: isSel ? '2px solid var(--color-accent)' : 'none',
                    outlineOffset: '3px',
                    borderRadius: '2px',
                  }}
                >
                  {o.url && (
                    <img
                      src={o.url}
                      alt={o.name}
                      draggable={false}
                      className="w-full h-full select-none"
                      style={{ objectFit: 'contain', pointerEvents: 'none' }}
                    />
                  )}
                </div>
              );
            })}

            {/* Snap guide lines (only while dragging the selected overlay). */}
            {selectedOverlay && guides.v !== null && (
              <div className="absolute top-0 bottom-0 w-px bg-accent/70 pointer-events-none" style={{ left: `calc(50% + ${guides.v}%)` }} />
            )}
            {selectedOverlay && guides.h !== null && (
              <div className="absolute left-0 right-0 h-px bg-accent/70 pointer-events-none" style={{ top: `calc(50% + ${guides.h}%)` }} />
            )}

            {/* Empty state — only when the scene truly has no overlays AND no
                filter (a filter-only scene shows the live filter instead).
                Below lg the docks are drawers, so "from the left" is a dead
                end — the caption becomes a tappable CTA that opens the Assets
                drawer instead. lg+ keeps the pointer-through caption. */}
            {!hasAnyOverlay && draft.shaderId === 'none' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-8 text-center">
                <p className={`${onOpenAssets ? 'hidden lg:block' : ''} font-label text-[10px] uppercase tracking-widest text-brand-muted/50`}>Pick a frame or stickers from the left</p>
                {onOpenAssets && (
                  <button
                    onClick={onOpenAssets}
                    className="lg:hidden pointer-events-auto px-4 py-2.5 rounded-full liquid-glass text-[10px] font-label uppercase tracking-widest text-accent-2 hover:text-brand-fg transition-colors"
                  >
                    Pick a frame or sticker
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 3D view — boundary so a failed 3D asset/font fetch degrades to a
            local "try again" panel instead of blanking the whole studio. */}
        {mode === '3d' && (
          <div className="absolute inset-0">
            <ErrorBoundary label="3D view">
            <Studio3DView
              view={threeView}
              videoId="studio-video"
              objects={objects3d}
              selectedId={draft.selectedId}
              paused={paused}
              headScale={headScale}
              occlusionEnabled={occlusionEnabled}
              debugOcclusion={debugOcclusion}
              matrixRef={headMatrixRef}
              onSelect={(id) => dispatch({ type: 'SELECT_OBJECT', id })}
              onAnchorSelect={(a) => dispatch({ type: 'SELECT_ANCHOR', anchor: a })}
              onTransformChange={(patch) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch })}
              onFaceVisible={onFaceVisible}
              onGizmoDragStart={() => dispatch({ type: 'SET_PAUSED', paused: true })}
              onGizmoDragEnd={() => dispatch({ type: 'SET_PAUSED', paused: false })}
            />
            </ErrorBoundary>
          </div>
        )}

        {/* Preview */}
        {mode === 'preview' && (
          <div className="absolute inset-0">
            <ErrorBoundary label="preview">
            <StudioPreview
              videoRef={cam.videoRef}
              draft={draft}
              headScale={headScale}
              occlusionEnabled={occlusionEnabled}
              onFaceVisible={onFaceVisible}
              hiddenObjectIds={hiddenObjectIds}
              effectIdOverride={pulseShaderId ?? undefined}
              reveal={reveal}
            />
            </ErrorBoundary>
          </div>
        )}

        {/* Face-trigger particle canvas — ONE instance overlaying the shared
            stage, visible over 2D / 3D-Live / Preview alike. Mounted only for
            trigger scenes (zero cost otherwise); it's aria-hidden internally. */}
        {hasTriggers && (
          <div data-testid="studio-trigger-fx" className="absolute inset-0 z-20 pointer-events-none">
            <TriggerEffects ref={triggerFxRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </div>
        )}

        {/* Trigger-testing indicator — green only once the landmarker is truly
            ready (2D, 3D-Live, or Preview); amber while it loads so the chip
            never claims a live tracker that isn't (audit H-A8). */}
        {triggersActive && (
          <div data-testid="studio-trigger-indicator" className="absolute top-3 left-3 z-20 pointer-events-none">
            <div className="liquid-glass rounded-full px-3 py-1.5 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${trackerReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <ScanFace className="w-3 h-3 text-accent-2" />
              <span className="font-label text-[9px] uppercase tracking-widest text-brand-muted">
                {trackerReady ? 'Testing triggers' : 'Loading face tracker…'}
              </span>
            </div>
          </div>
        )}

        {/* Live-view trigger toast — reveal/filterPulse register here instead of
            mutating the editing scene (Preview fully simulates them instead). */}
        {triggerToast && (
          <div data-testid="studio-trigger-toast" className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div className="liquid-glass rounded-full px-3.5 py-1.5 flex items-center gap-1.5 animate-rise-in">
              <Sparkles className="w-3 h-3 text-accent-2" />
              <span className="font-label text-[9px] uppercase tracking-widest text-brand-fg whitespace-nowrap">{triggerToast}</span>
            </div>
          </div>
        )}

        {/* Test on phone — every mode, floating bottom-right (the modal itself
            handles unsaved/hidden drafts). In preview the status caption moves
            up under the mode pill (see below); in 2D/3D the caption is
            pointer-through, so the pill stays tappable on narrow stages. */}
        {onTestOnPhone && (
          <div className="absolute bottom-3 right-3 z-20">
            <button
              onClick={onTestOnPhone}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full liquid-glass text-[10px] font-label uppercase tracking-widest text-accent-2 hover:text-brand-fg transition-colors"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Test on phone</span>
            </button>
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

        {/* Status caption — in preview it sits under the mode pill (the 3D
            sub-controls slot); in 2D/3D it sits at the bottom, lifted above the
            Test-on-phone pill on narrow stages (sm-) so the two never overlap. */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none ${
            mode === 'preview' ? 'top-[3.35rem]' : 'bottom-16 sm:bottom-3'
          }`}
        >
          <StageCaption mode={mode} threeView={threeView} paused={paused} faceVisible={faceVisible} filterActive={draft.shaderId !== 'none'} objectCount={overlays.length} />
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
  filterActive,
  objectCount,
}: {
  mode: string;
  threeView: string;
  paused: boolean;
  faceVisible: boolean;
  filterActive: boolean;
  objectCount: number;
}) {
  let text = '';
  let tone = 'text-brand-muted/60';
  // A filter now rides alongside objects, so it's a suffix on the 2D caption
  // rather than a whole distinct mode.
  const filterNote = filterActive ? ' · filter on' : '';
  if (mode === 'preview') text = 'Live preview — exactly what guests capture';
  else if (mode === '2d' && objectCount > 0) text = `${objectCount} object${objectCount === 1 ? '' : 's'} · drag to place · scroll to scale${filterNote}`;
  else if (mode === '2d' && filterActive) text = 'Live filter preview';
  else if (mode === '2d') text = 'Drag to place · scroll to scale';
  else if (mode === '3d' && threeView === 'orbit') text = 'Drag to orbit · click a dot to anchor · gizmo to place';
  else if (mode === '3d' && paused) { text = 'Tracking paused — adjust, then resume'; tone = 'text-accent-2'; }
  else if (mode === '3d' && faceVisible) { text = 'Face detected — drag the gizmo to place'; tone = 'text-emerald-400/90'; }
  else if (mode === '3d') text = 'Look into the camera to preview placement';
  if (!text) return null;
  return (
    <div className="liquid-glass rounded-full px-3.5 py-1.5 flex items-center gap-2">
      {mode === '2d' && filterActive && <Sparkles className="w-3 h-3 text-accent-2" />}
      <span className={`font-label text-[9px] uppercase tracking-widest ${tone}`}>{text}</span>
    </div>
  );
}
