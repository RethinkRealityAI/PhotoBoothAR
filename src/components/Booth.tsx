/**
 * Hope Gala 2026 — Guest Photo Booth (Round 2)
 *
 * Architecture:
 *   • Single composited StageCanvas (preview + capture + record)
 *   • Collapsible PickerDrawer (effects + frames + 3D — combinable)
 *   • Front/back camera flip (only shown when hasMultipleCameras)
 *   • Photo / Video mode toggle (record up to 30s via StreamRecorder)
 *   • Timer selector: Off / 3s / 5s / 10s
 *   • First-launch Onboarding modal
 *   • Challenge selector (optional, tags post via challengeId)
 *   • Golden-disintegration send-off animation
 */
import {
  useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo,
} from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  SwitchCamera, Clock, Video, Camera as CameraIcon,
  SlidersHorizontal, Eye, EyeOff, ChevronUp, UploadCloud, ScanFace, Sparkles,
} from 'lucide-react';

import EventBackground from './ui/EventBackground';
import { Emblem } from './ui/EventLogo';
import { GalleryIcon, MediaStackIcon } from './ui/MediaIcons';
import ShareButton from './ui/ShareButton';

// Booth sub-components
import { useCameraStream } from './booth/useCameraStream';
import Welcome from './booth/Welcome';
import CameraErrorScreen from './booth/CameraError';
import StageCanvas, { StageCanvasHandle, StageOverlaySpec } from './booth/StageCanvas';
import Overlay3D, { Overlay3DPiece } from './booth/Overlay3D';
import TriggerEffects, { type TriggerEffectsHandle } from './booth/TriggerEffects';
import PickerDrawer from './booth/PickerDrawer';
import FilterOrbs from './booth/FilterOrbs';
import Countdown from './booth/Countdown';
import ReviewPanel from './booth/ReviewPanel';
import SendOff from './booth/SendOff';
import Onboarding, { useOnboarding } from './booth/Onboarding';
import ChallengeSelector from './booth/ChallengeSelector';

// Foundation APIs
import { useStore } from '../store';
import { useEvent } from '../events/EventContext';
import { buildCatalog } from '../lib/catalog';
import { initializeFaceLandmarker } from '../lib/faceTracking';
import { getLatestBlendshapes, detectFaceNow } from '../lib/faceRig';
import { createTriggerEngine, parseTriggers, type TriggerConfig, type TriggerEvent } from '../lib/studio/triggers';
import { submitPost, getStudioSettings } from '../lib/db';
import { DEFAULT_STUDIO_SETTINGS, type StudioSettings } from '../lib/studio/occluder';
import { savePhoto, addCompletedChallenge, setGuestName } from '../lib/session';
import { StreamRecorder, buildRecordStream, recordingSupported } from '../lib/recorder';
import { useEntitlements } from '../lib/entitlements';
import { dataUrlToBlob } from './booth/capture';
import RevealShimmer from './booth/RevealShimmer';
import { REVEAL_SHIMMER_MS } from '../lib/studio/reveal';
import type { Transform2D, Experience, AnchorConfig, Challenge } from '../types';

// ─────────────────────────────────────────────────────────────────────────────

type BoothPhase =
  | 'camera'
  | 'countdown'
  | 'flash'
  | 'review'
  | 'sending'
  | 'success';

type MediaMode = 'photo' | 'video';
type TimerOption = 0 | 3 | 5 | 10;

