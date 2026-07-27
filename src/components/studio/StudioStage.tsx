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
 * ALL floating chrome lives in ONE top band inside the stage: status on the
 * left, the mode switcher centred, the 3D view toggle on the right. There is no
 * instructional caption, no separate tracker pill and no pause control — the
 * stage is for looking at the artwork, and tracking never stops.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Boxes, Eye, Layers, ScanFace, Smartphone, Sparkles, Rotate3d, AlertTriangle } from 'lucide-react';
import { ShaderRunner } from '../../lib/shaders';
import { snapTransform, type SnapResult } from '../../lib/studio/snap';
import { selectedObject, draftHasContent, type StudioState, type StudioAction, type Overlay2D, type Object3D } from '../../lib/studio/state';
import Studio3DView from './Studio3DView';
import StudioPreview from './StudioPreview';
import Tooltip from '../ui/Tooltip';
import ErrorBoundary from '../ui/ErrorBoundary';
import TriggerEffects, { type TriggerEffectsHandle } from '../booth/TriggerEffects';
import { createTriggerEngine, revealTargetIdsOf, isLayerVisible, TRIGGER_SOURCE_LABELS, type TriggerEvent } from '../../lib/studio/triggers';
import { getLatestBlendshapes, detectFaceNow } from '../../lib/faceRig';
import { initializeFaceLandmarker, isFaceLandmarkerReady } from '../../lib/faceTracking';
import { REVEAL_SHIMMER_MS } from '../../lib/studio/reveal';
import { stageStatus, STAGE_STATUS_DOT_CLASS, STAGE_STATUS_TONE_CLASS, type StageStatus } from '../../lib/studio/stageStatus';
import { OVERLAY_SCALE, clampToSpec } from '../../lib/studio/controlSpecs';

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
  const { mode, draft, threeView } = state;
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
    const next = clampToSpec(selectedOverlay.transform.scale + (e.deltaY > 0 ? -OVERLAY_SCALE.step : OVERLAY_SCALE.step), OVERLAY_SCALE);
    dispatch({ type: 'UPDATE_OBJECT', id: selectedOverlay.id, patch: { transform: { ...selectedOverlay.transform, scale: next } } });
  }, [dispatch, selectedOverlay]);

  const showVideo = mode !== 'preview';

  // ── Trigger effects in the studio's own views ─────────────────────────────
  // Zero cost unless the scene actually carries triggers: no engine, no rAF, no
  // TriggerEffects canvas, and the preview simulation state stays inert.
  const triggers = draft.triggers;
  const hasTriggers = triggers.length > 0;
  // The tracker is genuinely live in 2D, 3D-Live and Preview. 3D-Orbit has no
  // camera feed, so triggers never run there. Note there is no longer a pause to
  // consult: a gizmo drag holds the rendered pose but detection keeps running.
  const trackerLive =
    mode === 'preview' || mode === '2d' || (mode === '3d' && threeView === 'live');
  const triggersActive = hasTriggers && trackerLive && cam.ready;

  // The landmarker is normally initialized by a mounted FaceRig (3D Live) — but
  // 2D live and a filter-only Preview mount none, so on a fresh session nothing
  // would ever load it and detectFaceNow would no-op silently (audit H-A8).
  // Initialize it ourselves (idempotent) and track readiness so the indicator
  // below never claims a live tracker that isn't.
  // Gated on the CAMERA, not on triggers: the single status chip reports tracker
  // readiness in every tracked view, so readiness must be known even in a scene
  // with no triggers. Init is idempotent (faceTracking caches the promise) and
  // FaceRig self-initialises anyway.
  const [trackerLoaded, setTrackerLoaded] = useState(isFaceLandmarkerReady);
  useEffect(() => {
    if (!cam.ready || trackerLoaded) return;
    void initializeFaceLandmarker();
    if (isFaceLandmarkerReady()) { setTrackerLoaded(true); return; }
    const id = window.setInterval(() => {
      if (isFaceLandmarkerReady()) { setTrackerLoaded(true); window.clearInterval(id); }
    }, 400);
    // Readiness is MONOTONIC — once the landmarker is loaded it stays loaded, so
    // this must never reset to false on cleanup (the old version did, and a
    // trigger-set change flashed "Loading face tracker…" over a live tracker).
    return () => window.clearInterval(id);
  }, [cam.ready, trackerLoaded]);

  const triggerFxRef = useRef<TriggerEffectsHandle>(null);

  // Preview-only full simulation: reveal-target pieces stay hidden until fired,
  // and a filterPulse temporarily swaps the preview's shader. The live editing
  // views never mutate the scene — they surface a transient toast instead.
  const revealTargetIds = useMemo(() => revealTargetIdsOf(triggers), [triggers]);
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

  // Preview needs something to show; SET_MODE silently no-ops otherwise, which
  // made the tab look broken. Surface the precondition instead of swallowing it.
  const previewReady = draftHasContent(draft);

  // Gizmo drags hold the RENDERED pose so the piece does not swim under the
  // pointer — they no longer stop tracking. This is deliberately local state,
  // not a reducer flag: the old global `paused` outlived the interaction, was
  // never cleared by a mode switch, and left hosts staring at a frozen face.
  const [gizmoDragging, setGizmoDragging] = useState(false);
  // Nothing holds a pose in orbit (no camera feed) — and a drag that ends while
  // the view is switching must not leave the hold latched.
  useEffect(() => { setGizmoDragging(false); }, [mode, threeView]);

  // Whether the CURRENT view actually uses the tracker — orbit has no feed.
  const trackerNeeded = mode === 'preview' || mode === '2d' || (mode === '3d' && threeView === 'live');
  const status = stageStatus({
    camError: cam.error,
    camReady: cam.ready,
    trackerNeeded,
    trackerReady: trackerNeeded ? trackerLoaded : true,
    faceVisible,
    toast: triggerToast,
  });

  return (
    <div
      className="relative h-full w-full flex items-center justify-center p-3 md:p-5"
      style={{ containerType: 'size' }}
    >
      {/* Stage body — a true 9:16 box. `height` is the min of the space available
          and the height this width can support, so the ratio survives a
          width-bound layout; `aspectRatio` alone does NOT (it only derives a
          missing axis, and `h-full` made the height definite — so a phone or a
          laptop with the Director open silently cropped the composite). */}
      <div
        ref={stageBodyRef}
        className={`relative rounded-2xl overflow-hidden liquid-glass transition-shadow ${dropActive ? 'ring-2 ring-accent shadow-[0_0_40px_-4px_var(--color-accent)]' : ''}`}
        style={{ aspectRatio: '9 / 16', height: 'min(100cqh, calc(100cqw * 16 / 9))' }}
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

        {/* ── The stage's ONE chrome band ────────────────────────────────────
            Everything that floats over the artwork lives here, in a single flex
            row inside the stage's own coordinate space. Previously the mode pill
            was anchored to the OUTER wrapper while the trigger chip was anchored
            to the stage body, so the two overlapped at every viewport; and each
            centred pill was `absolute left-1/2`, which CSS shrink-to-fit caps at
            half the container, wrapping the caption to three lines.
            Status sits left, modes centre, the 3D view toggle right. */}
        <div className="absolute top-2.5 inset-x-2.5 z-30 flex items-start gap-2">
          <div className="flex-1 min-w-0 flex justify-start">
            <StageStatusChip status={status} />
          </div>

          <div className="flex items-center gap-1 liquid-glass-raised rounded-full p-1 shrink-0">
            {visibleTabs.map((t) => {
              const active = mode === t.id;
              const disabled = t.id === 'preview' && !previewReady;
              return (
                <Tooltip
                  key={t.id}
                  label={t.label}
                  hint={disabled ? 'Add a frame, sticker, filter or prop first' : t.hint}
                  side="bottom"
                >
                  <button
                    onClick={() => dispatch({ type: 'SET_MODE', mode: t.id })}
                    disabled={disabled}
                    aria-pressed={active}
                    data-testid={`studio-mode-${t.id}`}
                    className="relative flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-full text-[10px] font-label uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {active && (
                      <motion.span
                        layoutId="studio-mode-pill"
                        className="absolute inset-0 rounded-full bg-accent/20 ring-1 ring-accent/40"
                        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                      />
                    )}
                    <t.icon className={`relative w-3.5 h-3.5 ${active ? 'text-accent-2' : 'text-brand-muted/60'}`} />
                    <span className={`relative hidden sm:inline ${active ? 'text-brand-fg' : 'text-brand-muted/60'}`}>{t.label}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>

          {/* 3D view toggle — one control, in the same band rather than a second
              floating row stacked underneath the first. */}
          <div className="flex-1 min-w-0 flex justify-end">
            {mode === '3d' && (
              <Tooltip
                label={threeView === 'live' ? 'Reference head' : 'Your face'}
                hint={threeView === 'live' ? 'Place against a reference head — no camera needed' : 'Track your real face (WYSIWYG)'}
                side="bottom"
              >
                <button
                  onClick={() => dispatch({ type: 'SET_THREE_VIEW', view: threeView === 'live' ? 'orbit' : 'live' })}
                  data-testid="studio-view-toggle"
                  aria-label={threeView === 'live' ? 'Show the reference head' : 'Show your face'}
                  className="pressable flex items-center justify-center w-9 h-9 rounded-full liquid-glass-raised text-brand-muted/70 hover:text-brand-fg transition-colors"
                >
                  {threeView === 'live' ? <Rotate3d className="w-4 h-4" /> : <ScanFace className="w-4 h-4" />}
                </button>
              </Tooltip>
            )}
          </div>
        </div>

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
                {onOpenAssets ? (
                  <button
                    onClick={onOpenAssets}
                    className="pressable pointer-events-auto px-4 py-2.5 rounded-full liquid-glass-raised text-[10px] font-label uppercase tracking-widest text-accent-2 hover:text-brand-fg transition-colors"
                  >
                    Add a frame or sticker
                  </button>
                ) : (
                  <p className="font-label text-[10px] uppercase tracking-widest text-brand-muted/50">Add a frame or sticker to begin</p>
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
              holdPose={gizmoDragging}
              headScale={headScale}
              occlusionEnabled={occlusionEnabled}
              debugOcclusion={debugOcclusion}
              matrixRef={headMatrixRef}
              onSelect={(id) => dispatch({ type: 'SELECT_OBJECT', id })}
              onAnchorSelect={(a) => dispatch({ type: 'SELECT_ANCHOR', anchor: a })}
              onTransformChange={(patch) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch })}
              onFaceVisible={onFaceVisible}
              onGizmoDragStart={() => setGizmoDragging(true)}
              onGizmoDragEnd={() => setGizmoDragging(false)}
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
              revealTargetIds={revealTargetIds}
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

        {/* Test on phone — the one persistent ACTION on the stage (the modal
            itself handles unsaved/hidden drafts). The bottom band is otherwise
            empty now, so it can never collide with a caption again. */}
        {onTestOnPhone && (
          <div className="absolute bottom-3 right-3 z-20">
            <button
              onClick={onTestOnPhone}
              className="pressable flex items-center gap-1.5 px-3 py-2 rounded-full liquid-glass-raised text-[10px] font-label uppercase tracking-widest text-accent-2 hover:text-brand-fg transition-colors"
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

      </div>
    </div>
  );
}

/**
 * The stage's ONE status affordance. Renders nothing when there is nothing worth
 * saying, which is most of the time — replacing a permanent instructional
 * caption, a trigger-testing chip and a separate centred tracker-loading pill.
 */
function StageStatusChip({ status }: { status: StageStatus | null }) {
  if (!status) return null;
  return (
    <div data-testid="studio-stage-status" className="pointer-events-none max-w-full">
      <div className="liquid-glass-raised rounded-full pl-2.5 pr-3 py-1.5 flex items-center gap-1.5 min-w-0">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${STAGE_STATUS_DOT_CLASS[status.tone]} ${status.live ? 'animate-pulse' : ''}`}
        />
        <span className={`font-label text-[9px] uppercase tracking-widest truncate ${STAGE_STATUS_TONE_CLASS[status.tone]}`}>
          {status.text}
        </span>
      </div>
    </div>
  );
}