const TIMER_OPTIONS: TimerOption[] = [0, 3, 5, 10];
const VIDEO_MAX_MS = 30_000;
const DEFAULT_TRANSFORM: Transform2D = { scale: 1, x: 0, y: 0, rotation: 0 };

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Booth() {
  const { id: routeExperienceId } = useParams<{ id?: string }>();
  const { eventId, config: eventConfig, basePath, source } = useEvent();
  const entitlements = useEntitlements();

  // Studio settings (head occlusion + size). Only platform (db) events opt in;
  // legacy/code events keep their exact shipped rendering.
  const [studioCfg, setStudioCfg] = useState<StudioSettings>(DEFAULT_STUDIO_SETTINGS);
  useEffect(() => {
    if (source !== 'db') return;
    let alive = true;
    getStudioSettings(eventId).then((s) => { if (alive) setStudioCfg(s); }).catch(() => {});
    return () => { alive = false; };
  }, [eventId, source]);

  // ── Store ─────────────────────────────────────────────────────────────
  const {
    experiences, linkedGlobals, experiencesLoaded, fetchExperiences,
    presetOverrides, fetchPresetOverrides,
    wallSettings, fetchWallSettings,
  } = useStore();

  useEffect(() => {
    fetchExperiences(true);
    fetchPresetOverrides();
    fetchWallSettings();
  }, [fetchExperiences, fetchPresetOverrides, fetchWallSettings]);

  // Face tracking init
  useEffect(() => {
    initializeFaceLandmarker().catch((e) =>
      console.warn('[Booth] face landmarker init failed', e),
    );
  }, []);

  // ── Onboarding ────────────────────────────────────────────────────────
  const { showOnboarding, dismiss: dismissOnboarding } = useOnboarding();
  const [onboardingVisible, setOnboardingVisible] = useState(showOnboarding);

  // ── Camera ────────────────────────────────────────────────────────────
  const [started, setStarted] = useState(false);
  const [mediaMode, setMediaMode] = useState<MediaMode>('photo');

  // Video capture is entitlement-gated (free tier: photo only). If the flag
  // resolves after the guest already toggled, snap back to photo mode.
  const videoAllowed = entitlements.videoEnabled;
  useEffect(() => {
    if (!videoAllowed && mediaMode === 'video') setMediaMode('photo');
  }, [videoAllowed, mediaMode]);

  // Audio only needed in video mode; restart stream when mode changes to add audio
  const {
    videoRef, stream, ready, error, retry,
    facingMode, flipCamera, canFlip,
  } = useCameraStream(started, mediaMode === 'video');

  const feedContainerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageCanvasHandle>(null);

  // Wire stream → video element
  useLayoutEffect(() => {
    streamRef.current = stream;
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, videoRef]);

  // ── Picker state ──────────────────────────────────────────────────────
  const [effectId, setEffectId] = useState<string>('none');
  const [sparkles, setSparkles] = useState(false);
  const [frameExp, setFrameExp] = useState<Experience | null>(null);
  const [attachExp, setAttachExp] = useState<Experience | null>(null);
  const [overlayTransform, setOverlayTransform] = useState<Transform2D>(DEFAULT_TRANSFORM);

  // ── Timer ─────────────────────────────────────────────────────────────
  const [timerSec, setTimerSec] = useState<TimerOption>(0);
  const [timerPickerOpen, setTimerPickerOpen] = useState(false);

  // ── UI chrome ─────────────────────────────────────────────────────────
  const [uiHidden, setUiHidden] = useState(false);   // collapse panel to see the full frame
  const [moreOpen, setMoreOpen] = useState(false);   // full "More filters & settings" sheet

  // ── Challenge ─────────────────────────────────────────────────────────
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);

  // Clear any selected challenge if the admin turns Challenges mode off.
  useEffect(() => {
    if (!wallSettings.showChallenges && selectedChallenge) setSelectedChallenge(null);
  }, [wallSettings.showChallenges, selectedChallenge]);

  // ── Phase & capture ───────────────────────────────────────────────────
  const [phase, setPhase] = useState<BoothPhase>('camera');
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedBlobRef, setCapturedBlobRef] = useState<Blob | null>(null);
  const [capturedDurationMs, setCapturedDurationMs] = useState<number | undefined>();
  const capturedMediaTypeRef = useRef<'image' | 'video'>('image');

  // ── Recording ─────────────────────────────────────────────────────────
  const recorderRef = useRef<StreamRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const recordVideoUrlRef = useRef<string | null>(null);
  const recordStartRef = useRef(0);          // wall-clock start of recording (true duration)
  const streamRef = useRef<MediaStream | null>(null); // always-current stream (survives camera flip)

  // ── Build catalog ─────────────────────────────────────────────────────
  const catalog = useMemo(
    () => buildCatalog(eventConfig.arContent, experiencesLoaded ? experiences : [], presetOverrides, experiencesLoaded ? linkedGlobals : []),
    [eventConfig, experiences, linkedGlobals, experiencesLoaded, presetOverrides],
  );

  // Pre-select from route param
  useEffect(() => {
    if (!routeExperienceId || !experiencesLoaded) return;
    const exp = catalog.find((e) => e.id === routeExperienceId);
    if (exp) {
      if (exp.kind === 'shader') {
        setEffectId(exp.config?.shader?.shaderId ?? 'none');
      } else if (exp.kind === 'border' || exp.kind === '2d_filter') {
        setFrameExp(exp);
        setOverlayTransform(exp.config?.transform ?? DEFAULT_TRANSFORM);
        if (exp.config?.ambientShader?.shaderId) setEffectId(exp.config.ambientShader.shaderId);
      } else if (exp.kind === '3d_attachment') {
        setAttachExp(exp);
        if (exp.config?.ambientShader?.shaderId) setEffectId(exp.config.ambientShader.shaderId);
      } else if (exp.kind === 'composite') {
        // A mixed scene is a full frame+3D+filter package — apply all three slots together.
        setFrameExp(exp);
        setOverlayTransform(exp.config?.transform ?? DEFAULT_TRANSFORM);
        setAttachExp(exp);
        if (exp.config?.ambientShader?.shaderId) setEffectId(exp.config.ambientShader.shaderId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeExperienceId, experiencesLoaded]);

  // Auto-apply the admin's default filter when the booth opens (once).
  // A specific /experience/:id link always takes precedence.
  const appliedDefaultRef = useRef(false);
  useEffect(() => {
    if (appliedDefaultRef.current) return;
    if (routeExperienceId) { appliedDefaultRef.current = true; return; }
    if (!experiencesLoaded) return;
    const id = wallSettings.defaultExperienceId ?? eventConfig.defaultExperienceId;
    if (!id) return;
    const exp = catalog.find((e) => e.id === id);
    if (!exp) return;
    if (exp.kind === 'shader') {
      setEffectId(exp.config?.shader?.shaderId ?? 'none');
    } else if (exp.kind === 'border' || exp.kind === '2d_filter') {
      setFrameExp(exp);
      setOverlayTransform(exp.config?.transform ?? DEFAULT_TRANSFORM);
      if (exp.config?.ambientShader?.shaderId) setEffectId(exp.config.ambientShader.shaderId);
    } else if (exp.kind === '3d_attachment') {
      setAttachExp(exp);
      if (exp.config?.ambientShader?.shaderId) setEffectId(exp.config.ambientShader.shaderId);
    } else if (exp.kind === 'composite') {
      // A mixed scene is a full frame+3D+filter package — apply all three slots together.
      setFrameExp(exp);
      setOverlayTransform(exp.config?.transform ?? DEFAULT_TRANSFORM);
      setAttachExp(exp);
      if (exp.config?.ambientShader?.shaderId) setEffectId(exp.config.ambientShader.shaderId);
    }
    appliedDefaultRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiencesLoaded, wallSettings.defaultExperienceId, catalog, routeExperienceId]);

  // Reset transform when frame changes. A composite selection is a full
  // frame+3D+filter package: applying one populates all three slots together;
  // deselecting/switching away from one releases the 3D slot it owned — but
  // never touches a 3D piece the guest picked independently afterwards.
  const handleSelectFrame = useCallback((exp: Experience | null) => {
    if (frameExp?.kind === 'composite' && attachExp === frameExp) {
      setAttachExp(exp?.kind === 'composite' ? exp : null);
    } else if (exp?.kind === 'composite') {
      setAttachExp(exp);
    }
    setFrameExp(exp);
    setOverlayTransform(exp?.config?.transform ?? DEFAULT_TRANSFORM);
    if (exp?.config?.ambientShader?.shaderId) {
      setEffectId(exp.config.ambientShader.shaderId);
    } else {
      // Release the OUTGOING scene's ambient filter — but only if it is still
      // the active effect (a filter the guest picked themselves is never
      // touched). Without this the composite's filter lingered forever.
      const outgoingAmbient = frameExp?.config?.ambientShader?.shaderId;
      if (outgoingAmbient) setEffectId((cur) => (cur === outgoingAmbient ? 'none' : cur));
    }
  }, [frameExp, attachExp]);

  // ── Reveal moment ─────────────────────────────────────────────────────
  // A transient ~600ms "magically appears" entrance whenever the guest's
  // frameExp/attachExp SELECTION actually changes to a NEW db-sourced
  // experience — never on deselection, never for a bare filter/effectId
  // pick. Same source==='db' safety gate as the occlusion gate above
  // (attachExp!.config?.occlusion, wired to Overlay3D below): legacy/code
  // events never flip `reveal` true, so their rendering is byte-identical.
  const [reveal, setReveal] = useState(false);
  const prevSelectionRef = useRef<string | null>(null);
  const revealTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    const sig = frameExp || attachExp ? `${frameExp?.id ?? ''}|${attachExp?.id ?? ''}` : null;
    const prevSig = prevSelectionRef.current;
    prevSelectionRef.current = sig;
    if (source !== 'db') return;            // legacy/code events: never
    if (!sig || sig === prevSig) return;     // deselecting, or unchanged: never
    if (prefersReducedMotion()) return;      // a11y: apply instantly, no animated entrance
    setReveal(true);
    if (revealTimeoutRef.current) window.clearTimeout(revealTimeoutRef.current);
    revealTimeoutRef.current = window.setTimeout(() => setReveal(false), REVEAL_SHIMMER_MS);
  }, [frameExp, attachExp, source]);
  useEffect(() => () => {
    if (revealTimeoutRef.current) window.clearTimeout(revealTimeoutRef.current);
  }, []);

  // ── Derived flags ─────────────────────────────────────────────────────
  const isFront = facingMode === 'user';
  // Composite carries its 2D content in config.layers (never the singular
  // asset_url field, which the legacy mirror may repurpose for either family) —
  // so a composite frame "lights up" 2D by actually having a 2D-kind layer.
  const is2DOverlay = frameExp !== null && (
    (!!frameExp.asset_url && (frameExp.kind === 'border' || frameExp.kind === '2d_filter')) ||
    (frameExp.kind === 'composite' && !!frameExp.config?.layers?.some((l) => l.kind === 'border' || l.kind === '2d_filter'))
  );
  const is3D = attachExp !== null && (
    (attachExp.kind === '3d_attachment' && (!!attachExp.asset_url || !!attachExp.config?.procedural)) ||
    (attachExp.kind === 'composite' && !!attachExp.config?.layers?.some((l) => l.kind === '3d_attachment'))
  );
  const anchorConfig: AnchorConfig | null =
    is3D && attachExp?.config?.anchor ? (attachExp.config.anchor as AnchorConfig) : null;

  // ── Face-triggered effects ────────────────────────────────────────────
  // Opt-in per DB scene (config.triggers). Legacy/code events never carry them,
  // so the whole subsystem below stays inert — empty triggers means no engine,
  // no RAF, no reveal filtering — and the booth renders byte-identically.
  const activeTriggerExp =
    (attachExp?.config?.triggers ? attachExp : null) ?? (frameExp?.config?.triggers ? frameExp : null);
  const triggers = useMemo<TriggerConfig[]>(
    () => (source === 'db' && activeTriggerExp ? parseTriggers(activeTriggerExp.config?.triggers) : []),
    [source, activeTriggerExp],
  );
  const hasTriggers = triggers.length > 0;
  // Layer ids that a reveal trigger hides until it fires; `revealedIds` is the
  // runtime set already fired. NEVER persisted — a fresh scene starts all hidden.
  const revealTargetIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of triggers) if (t.action.type === 'reveal') s.add(t.action.objectId);
    return s;
  }, [triggers]);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => { setRevealedIds(new Set()); }, [activeTriggerExp]);
  // A reveal layer renders only once revealed. With no triggers revealTargetIds
  // is empty, so this is always true → the layer builders below are unchanged.
  const revealVisible = useCallback(
    (id: string) => !(revealTargetIds.has(id) && !revealedIds.has(id)),
    [revealTargetIds, revealedIds],
  );

  // ── Multi-layer (studio) scenes ───────────────────────────────────────
  // Additive: only built when the experience actually carries config.layers;
  // every other code path (no layers) leaves the legacy single-object props
  // untouched below, so frozen legacy events render byte-identically. A
  // composite's config.layers mixes both families, so each builder filters to
  // its own layer kind — single-family experiences are unaffected (every
  // layer already matches their one kind).
  const frameLayers = frameExp?.config?.layers;
  const stageOverlays: StageOverlaySpec[] | undefined = useMemo(() => {
    if (!frameLayers || frameLayers.length === 0) return undefined;
    return frameLayers
      // `hidden` layers stay in the scene but render nowhere (studio eye toggle);
      // reveal-target layers stay hidden until their trigger fires (revealVisible).
      .filter((l) => (l.kind === 'border' || l.kind === '2d_filter') && !!l.asset_url && l.hidden !== true && revealVisible(l.id))
      .map((l) => ({
        url: l.asset_url as string,
        transform: l.transform ?? DEFAULT_TRANSFORM,
        opacity: l.opacity ?? 1,
        animation: l.animation,
      }));
  }, [frameLayers, revealVisible]);

  const attachLayers = attachExp?.config?.layers;
  const overlayPieces: Overlay3DPiece[] | undefined = useMemo(() => {
    if (!attachLayers || attachLayers.length === 0) return undefined;
    return attachLayers
      // Same `hidden` skip as the 2D builder above, plus the reveal-until-fired gate.
      .filter((l) => l.kind === '3d_attachment' && !!l.anchor && l.hidden !== true && revealVisible(l.id))
      .map((l) => ({
        assetUrl: l.asset_url ?? null,
        proceduralId: l.procedural ?? null,
        anchor: l.anchor as AnchorConfig,
        animation: l.animation,
        // Same source==='db' safety gate as the single-piece occlude below —
        // legacy/code events never carry layers, but keep the invariant explicit.
        occlude: source === 'db' && l.occlusion === true,
      }));
  }, [attachLayers, source, revealVisible]);

  // ── Trigger runtime: particle canvas, filter pulse, detection loop ────
  const triggerFxRef = useRef<TriggerEffectsHandle>(null);
  const [triggerFxCanvas, setTriggerFxCanvas] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    setTriggerFxCanvas(hasTriggers ? (triggerFxRef.current?.canvas ?? null) : null);
  }, [hasTriggers]);

  // filterPulse: temporarily swap the active effect to the pulse shader, then
  // restore the EXACT prior effect after ~1.2s (default). One pulse at a time.
  const effectIdRef = useRef(effectId);
  useEffect(() => { effectIdRef.current = effectId; }, [effectId]);
  const pulseRef = useRef<{ prior: string; timeout: number } | null>(null);
  const startFilterPulse = useCallback((shaderId: string | undefined, durationMs: number | undefined) => {
    if (pulseRef.current) return; // don't stack pulses
    const prior = effectIdRef.current;
    const target = shaderId || activeTriggerExp?.config?.ambientShader?.shaderId || '';
    if (!target || target === 'none' || target === prior) return; // nothing distinct to pulse to
    setEffectId(target);
    const dur = durationMs && durationMs > 0 ? durationMs : 1200;
    const timeout = window.setTimeout(() => {
      setEffectId(pulseRef.current?.prior ?? 'none');
      pulseRef.current = null;
    }, dur);
    pulseRef.current = { prior, timeout };
  }, [activeTriggerExp]);
  useEffect(() => () => { if (pulseRef.current) window.clearTimeout(pulseRef.current.timeout); }, []);

  // One fired trigger event → an effect. Kept behind a ref so the RAF loop below
  // never has to restart when React re-creates the callback.
  const handleTriggerEvent = useCallback((e: TriggerEvent) => {
    const a = e.action;
    if (a.type === 'burst') {
      triggerFxRef.current?.fire(a.style);
    } else if (a.type === 'reveal') {
      setRevealedIds((prev) => {
        if (prev.has(a.objectId)) return prev;
        const next = new Set(prev);
        next.add(a.objectId);
        return next;
      });
      // Reuse the booth's existing reveal shimmer + 3D scale-in entrance.
      if (!prefersReducedMotion()) {
        setReveal(true);
        if (revealTimeoutRef.current) window.clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = window.setTimeout(() => setReveal(false), REVEAL_SHIMMER_MS);
      }
    } else {
      startFilterPulse(a.shaderId, a.durationMs);
    }
  }, [startFilterPulse]);
  const handleTriggerEventRef = useRef(handleTriggerEvent);
  useEffect(() => { handleTriggerEventRef.current = handleTriggerEvent; }, [handleTriggerEvent]);

  // Detection + engine loop — only for a DB scene with triggers while the camera
  // is live. Drives detection itself (detectFaceNow) so blendshapes refresh even
  // with no 3D piece mounted, and steps the engine once per NEW detection frame.
  useEffect(() => {
    if (source !== 'db' || !hasTriggers || phase !== 'camera' || !ready) return;
    const engine = createTriggerEngine(triggers);
    let raf = 0;
    let lastT = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current;
      if (!v) return;
      detectFaceNow(v);
      const b = getLatestBlendshapes();
      if (!b || b.t === lastT) return;
      lastT = b.t;
      for (const ev of engine.step(b.scores, performance.now())) handleTriggerEventRef.current(ev);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [source, hasTriggers, phase, ready, videoRef, triggers]);

  // A one-off guest hint when the scene has triggers ("Smile for a surprise").
  const [triggerHint, setTriggerHint] = useState(false);
  useEffect(() => {
    if (source === 'db' && hasTriggers && phase === 'camera' && ready) {
      setTriggerHint(true);
      const t = window.setTimeout(() => setTriggerHint(false), 5000);
      return () => window.clearTimeout(t);
    }
    setTriggerHint(false);
  }, [source, hasTriggers, phase, ready]);

  // ── Face-tracking hint ────────────────────────────────────────────────
  // A 3D piece is invisible until the tracker finds a face — without feedback
  // that reads as "broken". Track visibility from the rig and, after a short
  // grace (model warm-up + brief misses), coach the guest into the frame.
  const [faceVisible, setFaceVisible] = useState(false);
  const [faceHint, setFaceHint] = useState(false);
  useEffect(() => {
    if (is3D && !faceVisible && phase === 'camera' && ready) {
      const tid = setTimeout(() => setFaceHint(true), 1500);
      return () => clearTimeout(tid);
    }
    setFaceHint(false);
  }, [is3D, faceVisible, phase, ready]);

  // ── Shutter / countdown ───────────────────────────────────────────────
  const handleShutterPress = useCallback(() => {
    if (phase !== 'camera') return;
    if (mediaMode === 'video' && recording) return; // handled by stop button
    if (timerSec > 0) {
      setPhase('countdown');
    } else {
      // Fire immediately
      if (mediaMode === 'video') {
        startRecording();
      } else {
        capturePhoto();
      }
    }
  }, [phase, mediaMode, recording, timerSec]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCountdownComplete = useCallback(() => {
    if (mediaMode === 'video') {
      startRecording();
    } else {
      capturePhoto();
    }
  }, [mediaMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Photo capture ─────────────────────────────────────────────────────
  async function capturePhoto() {
    setPhase('flash');
    const stage = stageRef.current;
    if (!stage) { setPhase('camera'); return; }
    try {
      const dataUrl = await stage.capturePhoto();
      setCapturedDataUrl(dataUrl);
      capturedMediaTypeRef.current = 'image';
      setCapturedDurationMs(undefined);
      setTimeout(() => setPhase('review'), 180);
    } catch (e) {
      console.error('[Booth] capture failed', e);
      setPhase('camera');
    }
  }

  // ── Video recording ───────────────────────────────────────────────────
  function startRecording() {
    if (!recordingSupported()) { alert('Video recording is not supported in this browser.'); return; }
    const canvas = stageRef.current?.canvas;
    if (!canvas) return;

    setPhase('camera');
    setRecording(true);
    setRecordingMs(0);
    recordStartRef.current = performance.now();

    const recStream = buildRecordStream(canvas, streamRef.current ?? undefined, 30);
    const rec = new StreamRecorder({
      maxMs: VIDEO_MAX_MS,
      onTick: (ms) => setRecordingMs(ms),
      onMaxReached: () => stopRecording(rec),
    });
    recorderRef.current = rec;
    rec.start(recStream);
  }

  async function stopRecording(recOverride?: StreamRecorder) {
    const rec = recOverride ?? recorderRef.current;
    if (!rec) return;
    const blob = await rec.stop();
    rec.dispose();
    recorderRef.current = null;

    const url = URL.createObjectURL(blob);
    recordVideoUrlRef.current = url;
    setCapturedDataUrl(url);
    setCapturedBlobRef(blob);
    setCapturedDurationMs(Math.max(0, Math.round(performance.now() - recordStartRef.current)));
    capturedMediaTypeRef.current = 'video';
    setRecording(false);
    setRecordingMs(0);
    setPhase('review');
  }

  // Cleanup recorder on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.dispose();
      if (recordVideoUrlRef.current) URL.revokeObjectURL(recordVideoUrlRef.current);
    };
  }, []);

  // ── Send to wall ──────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (guestName: string, message: string) => {
      if (!capturedDataUrl) return;
      setPhase('sending');

      const isVideo = capturedMediaTypeRef.current === 'video';
      const blob = isVideo
        ? (capturedBlobRef ?? dataUrlToBlob(capturedDataUrl))
        : dataUrlToBlob(capturedDataUrl);

      const expId = attachExp?.id ?? frameExp?.id ?? (effectId !== 'none' ? `builtin:shader:${effectId}` : undefined);

      const post = await submitPost(eventId, {
        blob,
        mediaType: isVideo ? 'video' : 'image',
        durationMs: capturedDurationMs,
        message: message || undefined,
        guestName: guestName || undefined,
        experienceId: expId ?? null,
        challengeId: selectedChallenge?.id ?? null,
        width: 1080,
        height: 1920,
      });

      if (post) {
        savePhoto(eventId, {
          id: post.id,
          image_url: post.image_url,
          media_type: isVideo ? 'video' : 'image',
          message: message || undefined,
          createdAt: Date.now(),
        });
        // Remember the name (so challenge mode doesn't re-ask) + mark the
        // challenge complete so it drops off this guest's list.
        if (guestName) setGuestName(eventId, guestName);
        if (selectedChallenge) {
          addCompletedChallenge(eventId, selectedChallenge.id);
          setSelectedChallenge(null); // done — don't re-tag the next shot
        }
      }

      setPhase('success');
    },
    [capturedDataUrl, capturedBlobRef, capturedDurationMs, attachExp, frameExp, effectId, selectedChallenge, eventId],
  );

  const handleRetake = useCallback(() => {
    // Revoke video object URL if present
    if (recordVideoUrlRef.current) {
      URL.revokeObjectURL(recordVideoUrlRef.current);
      recordVideoUrlRef.current = null;
    }
    setMoreOpen(false);
    setCapturedDataUrl(null);
    setCapturedBlobRef(null);
    setPhase('camera');
  }, []);

  const handleTakeAnother = useCallback(() => {
    setMoreOpen(false);
    if (recordVideoUrlRef.current) {
      URL.revokeObjectURL(recordVideoUrlRef.current);
      recordVideoUrlRef.current = null;
    }
    setCapturedDataUrl(null);
    setCapturedBlobRef(null);
    setPhase('camera');
  }, []);

  // ── Recording progress ring ───────────────────────────────────────────
  const recordProgress = Math.min(recordingMs / VIDEO_MAX_MS, 1);
  const ringCircumference = 2 * Math.PI * 28; // r=28 for a 60px button

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-noir-900 select-none">
      <EventBackground density={44} sparkle={0.7} />

      {/* ── Welcome gate ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {!started && !error && (
          <Welcome key="welcome" onStart={() => setStarted(true)} />
        )}
      </AnimatePresence>

      {/* ── First-launch onboarding ────────────────────────────────────── */}
      <AnimatePresence>
        {started && onboardingVisible && (
          <Onboarding
            key="onboarding"
            onDismiss={() => {
              dismissOnboarding();
              setOnboardingVisible(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Error screen ──────────────────────────────────────────────── */}
      {error && <CameraErrorScreen error={error} onRetry={retry} />}

      {/* ── Camera starting ───────────────────────────────────────────── */}
      {started && !error && !ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 animate-rise-in">
            <div className="w-12 h-12 rounded-full border border-gold-400/30 animate-pulse-glow" />
            <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/40">
              Starting camera…
            </p>
          </div>
        </div>
      )}

      {/* ── Camera stage + chrome (flex column; the FULL 9:16 frame shows) ── */}
      {!error && (
        <div className="relative z-0 flex-1 flex flex-col min-h-0">

          {/* Header */}
          {phase === 'camera' && ready && (
            <div className="relative z-20 flex items-center justify-between gap-2 px-4 pt-safe-top pt-3 pb-2 shrink-0">
              <Emblem size={34} className="shrink-0 drop-shadow-[0_0_10px_rgba(var(--accent-rgb),0.35)]" />
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {wallSettings.showChallenges && (
                  <ChallengeSelector selectedChallenge={selectedChallenge} onSelect={setSelectedChallenge} />
                )}
                {recording ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full glass border border-red-500/40">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="font-label text-[9px] uppercase tracking-wide text-red-400">{Math.floor(recordingMs / 1000)}s</span>
                  </div>
                ) : (
                  <>
                    <a href={`${basePath}/wall`} title="Live Photo Wall" aria-label="Live Photo Wall" className="flex items-center gap-1.5 h-9 px-3 glass rounded-full text-champagne/70 hover:text-gold-300 transition-colors active:scale-95">
                      <GalleryIcon size={15} />
                      <span className="font-label text-[9px] uppercase tracking-wide">Wall</span>
                    </a>
                    <a href={`${basePath}/me`} title="My Media" aria-label="My Media" className="flex items-center gap-1.5 h-9 px-3 glass rounded-full text-champagne/70 hover:text-gold-300 transition-colors active:scale-95">
                      <MediaStackIcon size={15} />
                      <span className="font-label text-[9px] uppercase tracking-wide">Photos</span>
                    </a>
                    <a href={`${basePath}/upload`} title="Upload to the wall" aria-label="Upload to the wall" className="flex items-center gap-1.5 h-9 px-3 glass rounded-full text-champagne/70 hover:text-gold-300 transition-colors active:scale-95">
                      <UploadCloud className="w-[15px] h-[15px]" strokeWidth={1.7} />
                      <span className="font-label text-[9px] uppercase tracking-wide">Upload</span>
                    </a>
                    <ShareButton
                      label="Share"
                      iconSize={15}
                      className="flex items-center gap-1.5 h-9 px-3 glass rounded-full text-champagne/70 hover:text-gold-300 transition-colors active:scale-95 font-label text-[9px] uppercase tracking-wide"
                    />
                  </>
                )}
                <button
                  onClick={() => setUiHidden((h) => !h)}
                  title={uiHidden ? 'Show controls' : 'Hide controls — see the full frame'}
                  className="flex items-center gap-1.5 h-9 px-3 glass rounded-full text-champagne/60 hover:text-ivory border border-transparent hover:border-gold-400/30 transition-all active:scale-95"
                  aria-label="Toggle controls"
                >
                  {uiHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  <span className="font-label text-[9px] uppercase tracking-wide">{uiHidden ? 'Show' : 'Hide'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Stage — the full 9:16 capture frame, centred & letterboxed so the whole frame/border is visible */}
          <div className="flex-1 relative min-h-0 flex items-center justify-center px-2 pb-1">
            <div className="relative h-full aspect-[9/16] max-w-full rounded-[1.4rem] overflow-hidden ring-1 ring-gold-700/25 shadow-[0_10px_50px_rgba(0,0,0,0.6)] bg-noir-900">
              <video
                id="booth-video"
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none"
                style={{ transform: isFront ? 'scaleX(-1)' : 'none' }}
              />
              {ready && (
                <StageCanvas
                  ref={stageRef}
                  videoRef={videoRef}
                  effectId={effectId}
                  sparkles={sparkles}
                  mirror={isFront}
                  overlayUrl={stageOverlays ? null : (is2DOverlay ? frameExp!.asset_url : null)}
                  overlayTransform={overlayTransform}
                  overlayOpacity={frameExp?.config?.opacity}
                  overlays={stageOverlays}
                  threeCanvasId={is3D ? 'booth-3d-layer' : null}
                  active={true}
                  watermark={entitlements.watermark}
                  effectsCanvas={triggerFxCanvas}
                />
              )}
              <div ref={feedContainerRef} className="absolute inset-0">
                {is3D && anchorConfig && (
                  <Overlay3D
                    assetUrl={attachExp!.asset_url}
                    proceduralId={attachExp!.config?.procedural}
                    anchor={anchorConfig}
                    videoId="booth-video"
                    mirror={isFront}
                    occlude={source === 'db' && attachExp!.config?.occlusion === true}
                    headScale={studioCfg.headScale}
                    onFaceVisible={setFaceVisible}
                    pieces={overlayPieces}
                    reveal={reveal}
                  />
                )}
              </div>
              {/* Face-trigger particles — a sibling canvas over the stage. Also
                  passed into StageCanvas.effectsCanvas so an on-screen burst is
                  composited into the captured photo. Mounted only for trigger scenes. */}
              {hasTriggers && <TriggerEffects ref={triggerFxRef} />}
              <div className="absolute top-4 inset-x-0 z-30 flex flex-col items-center gap-2 pointer-events-none">
                <AnimatePresence>
                  {faceHint && (
                    <motion.div
                      key="face-hint"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-strong border border-gold-400/25"
                    >
                      <ScanFace className="w-4 h-4 text-gold-300 animate-pulse" />
                      <span className="font-label text-[10px] uppercase tracking-wide text-champagne/80">
                        Center your face in the frame
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {triggerHint && (
                    <motion.div
                      key="trigger-hint"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-strong border border-gold-400/25"
                    >
                      <Sparkles className="w-4 h-4 text-gold-300 animate-pulse" />
                      <span className="font-label text-[10px] uppercase tracking-wide text-champagne/80">
                        Smile for a surprise
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(120% 90% at 50% 38%, transparent 58%, rgba(0,0,0,0.4) 100%)' }}
              />
              {/* Reveal moment — transient DOM sibling only, never sampled by
                  StageCanvas.drawFrame (which only reads the video/shader/
                  three-canvas/overlay-image sources), so it cannot affect
                  capturePhoto's pixels either way. Unmounts completely via
                  AnimatePresence once `reveal` flips back to false. */}
              <AnimatePresence>
                {reveal && <RevealShimmer key="reveal-shimmer" />}
              </AnimatePresence>
            </div>
          </div>

          {/* Controls (camera phase, panel shown) */}
          {phase === 'camera' && ready && !uiHidden && (
            <div className="relative z-20 shrink-0 pb-safe-bottom">
              <div className="glass-strong rounded-t-3xl pt-2.5 pb-5">
                <FilterOrbs
                  catalog={catalog}
                  effectId={effectId}
                  sparkles={sparkles}
                  frameId={frameExp?.id ?? null}
                  attachmentId={attachExp?.id ?? null}
                  onSelectEffect={setEffectId}
                  onToggleSparkles={setSparkles}
                  onSelectFrame={handleSelectFrame}
                  onSelectAttachment={setAttachExp}
                />

                <div className="flex items-center justify-between px-6 pt-2">
                  {/* Left: mode + timer */}
                  <div className="flex flex-col items-center gap-2 w-[88px]">
                    <div className="flex items-center gap-1 glass rounded-full p-1">
                      <button onClick={() => { if (!recording) setMediaMode('photo'); }} disabled={recording} aria-label="Photo mode" className={`flex items-center justify-center px-2.5 py-1.5 rounded-full transition-all ${mediaMode === 'photo' ? 'bg-foil text-noir-900' : 'text-champagne/50 hover:text-ivory'}`}>
                        <CameraIcon className="w-3.5 h-3.5" />
                      </button>
                      {videoAllowed && (
                        <button onClick={() => { if (!recording) setMediaMode('video'); }} disabled={recording} aria-label="Video mode" className={`flex items-center justify-center px-2.5 py-1.5 rounded-full transition-all ${mediaMode === 'video' ? 'bg-foil text-noir-900' : 'text-champagne/50 hover:text-ivory'}`}>
                          <Video className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {mediaMode === 'photo' && !recording && (
                      <div className="relative">
                        <button onClick={() => setTimerPickerOpen((o) => !o)} className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-label uppercase tracking-wide transition-all glass border ${timerSec > 0 ? 'border-gold-400/40 text-gold-300' : 'border-transparent text-champagne/40 hover:text-champagne/70'}`}>
                          <Clock className="w-3 h-3" />{timerSec === 0 ? 'Timer' : `${timerSec}s`}
                        </button>
                        <AnimatePresence>
                          {timerPickerOpen && (
                            <motion.div initial={{ opacity: 0, y: 6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.95 }} transition={{ duration: 0.15 }} className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 glass-strong rounded-xl p-2 flex gap-1.5 z-30 shadow-xl">
                              {TIMER_OPTIONS.map((t) => (
                                <button key={t} onClick={() => { setTimerSec(t); setTimerPickerOpen(false); }} className={`w-10 h-8 rounded-lg font-label text-[10px] uppercase tracking-wide transition-all ${timerSec === t ? 'bg-foil text-noir-900' : 'text-champagne/60 hover:text-ivory hover:glass'}`}>{t === 0 ? 'Off' : `${t}s`}</button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>

                  {/* Center: shutter / record / stop */}
                  <div className="relative flex items-center justify-center">
                    {mediaMode === 'photo' ? (
                      <motion.button onClick={handleShutterPress} whileTap={{ scale: 0.88 }} className="relative w-[72px] h-[72px] rounded-full bg-foil glow-accent animate-pulse-glow flex items-center justify-center focus:outline-none" aria-label="Take photo">
                        <div className="absolute inset-2 rounded-full border-2 border-ivory/60" />
                        <div className="w-5 h-5 rounded-full bg-ivory/80" />
                      </motion.button>
                    ) : recording ? (
                      <div className="relative">
                        <svg className="absolute inset-0 -rotate-90" width="72" height="72" viewBox="0 0 72 72">
                          <circle cx="36" cy="36" r="28" fill="none" stroke="rgba(var(--accent-rgb),0.2)" strokeWidth="3" />
                          <circle cx="36" cy="36" r="28" fill="none" stroke="#D4AF37" strokeWidth="3" strokeLinecap="round" strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference * (1 - recordProgress)} style={{ transition: 'stroke-dashoffset 0.1s linear' }} />
                        </svg>
                        <button onClick={() => stopRecording()} className="relative w-[72px] h-[72px] rounded-full flex items-center justify-center focus:outline-none" aria-label="Stop recording">
                          <div className="w-8 h-8 rounded-lg bg-red-500 glow-soft" />
                        </button>
                      </div>
                    ) : (
                      <motion.button onClick={handleShutterPress} whileTap={{ scale: 0.88 }} className="relative w-[72px] h-[72px] rounded-full border-4 border-red-500 flex items-center justify-center focus:outline-none" style={{ background: 'rgba(239,68,68,0.15)' }} aria-label="Start recording">
                        <div className="w-6 h-6 rounded-full bg-red-500" />
                      </motion.button>
                    )}
                    {mediaMode === 'video' && recording && (
                      <div className="absolute -bottom-5 font-label text-[8px] uppercase tracking-wide text-champagne/50">{Math.ceil((VIDEO_MAX_MS - recordingMs) / 1000)}s left</div>
                    )}
                  </div>

                  {/* Right: flip + more */}
                  <div className="flex flex-col items-center gap-2 w-[88px]">
                    {canFlip ? (
                      <button onClick={() => { if (!recording) flipCamera(); }} disabled={recording} title="Switch camera (front / back)" className="w-11 h-11 glass rounded-full flex items-center justify-center text-champagne/70 hover:text-ivory hover:border-gold-400/30 border border-transparent transition-all active:scale-90 disabled:opacity-30" aria-label="Switch camera">
                        <SwitchCamera className="w-5 h-5" />
                      </button>
                    ) : <div className="w-11 h-11" />}
                    <button onClick={() => setMoreOpen(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-full glass text-[9px] font-label uppercase tracking-wide text-champagne/50 hover:text-gold-300 transition-colors">
                      <SlidersHorizontal className="w-3 h-3" /> All Filters
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Floating shutter when chrome is hidden (full-frame preview) */}
          {phase === 'camera' && ready && uiHidden && (
            <div className="absolute bottom-0 left-0 right-0 z-20 pb-safe-bottom flex flex-col items-center gap-3 pb-7 pointer-events-none">
              {mediaMode === 'photo' ? (
                <motion.button onClick={handleShutterPress} whileTap={{ scale: 0.88 }} className="pointer-events-auto relative w-[72px] h-[72px] rounded-full bg-foil glow-accent animate-pulse-glow flex items-center justify-center" aria-label="Take photo">
                  <div className="absolute inset-2 rounded-full border-2 border-ivory/60" />
                  <div className="w-5 h-5 rounded-full bg-ivory/80" />
                </motion.button>
              ) : recording ? (
                <button onClick={() => stopRecording()} className="pointer-events-auto w-[72px] h-[72px] rounded-full flex items-center justify-center glass" aria-label="Stop recording">
                  <div className="w-8 h-8 rounded-lg bg-red-500 glow-soft" />
                </button>
              ) : (
                <motion.button onClick={handleShutterPress} whileTap={{ scale: 0.88 }} className="pointer-events-auto relative w-[72px] h-[72px] rounded-full border-4 border-red-500 flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.15)' }} aria-label="Start recording">
                  <div className="w-6 h-6 rounded-full bg-red-500" />
                </motion.button>
              )}
              <button onClick={() => setUiHidden(false)} className="pointer-events-auto flex items-center gap-1 px-3 py-1 rounded-full glass text-[9px] font-label uppercase tracking-wide text-champagne/50 hover:text-gold-300 transition-colors">
                <ChevronUp className="w-3 h-3" /> Controls
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── White flash ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === 'flash' && (
          <motion.div
            key="flash"
            className="absolute inset-0 z-50 bg-white"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          />
        )}
      </AnimatePresence>

      {/* ── Countdown ─────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown from={timerSec || 3} onComplete={handleCountdownComplete} />
      )}

      {/* ── More filters & settings sheet ─────────────────────────────── */}
      {moreOpen && phase === 'camera' && (
        <div
          className="absolute inset-0 z-30 bg-noir-900/55 backdrop-blur-sm"
          onClick={() => setMoreOpen(false)}
        />
      )}
      {phase === 'camera' && ready && (
        <div className="absolute bottom-0 left-0 right-0 z-40 pb-safe-bottom pointer-events-none">
          <div className="pointer-events-auto">
            <PickerDrawer
              catalog={catalog}
              effectId={effectId}
              sparkles={sparkles}
              frameId={frameExp?.id ?? null}
              attachmentId={attachExp?.id ?? null}
              onSelectEffect={setEffectId}
              onToggleSparkles={setSparkles}
              onSelectFrame={handleSelectFrame}
              onSelectAttachment={setAttachExp}
              open={moreOpen}
              onOpenChange={setMoreOpen}
              hideBar
            />
          </div>
        </div>
      )}

      {/* ── Review panel ──────────────────────────────────────────────── */}
      {phase === 'review' && capturedDataUrl && (
        <ReviewPanel
          dataUrl={capturedDataUrl}
          mediaType={capturedMediaTypeRef.current}
          durationMs={capturedDurationMs}
          onRetake={handleRetake}
          onSend={handleSend}
          sending={false}
          selectedChallenge={selectedChallenge}
        />
      )}

      {/* ── Send-off + success ────────────────────────────────────────── */}
      {(phase === 'sending' || phase === 'success') && capturedDataUrl && (
        <SendOff
          dataUrl={capturedDataUrl}
          mediaType={capturedMediaTypeRef.current}
          uploading={phase === 'sending'}
          success={phase === 'success'}
          onTakeAnother={handleTakeAnother}
        />
      )}
    </div>
  );
}
