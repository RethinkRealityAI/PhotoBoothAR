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
import { AlertCircle, ChevronUp, RotateCcw, ScanFace, Sparkles } from 'lucide-react';

import EventBackground from './ui/EventBackground';
import { Emblem } from './ui/EventLogo';

// Booth sub-components
import { useCameraStream } from './booth/useCameraStream';
import Welcome from './booth/Welcome';
import CameraErrorScreen from './booth/CameraError';
import StageCanvas, {
  StageCanvasHandle, StageOverlaySpec, PREVIEW_W, PREVIEW_H, CAPTURE_W, CAPTURE_H,
} from './booth/StageCanvas';
import Overlay3D, { Overlay3DPiece } from './booth/Overlay3D';
import { boothLightingFor } from '../lib/studio/lighting';
import TriggerEffects, { type TriggerEffectsHandle } from './booth/TriggerEffects';
import PickerDrawer from './booth/PickerDrawer';
import BoothControlDeck from './booth/BoothControlDeck';
import BoothTopBar from './booth/BoothTopBar';
import {
  buildDeck, initialCategory, type DeckCategory, type DeckSelection,
} from '../lib/boothDeck';
import { haptic } from '../lib/haptics';
import Countdown from './booth/Countdown';
import ReviewPanel from './booth/ReviewPanel';
import ChallengeCheck from './booth/ChallengeCheck';
import SendOff from './booth/SendOff';
import SendFailed from './booth/SendFailed';
import Onboarding, { useOnboarding } from './booth/Onboarding';
import ChallengeSelector from './booth/ChallengeSelector';

// Foundation APIs
import { useStore } from '../store';
import { useEvent } from '../events/EventContext';
import { buildCatalog } from '../lib/catalog';
import { initializeFaceLandmarker } from '../lib/faceTracking';
import { getLatestBlendshapes, detectFaceNow, getHeadFitEstimate } from '../lib/faceRig';
import {
  collectTriggers,
  createTriggerEngine,
  revealTargetIdsOf,
  isLayerVisible,
  resolvePulseShader,
  pulseRestoreValue,
  triggerHintText,
  shouldRunTriggers,
  type TriggerConfig,
  type TriggerEvent,
} from '../lib/studio/triggers';
import { submitPostDetailed, getStudioSettings } from '../lib/db';
import { DEFAULT_STUDIO_SETTINGS, HEAD_SCALE_MIN, HEAD_SCALE_MAX, type StudioSettings } from '../lib/studio/occluder';
import {
  savePhoto, addCompletedChallenge, setGuestName, getGuestName, hasSkippedGuestName, skipGuestName,
} from '../lib/session';
import { normalizeGuestLettering } from '../lib/letteringFit';
import { StreamRecorder, buildRecordStream, recordingSupported } from '../lib/recorder';
import { useEntitlements } from '../lib/entitlements';
import { dataUrlToBlob } from './booth/capture';
import { challengeNeedsCheck, validateChallengePhoto } from '../lib/challengeValidation';
import { fileToImagePart } from '../lib/imageInput';
import RevealShimmer from './booth/RevealShimmer';
import { REVEAL_SHIMMER_MS } from '../lib/studio/reveal';
import { setThumbSource } from './booth/filterThumbEngine';
import { assetUrlsOf, isPending, selectionSignature, withLoaded } from '../lib/boothAssets';
import {
  detectSwipe, isDoubleTap, cycleIndex, isCrampedLandscape, type PointerSample,
} from '../lib/boothGestures';
import { playCue, primeAudio } from '../lib/boothAudio';
import {
  composeStrip, stripComplete, stripProgressLabel,
  STRIP_SHOTS, STRIP_GAP_MS, STRIP_LEAD_SEC, type StripShotCount,
} from '../lib/photoStrip';
import StripPicker from './booth/StripPicker';
import type { Transform2D, Experience, AnchorConfig, Challenge } from '../types';
import { layerToPiece } from '../lib/studio/draftMapping';

// ─────────────────────────────────────────────────────────────────────────────

type BoothPhase =
  | 'camera'
  | 'countdown'
  | 'flash'
  | 'review'
  | 'checking'      // AI photo-check running (challenge validation)
  | 'checkFailed'   // photo didn't match the challenge — retake or post anyway
  | 'sending'
  | 'success'
  | 'sendFailed';  // upload failed — honest retry/save screen, never fake confetti

type MediaMode = 'photo' | 'video';
type TimerOption = 0 | 3 | 5 | 10;

const TIMER_OPTIONS: TimerOption[] = [0, 3, 5, 10];
const VIDEO_MAX_MS = 30_000;
const DEFAULT_TRANSFORM: Transform2D = { scale: 1, x: 0, y: 0, rotation: 0 };
/** Upper bound on the send + challenge-check awaits so "Beaming…"/"Checking…"
 *  can never spin forever on a stalled connection. */
const SEND_TIMEOUT_MS = 45_000;

/** Sends scale the timeout with payload size: a 30 s clip at 5 Mbps is ~18 MB,
 *  which legitimately needs >45 s on a slow venue uplink. Timing out while the
 *  upload is still succeeding server-side shows a false failure whose Retry
 *  then duplicates the post — so grant ~1 s per 250 kB on top of the base,
 *  bounded so a truly stalled connection still fails. */
function sendTimeoutFor(blob: Blob): number {
  return Math.min(SEND_TIMEOUT_MS + Math.ceil(blob.size / 250_000) * 1000, 240_000);
}

/** Resolve with `fallback` if `p` hasn't settled within `ms` (or rejects) —
 *  the db/validation layers own the fetches, so the timeout lives here at the
 *  call-site. The late-settling promise is ignored, never unhandled. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** URLs already pulled into the HTTP cache this session — a second selection of
 *  the same frame must not re-warm it. */
const warmedAssets = new Set<string>();
/** Ceiling on a warm-up, so a hung request can never leave a permanent spinner
 *  on an orb. The asset itself keeps loading; only our "pending" claim expires. */
const WARM_TIMEOUT_MS = 12_000;

/**
 * Pull an experience's asset into the browser cache and resolve when it is
 * there, so the booth knows when a selection is genuinely ready to draw.
 *
 * ALWAYS RESOLVES. A 404, a CORS refusal, an offline radio or a corrupt file
 * all resolve exactly like a success: the pending state clears and the booth
 * renders whatever it can, which is precisely today's behaviour. Reporting an
 * error here would only replace "nothing happened" with a spinner that never
 * stops — strictly worse.
 *
 * Images are decoded (so `StageCanvas`'s own `loadImage` is an instant cache
 * hit). Anything else — in practice a .glb — is fetched to completion, which
 * warms the same HTTP cache `FaceRig`'s GLTFLoader reads from. That is a proxy
 * for "ready", not a guarantee of it: see the follow-up contract noted for
 * FaceRig in the wave report.
 */
function warmAsset(url: string): Promise<void> {
  if (warmedAssets.has(url)) return Promise.resolve();
  const done = new Promise<void>((resolve) => {
    const finish = () => { warmedAssets.add(url); resolve(); };
    const timer = window.setTimeout(finish, WARM_TIMEOUT_MS);
    const settle = () => { window.clearTimeout(timer); finish(); };
    if (/\.(png|jpe?g|webp|gif|svg|avif)(\?|#|$)/i.test(url) || url.startsWith('data:')) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = settle;
      img.onerror = settle;
      img.src = url;
      return;
    }
    fetch(url, { mode: 'cors', credentials: 'omit' })
      .then((r) => r.arrayBuffer())
      .then(settle, settle);
  });
  return done;
}

/**
 * Renders `children(ms)` against the recording clock WITHOUT the clock living in
 * Booth's state. The recorder ticks ~10x/s for up to 30s; as component state
 * that re-rendered this entire 1400-line tree ~300 times per clip to move one
 * progress ring. Only the subscribing node re-renders now.
 */
function RecordingClock({
  subs, children,
}: {
  subs: React.RefObject<Set<(ms: number) => void>>;
  children: (ms: number) => React.ReactNode;
}) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const set = subs.current;
    if (!set) return;
    set.add(setMs);
    return () => { set.delete(setMs); };
  }, [subs]);
  return <>{children(ms)}</>;
}

/**
 * Owns the eased head-scale so the auto-fit tween re-renders ONLY the 3D layer.
 * The ease is a ~600ms rAF ramp; driven through Booth state it re-rendered the
 * whole booth ~36 times per adjustment. `base` is the host's calibrated value
 * (re-seeds on change); `subRef` receives the setter while this is mounted, so
 * the tween can push frames straight here. The `headScale` value sequence
 * reaching Overlay3D is unchanged.
 */
function HeadScaleOverlay3D({
  base, subRef, ...props
}: {
  base: number;
  subRef: React.RefObject<((v: number) => void) | null>;
} & Omit<React.ComponentProps<typeof Overlay3D>, 'headScale'>) {
  const [scale, setScale] = useState(base);
  useEffect(() => { setScale(base); }, [base]);
  useEffect(() => {
    subRef.current = setScale;
    return () => { subRef.current = null; };
  }, [subRef]);
  return <Overlay3D {...props} headScale={scale} />;
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
  /** Event copy (used for the photo strip's footer line). */
  const copy = useStore((s) => s.copy);

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
  // The filter's own Experience. A shader is applied as a bare shaderId, so its
  // Experience used to be discarded at the call site — and with it any
  // config.triggers, which is why a filter-only scene could never fire one.
  const [effectExp, setEffectExp] = useState<Experience | null>(null);
  /** Apply a filter AND remember which Experience it came from, so its
   *  config.triggers reach the engine. NOTE a bare `setEffectId` is assignable
   *  to this 2-arg callback type, so TypeScript will NOT catch a call site that
   *  goes back to dropping the experience — keep them going through here. */
  const applyEffect = useCallback((shaderId: string, exp: Experience | null = null) => {
    setEffectId(shaderId);
    setEffectExp(shaderId === 'none' ? null : exp);
  }, []);
  const [sparkles, setSparkles] = useState(false);
  const [frameExp, setFrameExp] = useState<Experience | null>(null);
  const [attachExp, setAttachExp] = useState<Experience | null>(null);
  const [overlayTransform, setOverlayTransform] = useState<Transform2D>(DEFAULT_TRANSFORM);

  // ── Timer ─────────────────────────────────────────────────────────────
  const [timerSec, setTimerSec] = useState<TimerOption>(0);
  const [timerPickerOpen, setTimerPickerOpen] = useState(false);
  /** What the on-screen countdown counts from. Held separately from `timerSec`
   *  because the photo strip leads every shot after the first with its own
   *  short countdown regardless of the guest's timer setting. */
  const [countdownFrom, setCountdownFrom] = useState(3);

  // ── Photo strip ───────────────────────────────────────────────────────
  // Three shots, composited into ONE keepsake card. Deliberately built on top
  // of the untouched capture path: each panel is a normal
  // `StageCanvas.capturePhoto()` and the result is a normal 9:16 JPEG, so
  // review, the AI challenge check, submitPost, the wall and the keepsake card
  // all receive exactly the shape they already handle.
  const [stripMode, setStripMode] = useState(false);
  /** How many shots the armed strip takes (2 or 3), chosen in StripPicker. */
  const [stripCount, setStripCount] = useState<StripShotCount>(STRIP_SHOTS as StripShotCount);
  const [stripPickerOpen, setStripPickerOpen] = useState(false);
  /** `capturePhoto` is a plain function reached through MEMOIZED callbacks
   *  (handleCountdownComplete memoizes on [mediaMode]), so reading `stripMode`
   *  from the render closure served a stale `false` and the strip captured one
   *  panel then jumped to review. A ref is read at call time, so no memoized
   *  caller can serve an out-of-date value. */
  const stripModeRef = useRef(stripMode);
  useEffect(() => { stripModeRef.current = stripMode; }, [stripMode]);
  /** Same call-time-read reasoning: `advanceStrip` runs from `capturePhoto`. */
  const stripCountRef = useRef<StripShotCount>(stripCount);
  useEffect(() => { stripCountRef.current = stripCount; }, [stripCount]);
  /** Same reasoning as `stripModeRef` — read the mode at call time, not at the
   *  time the enclosing callback was last memoized. */
  const mediaModeRef = useRef(mediaMode);
  useEffect(() => { mediaModeRef.current = mediaMode; }, [mediaMode]);
  const stripShotsRef = useRef<string[]>([]);
  const [stripTaken, setStripTaken] = useState(0);
  const stripTimerRef = useRef<number | null>(null);
  const resetStrip = useCallback(() => {
    if (stripTimerRef.current) { window.clearTimeout(stripTimerRef.current); stripTimerRef.current = null; }
    stripShotsRef.current = [];
    setStripTaken(0);
  }, []);
  useEffect(() => () => {
    if (stripTimerRef.current) window.clearTimeout(stripTimerRef.current);
  }, []);

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
  // AI challenge photo-check: the reason shown on a failed check, and the
  // name/message the guest already entered (so "post anyway" can go straight through).
  const [checkReason, setCheckReason] = useState('');
  const pendingSendRef = useRef<{ guestName: string; message: string } | null>(null);
  // Failed-send handling: the failure kind (drives the SendFailed copy) and the
  // last submit args so "Try again" re-runs the exact same upload.
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  // True when the accepted post is awaiting host approval (pre-moderation
  // events) — drives the honest "sent for review" success copy.
  const [pendingApproval, setPendingApproval] = useState(false);
  const lastSubmitRef = useRef<{ guestName: string; message: string; withChallenge: boolean } | null>(null);

  // ── Transient booth hint (capture/recording failures) ─────────────────
  // The booth's own pill idiom (same as faceHint/triggerHint) instead of a
  // bare alert(): auto-dismisses, never blocks the camera.
  const [boothHint, setBoothHint] = useState<string | null>(null);
  const boothHintTimerRef = useRef<number | null>(null);
  const showBoothHint = useCallback((msg: string) => {
    setBoothHint(msg);
    if (boothHintTimerRef.current) window.clearTimeout(boothHintTimerRef.current);
    boothHintTimerRef.current = window.setTimeout(() => setBoothHint(null), 3000);
  }, []);
  useEffect(() => () => {
    if (boothHintTimerRef.current) window.clearTimeout(boothHintTimerRef.current);
  }, []);

  // ── Recording ─────────────────────────────────────────────────────────
  const recorderRef = useRef<StreamRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  // Elapsed recording time is published to <RecordingClock> subscribers instead
  // of held as Booth state — see RecordingClock. `recording` (a boolean that
  // flips twice per clip) stays state because the layout genuinely changes.
  const recordingMsSubsRef = useRef<Set<(ms: number) => void>>(new Set());
  const publishRecordingMs = useCallback((ms: number) => {
    for (const fn of recordingMsSubsRef.current) fn(ms);
  }, []);
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
        setEffectExp(exp);
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
      setEffectExp(exp);
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

  // ── Asset readiness (the loading state a selection never had) ──────────
  // Tapping a crown on venue wifi used to produce NOTHING for seconds: the orb
  // read as selected, the GLB was still on the network, and — worse — the
  // reveal shimmer had ALREADY played, so the magic moment celebrated an empty
  // frame. Track which URLs have actually landed, show a pending ring on the
  // orb until they have, and hold the reveal until the asset is there.
  const [loadedAssets, setLoadedAssets] = useState<ReadonlySet<string>>(() => new Set<string>());
  /**
   * THE EXACT 3D SIGNAL (W6). `warmAsset` below fetches a .glb to completion,
   * which warms the same HTTP cache the loader reads — but a fetch ending is
   * NOT the same as geometry being on screen: a 12 MB Meshy model still has to
   * be parsed and cloned, hundreds of ms on a phone, and the reveal shimmer used
   * to fire in that gap over an empty frame. Overlay3D now reports each piece's
   * url the frame its scene graph actually mounts (FaceRig `Model.onReady`), and
   * this marks it loaded. Both paths write the SAME set, and marking a url twice
   * is a no-op, so the warm-up stays as the backstop for a piece that never
   * mounts (a 2D-only selection, a hidden layer).
   */
  const markAssetLoaded = useCallback((url: string) => {
    setLoadedAssets((prev) => withLoaded(prev, url));
  }, []);

  /**
   * THE LEGACY GATE for lighting. `boothLightingFor` returns 'legacy' for ANY
   * event whose source is not 'db' — hope-gala, jenna-jake and detola-wuyi get
   * the exact ambient 1.2 / directional 1.8 / warm point 0.8 rig they shipped
   * with, no environment map, so their saved photos are byte-identical. Only a
   * platform event a host authored in the studio gets the new lighting, and
   * only the preset that host chose.
   */
  const boothLighting = boothLightingFor(source, studioCfg.lighting);
  const selectionUrls = useMemo(() => {
    const urls = assetUrlsOf(frameExp);
    for (const u of assetUrlsOf(attachExp)) if (!urls.includes(u)) urls.push(u);
    return urls;
  }, [frameExp, attachExp]);
  const selectionPending = isPending(selectionUrls, loadedAssets);
  useEffect(() => {
    if (selectionUrls.length === 0) return;
    let alive = true;
    for (const url of selectionUrls) {
      void warmAsset(url).then(() => {
        if (alive) setLoadedAssets((prev) => withLoaded(prev, url));
      });
    }
    return () => { alive = false; };
  }, [selectionUrls]);
  /** Ids whose assets are still in flight — drives the deck's pending ring. */
  const pendingExperienceIds = useMemo(() => {
    const ids = new Set<string>();
    if (frameExp && isPending(assetUrlsOf(frameExp), loadedAssets)) ids.add(frameExp.id);
    if (attachExp && isPending(assetUrlsOf(attachExp), loadedAssets)) ids.add(attachExp.id);
    return ids;
  }, [frameExp, attachExp, loadedAssets]);

  const selectionSig = useMemo(
    () => selectionSignature(frameExp?.id ?? null, attachExp?.id ?? null),
    [frameExp, attachExp],
  );
  /** A selection that has changed but whose asset has not arrived yet. The
   *  shimmer is ARMED here and FIRED below, once the bytes are in. */
  const armedRevealRef = useRef<string | null>(null);
  useEffect(() => {
    const prevSig = prevSelectionRef.current;
    prevSelectionRef.current = selectionSig;
    if (source !== 'db') return;                  // legacy/code events: never
    if (!selectionSig || selectionSig === prevSig) return; // deselecting, or unchanged: never
    armedRevealRef.current = selectionSig;
  }, [selectionSig, source]);
  useEffect(() => {
    if (armedRevealRef.current === null) return;
    if (armedRevealRef.current !== selectionSig) return; // superseded by a newer pick
    if (selectionPending) return;                        // wait for the asset itself
    armedRevealRef.current = null;
    if (prefersReducedMotion()) return;      // a11y: apply instantly, no animated entrance
    setReveal(true);
    if (revealTimeoutRef.current) window.clearTimeout(revealTimeoutRef.current);
    revealTimeoutRef.current = window.setTimeout(() => setReveal(false), REVEAL_SHIMMER_MS);
  }, [selectionSig, selectionPending]);
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

  // ── Guest-name lettering ──────────────────────────────────────────────
  // Opt-in per FRAME (config.lettering, written only by the studio). Legacy
  // coded events never carry the key, so this resolves to null for them and
  // StageCanvas skips the draw step entirely — their output is unchanged.
  const letteringSpec = useMemo(
    () => normalizeGuestLettering(frameExp?.config?.lettering),
    [frameExp],
  );
  // Bumped whenever the guest saves/skips a name, so the canvas picks it up
  // (localStorage is not reactive).
  const [guestNameTick, setGuestNameTick] = useState(0);
  /** THE guest's own name for this event — the single source both the 2D
   *  lettering and a 3D asset's engraved label read (never a second pipeline). */
  const guestName = useMemo(() => {
    void guestNameTick;
    return getGuestName(eventId);
  }, [eventId, guestNameTick]);
  const guestLetteringName = useMemo(
    () => (!letteringSpec ? '' : letteringSpec.token === 'fixed' ? letteringSpec.text : guestName),
    [letteringSpec, guestName],
  );
  /** The name prompt is owed when the frame wants the GUEST's name, we don't
   *  have one, and they haven't already declined for this event. */
  const needsGuestName =
    letteringSpec?.token === 'guestName' && !guestLetteringName && !hasSkippedGuestName(eventId);
  const [askName, setAskName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const stageLettering = useMemo(
    () => (letteringSpec ? { spec: letteringSpec, name: guestLetteringName } : null),
    [letteringSpec, guestLetteringName],
  );

  // ── Face-triggered effects ────────────────────────────────────────────
  // Opt-in per DB scene (config.triggers). Legacy/code events never carry them,
  // so the whole subsystem below stays inert — empty triggers means no engine,
  // no RAF, no reveal filtering — and the booth renders byte-identically.
  const activeTriggerExp =
    (attachExp?.config?.triggers ? attachExp : null)
    ?? (frameExp?.config?.triggers ? frameExp : null)
    ?? (effectExp?.config?.triggers ? effectExp : null);
  // Merge triggers from BOTH of the scene's experiences: a scene can pair a 3D
  // attach and a 2D frame that EACH carry config.triggers, and reading only the
  // primary (activeTriggerExp) silently dropped the other's. Dedupe by trigger
  // id; a composite sets attachExp === frameExp, so parse it once (single-source
  // scenes stay byte-identical — the one experience is the only one parsed).
  const triggers = useMemo<TriggerConfig[]>(
    () => (source !== 'db' ? [] : collectTriggers([attachExp, frameExp, effectExp])),
    [source, attachExp, frameExp, effectExp],
  );
  const hasTriggers = triggers.length > 0;
  // Layer ids that a reveal trigger hides until it fires; `revealedIds` is the
  // runtime set already fired. NEVER persisted — a fresh scene starts all hidden.
  const revealTargetIds = useMemo(() => revealTargetIdsOf(triggers), [triggers]);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => { setRevealedIds(new Set()); }, [activeTriggerExp]);
  // A layer that is a reveal-trigger TARGET is hidden-until-fired BY DESIGN, so
  // its reveal state ALONE decides visibility — an editor "hidden" (eye toggle)
  // must not also suppress it, or the reveal could never appear. Every other
  // (non-targeted) layer keeps the studio eye toggle (l.hidden). With no
  // triggers the target set is empty, so this reduces to `l.hidden !== true`.
  // Shared with StudioStage/StudioPreview as one pure predicate — the inline
  // copies had drifted (Preview ANDed the two conditions, so an eye-hidden
  // reveal target could never appear there however often the trigger fired).
  const layerVisible = useCallback(
    (l: { id: string; hidden?: boolean }) => isLayerVisible(l, revealTargetIds, revealedIds),
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
      // Visibility per layerVisible: normal layers respect the studio eye toggle
      // (`hidden`); reveal-target layers are gated only by their trigger firing.
      .filter((l) => (l.kind === 'border' || l.kind === '2d_filter') && !!l.asset_url && layerVisible(l))
      .map((l) => ({
        url: l.asset_url as string,
        transform: l.transform ?? DEFAULT_TRANSFORM,
        opacity: l.opacity ?? 1,
        animation: l.animation,
      }));
  }, [frameLayers, layerVisible]);

  const attachLayers = attachExp?.config?.layers;
  const overlayPieces: Overlay3DPiece[] | undefined = useMemo(() => {
    if (!attachLayers || attachLayers.length === 0) return undefined;
    return attachLayers
      // Same layerVisible rule as the 2D builder above (eye toggle, except
      // reveal targets which are gated only by their trigger firing).
      .filter((l) => l.kind === '3d_attachment' && !!l.anchor && layerVisible(l))
      // ONE mapper, shared with StudioPreview and Studio3DView (draftMapping):
      // animation, occlusion, finish/tint and customization were hand-written
      // three times and nothing compared them. The source==='db' gates stay
      // EXPLICIT here — legacy/code events never carry layers, and that
      // invariant is worth stating rather than inferring.
      .map((l) => layerToPiece(l, {
        guestName,
        occlusionEnabled: source === 'db',
        customizationEnabled: source === 'db',
      }));
  }, [attachLayers, source, layerVisible, guestName]);

  // ── Auto head-size (per-guest transfer) ───────────────────────────────
  // STRICTLY OPT-IN by construction: only kicks in when the occluder is actually
  // rendering (headScale is what sizes it), the host captured a baseline via the
  // studio "Apply" chip, AND auto-fit is left on. With no baseline — every
  // legacy/code event (source !== 'db' → studioCfg stays DEFAULT), and every db
  // scene whose host never used Apply — `autoFitEnabled` is false, so
  // the effective head scale equals `studioCfg.headScale` exactly and the occluder
  // renders byte-identically to today (getHeadFitEstimate is never even read).
  const occlusionActive =
    source === 'db' &&
    ((attachExp?.config?.occlusion === true) || (overlayPieces?.some((p) => p.occlude === true) ?? false));
  const autoFitEnabled =
    occlusionActive && studioCfg.baselineFit != null && studioCfg.autoHeadScale !== false;

  // Current value + tween handle as refs so the 1s interval below reads fresh
  // state and an in-flight ease can be cancelled without effect churn. The
  // VALUE itself is not Booth state: it is pushed to HeadScaleOverlay3D through
  // this subscriber, so a 60fps ease never re-renders the booth (see D7).
  const effHeadScaleRef = useRef(studioCfg.headScale);
  const headScaleSubRef = useRef<((v: number) => void) | null>(null);
  const headScaleTweenRef = useRef<number | null>(null);
  // Seed to the host's calibrated base whenever it (or the enable flag) changes.
  // When auto-fit is OFF this is the final value — the interval below never runs.
  useEffect(() => {
    if (headScaleTweenRef.current) { cancelAnimationFrame(headScaleTweenRef.current); headScaleTweenRef.current = null; }
    effHeadScaleRef.current = studioCfg.headScale;
    // Explicit: the child re-seeds itself when `base` changes, but a cancelled
    // tween may have moved it away while `base` stayed the same.
    headScaleSubRef.current?.(studioCfg.headScale);
  }, [studioCfg.headScale, autoFitEnabled]);
  // Transfer the live guest fit as a RATIO to the host's baseline (the defensible
  // signal — see faceRig's estimator note; the absolute factor is only a
  // heuristic). Applied at most ~1/s once the estimate has stabilized, and only
  // re-applied when it drifts >5%, so the occluder never jitters. Each
  // application EASES over ~600ms — the first one lands mid-framing and a hard
  // snap of up to ±15% is visible on the occluder edge (audit M-A1). The booth's
  // own FaceRig detection already feeds the estimator, so no extra detection runs.
  useEffect(() => {
    const baseline = studioCfg.baselineFit;
    if (!autoFitEnabled || baseline == null || phase !== 'camera' || !ready) return;
    const base = studioCfg.headScale;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const easeTo = (target: number) => {
      if (headScaleTweenRef.current) cancelAnimationFrame(headScaleTweenRef.current);
      const from = effHeadScaleRef.current;
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 600);
        const v = from + (target - from) * (k * (2 - k)); // easeOutQuad
        effHeadScaleRef.current = v;
        headScaleSubRef.current?.(v);
        headScaleTweenRef.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      headScaleTweenRef.current = requestAnimationFrame(step);
    };
    const id = window.setInterval(() => {
      const est = getHeadFitEstimate();
      if (!est || est.samples < 20) return; // wait for the ring to stabilize (~0.7s)
      const ratio = clamp(est.factor / baseline, 0.87, 1.15);
      const next = clamp(base * ratio, HEAD_SCALE_MIN, HEAD_SCALE_MAX);
      if (Math.abs(next / effHeadScaleRef.current - 1) > 0.05) easeTo(next);
    }, 1000);
    return () => {
      window.clearInterval(id);
      if (headScaleTweenRef.current) { cancelAnimationFrame(headScaleTweenRef.current); headScaleTweenRef.current = null; }
    };
  }, [autoFitEnabled, studioCfg.baselineFit, studioCfg.headScale, phase, ready]);

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
  const pulseRef = useRef<{ prior: string; target: string; timeout: number } | null>(null);
  // End an in-flight pulse: clear its restore timer, drop the state, and only
  // then optionally restore the pre-pulse effect. `restore` is true just on the
  // normal same-scene timeout path; a scene switch cancels WITHOUT restoring.
  const endFilterPulse = useCallback((restore: boolean) => {
    const p = pulseRef.current;
    if (!p) return;
    window.clearTimeout(p.timeout);
    pulseRef.current = null;
    // Restore FUNCTIONALLY and only if the pulse shader is still the one on
    // screen: a guest who picked their own filter during the ~1.2s pulse used to
    // have that choice silently reverted when the timer fired.
    if (restore) setEffectId((cur) => pulseRestoreValue(cur, p.target, p.prior));
  }, []);
  const startFilterPulse = useCallback((shaderId: string | undefined, durationMs: number | undefined) => {
    if (pulseRef.current) return; // don't stack pulses
    const prior = effectIdRef.current;
    // resolvePulseShader returns null when the pulse would be invisible (no
    // distinct shader requested, or the same one already showing) — which is
    // exactly what the authoring UI's DEFAULT filterPulse used to produce.
    const target = resolvePulseShader(shaderId, prior);
    if (!target) return;
    setEffectId(target);
    const dur = durationMs && durationMs > 0 ? durationMs : 1200;
    const timeout = window.setTimeout(() => endFilterPulse(true), dur);
    pulseRef.current = { prior, target, timeout };
  }, [endFilterPulse]);
  // A pulse must never outlive the scene that fired it. When the active trigger
  // scene changes (or the booth unmounts), cancel any in-flight pulse WITHOUT
  // restoring: the incoming scene sets its own filter, so restoring scene A's
  // pre-pulse value would stomp it. The same-scene restore is the timeout above,
  // which can only fire while this scene is still current — this cleanup clears
  // that timer first on any switch, so a stale pulse can't stomp the new scene.
  useEffect(() => () => endFilterPulse(false), [activeTriggerExp, endFilterPulse]);

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
    if (!shouldRunTriggers(source, hasTriggers, phase, ready)) return;
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

  // A one-off guest hint when the scene has triggers. The copy names the source
  // the HOST actually authored — it used to hard-code "Smile for a surprise", so
  // a wink-triggered scene told every guest to do the wrong thing.
  const triggerHintCopy = useMemo(() => triggerHintText(triggers) ?? 'Smile for a surprise', [triggers]);
  const [triggerHint, setTriggerHint] = useState(false);
  useEffect(() => {
    if (source === 'db' && hasTriggers && phase === 'camera' && ready) {
      // (the hint itself stays camera-only — it is guidance before the shutter)
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
    // A browser will only unblock WebAudio inside a REAL user gesture, and this
    // is the only one the countdown gets — prime the shared context here or the
    // ticks are silent for the whole session.
    primeAudio();
    // This frame puts the guest's NAME on the photo and we don't have one yet:
    // ask before the first shot, not after. Skipping is remembered per event,
    // so this can only ever interrupt once.
    if (needsGuestName && !askName) {
      setNameDraft('');
      setAskName(true);
      return;
    }
    const strip = mediaMode === 'photo' && stripMode;
    if (strip) resetStrip();
    // A strip always leads with a visible countdown even when the guest's timer
    // is Off — three shots fired the instant you tap is a strip of one pose and
    // two surprised faces.
    const lead = timerSec > 0 ? timerSec : (strip ? STRIP_LEAD_SEC : 0);
    if (lead > 0) {
      setCountdownFrom(lead);
      setPhase('countdown');
    } else {
      // Fire immediately
      if (mediaMode === 'video') {
        startRecording();
      } else {
        capturePhoto();
      }
    }
  }, [phase, mediaMode, recording, timerSec, needsGuestName, askName, stripMode, resetStrip]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCountdownComplete = useCallback(() => {
    if (mediaMode === 'video') {
      startRecording();
    } else {
      capturePhoto();
    }
  }, [mediaMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The escape hatch the countdown never had. Abandons the shot (and any
   *  half-finished strip) and returns to a live viewfinder. */
  const handleCountdownCancel = useCallback(() => {
    resetStrip();
    setPhase('camera');
  }, [resetStrip]);

  // ── Photo capture ─────────────────────────────────────────────────────
  async function capturePhoto() {
    setPhase('flash');
    const stage = stageRef.current;
    if (!stage) { setPhase('camera'); return; }
    try {
      const dataUrl = await stage.capturePhoto();
      // The shutter BUTTON already buzzes on press; this is the confirmation
      // that a frame actually landed — which is a different event entirely once
      // a timer or a strip puts seconds between the two.
      haptic('success');
      playCue('shutter');
      if (mediaModeRef.current === 'photo' && stripModeRef.current) { await advanceStrip(dataUrl); return; }
      setCapturedDataUrl(dataUrl);
      capturedMediaTypeRef.current = 'image';
      setCapturedDurationMs(undefined);
      setTimeout(() => setPhase('review'), 180);
    } catch (e) {
      console.error('[Booth] capture failed', e);
      haptic('error');
      setPhase('camera');
      resetStrip();
      showBoothHint('Capture failed — try again');
    }
  }

  /**
   * Fold one captured panel into the strip, then either queue the next shot or
   * composite and hand the finished card to the normal review flow.
   */
  async function advanceStrip(dataUrl: string) {
    const shots = [...stripShotsRef.current, dataUrl];
    stripShotsRef.current = shots;
    setStripTaken(shots.length);

    if (!stripComplete(shots.length, stripCountRef.current)) {
      // Back to a LIVE viewfinder between panels so the guest can see the pose
      // they are changing into, then auto-run the next countdown. A strip is
      // one decision, not three taps.
      setPhase('camera');
      stripTimerRef.current = window.setTimeout(() => {
        setCountdownFrom(STRIP_LEAD_SEC);
        setPhase('countdown');
      }, STRIP_GAP_MS);
      return;
    }

    try {
      const card = await composeStrip(shots, {
        width: CAPTURE_W,
        height: CAPTURE_H,
        background: '#05060B',
        accent: eventConfig.accentHexes[0] ?? '#E8C766',
        // The card's gradient ambience is painted from the event's own accent
        // palette — the flat black behind the panels read as unfinished.
        palette: eventConfig.accentHexes,
        // Each panel already carries the baked signature, but at panel scale it
        // is a smudge — the card-level line is the legible one, and it stays
        // entitlement-gated exactly like the per-photo watermark.
        footer: entitlements.watermark ? copy.eventName : undefined,
      });
      setCapturedDataUrl(card);
    } catch (e) {
      // Compositing failed (a browser that refuses a 2D context). NEVER lose
      // the shots the guest already posed for — post the last panel as an
      // ordinary photo instead of dropping the whole strip.
      console.error('[Booth] strip compose failed', e);
      showBoothHint('Couldn’t build the strip — keeping your last shot');
      setCapturedDataUrl(shots[shots.length - 1]);
    }
    capturedMediaTypeRef.current = 'image';
    setCapturedBlobRef(null);
    setCapturedDurationMs(undefined);
    resetStrip();
    setTimeout(() => setPhase('review'), 180);
  }

  // ── Video recording ───────────────────────────────────────────────────
  function startRecording() {
    if (!recordingSupported()) {
      showBoothHint('Video recording isn’t supported in this browser');
      return;
    }
    const canvas = stageRef.current?.canvas;
    if (!canvas) return;

    setPhase('camera');
    setRecording(true);
    publishRecordingMs(0);
    recordStartRef.current = performance.now();

    /** Any start/mid-recording failure: drop the recorder, reset the recording
     *  state and tell the guest — never a stuck red ring or silent truncation. */
    const failRecording = (rec: StreamRecorder, e: unknown) => {
      console.error('[Booth] recording failed', e);
      rec.dispose();
      if (recorderRef.current === rec) recorderRef.current = null;
      setRecording(false);
      publishRecordingMs(0);
      setPhase('camera');
      showBoothHint('Recording failed — try again');
    };

    try {
      const recStream = buildRecordStream(canvas, streamRef.current ?? undefined, 30);
      const rec = new StreamRecorder({
        maxMs: VIDEO_MAX_MS,
        onTick: publishRecordingMs,
        onMaxReached: () => stopRecording(rec),
        onError: (e) => failRecording(rec, e),
      });
      recorderRef.current = rec;
      rec.start(recStream);
    } catch (e) {
      const rec = recorderRef.current;
      if (rec) {
        failRecording(rec, e);
      } else {
        console.error('[Booth] recording failed to start', e);
        setRecording(false);
        publishRecordingMs(0);
        showBoothHint('Recording failed — try again');
      }
    }
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
    publishRecordingMs(0);
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
  /** The actual upload. `withChallenge=false` posts WITHOUT tagging the
   *  challenge (used by "post anyway" after a failed AI check → no points). */
  const doSubmit = useCallback(
    async (guestName: string, message: string, withChallenge: boolean) => {
      if (!capturedDataUrl) return;
      lastSubmitRef.current = { guestName, message, withChallenge };
      setPhase('sending');

      const isVideo = capturedMediaTypeRef.current === 'video';
      const blob = isVideo
        ? (capturedBlobRef ?? dataUrlToBlob(capturedDataUrl))
        : dataUrlToBlob(capturedDataUrl);

      const expId = attachExp?.id ?? frameExp?.id ?? (effectId !== 'none' ? `builtin:shader:${effectId}` : undefined);
      const taggedChallenge = withChallenge ? selectedChallenge : null;

      // Bounded wait: a stalled upload resolves as a 'network' failure (the
      // honest SendFailed screen with Retry) instead of "Beaming…" forever.
      const { post, error } = await withTimeout(
        submitPostDetailed(eventId, {
          blob,
          mediaType: isVideo ? 'video' : 'image',
          durationMs: capturedDurationMs,
          message: message || undefined,
          guestName: guestName || undefined,
          experienceId: expId ?? null,
          challengeId: taggedChallenge?.id ?? null,
          // Report the TRUE buffer: a video is captureStream() of the preview
          // canvas (720x1280), not the 1080x1920 still buffer. Both are exactly
          // 9:16 so nothing laid out wrong, but the stored metadata was false.
          width: isVideo ? PREVIEW_W : CAPTURE_W,
          height: isVideo ? PREVIEW_H : CAPTURE_H,
        }),
        sendTimeoutFor(blob),
        { post: null, error: 'network' },
      );

      if (!post) {
        // Honest failure: the capture stays in state — the guest can retry the
        // upload or save the file locally. Never a fake "Sent!".
        setSendError(error);
        setPhase('sendFailed');
        return;
      }

      // Pre-moderation events return the post with approved=false — the
      // success screen must say "sent for review", not promise the wall.
      setPendingApproval(post.approved === false);

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
      if (taggedChallenge) {
        addCompletedChallenge(eventId, taggedChallenge.id);
        setSelectedChallenge(null); // done — don't re-tag the next shot
      }

      setPhase('success');
    },
    [capturedDataUrl, capturedBlobRef, capturedDurationMs, attachExp, frameExp, effectId, selectedChallenge, eventId],
  );

  const handleSend = useCallback(
    async (guestName: string, message: string) => {
      if (!capturedDataUrl) return;
      const isVideo = capturedMediaTypeRef.current === 'video';

      // AI photo-check gate — only for photo captures on a challenge that
      // requires one. Fails OPEN (any error → the shot still posts): a booth
      // must never trap a guest on an AI hiccup.
      if (!isVideo && challengeNeedsCheck(selectedChallenge) && selectedChallenge) {
        pendingSendRef.current = { guestName, message };
        setPhase('checking');
        const part = await fileToImagePart(dataUrlToBlob(capturedDataUrl));
        // Bounded wait, same fail-OPEN contract as validateChallengePhoto: a
        // stalled check passes the shot through rather than spinning forever.
        const outcome = part
          ? await withTimeout(
              validateChallengePhoto(eventId, selectedChallenge.id, part),
              SEND_TIMEOUT_MS,
              { pass: true, reason: '' },
            )
          : { pass: true, reason: '' };
        if (!outcome.pass) {
          setCheckReason(outcome.reason);
          setPhase('checkFailed');
          return;
        }
      }
      await doSubmit(guestName, message, true);
    },
    [capturedDataUrl, selectedChallenge, eventId, doSubmit],
  );

  // Re-arm the scene's surprises for the next capture. `revealedIds` was only
  // ever cleared when the active experience OBJECT changed, and the booth never
  // unmounts between guests (the flow is phase state, not routing) — so a reveal
  // was one-shot per SESSION: guest #2 onward walked up to a booth already
  // showing the piece that was supposed to appear when they smiled.
  const rearmReveals = useCallback(() => {
    setRevealedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

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
    rearmReveals();
  }, [rearmReveals]);

  const handleTakeAnother = useCallback(() => {
    setMoreOpen(false);
    if (recordVideoUrlRef.current) {
      URL.revokeObjectURL(recordVideoUrlRef.current);
      recordVideoUrlRef.current = null;
    }
    setCapturedDataUrl(null);
    setCapturedBlobRef(null);
    setPhase('camera');
    rearmReveals();
  }, [rearmReveals]);

  // ── Outcome feedback ──────────────────────────────────────────────────
  // `haptic('success')`/`haptic('error')` existed in the library but nothing in
  // the booth ever fired them: the two moments a guest most needs confirming —
  // "it's on the wall" and "it didn't send" — were silent and buzz-free. One
  // effect on the phase, so every route into these states (first send, retry,
  // "post anyway" after a failed challenge check) is covered.
  useEffect(() => {
    if (phase === 'success') { haptic('success'); playCue('success'); }
    else if (phase === 'sendFailed') haptic('error');
  }, [phase]);

  // ── Live filter thumbnails ────────────────────────────────────────────
  // Point the shared 96px preview engine at the booth's video. It only runs
  // while orbs are actually on screen (they register themselves), the camera is
  // live and reduced motion is off — see filterThumbEngine for the cost budget.
  useEffect(() => {
    setThumbSource(videoRef.current, ready && phase === 'camera' && !uiHidden, isFront);
  }, [ready, phase, uiHidden, isFront, videoRef]);
  useEffect(() => () => { setThumbSource(null, false, true); }, []);

  // ── Viewfinder gestures ───────────────────────────────────────────────
  // The viewfinder had no gestures at all, which is below the baseline every
  // guest brings from Instagram/Snapchat. Swipe sideways to change the look,
  // double-tap to flip the camera. Attached to the STAGE box only, so the
  // control deck's own drag/scroll behaviour is untouched.
  const gestureStartRef = useRef<PointerSample | null>(null);
  const lastTapRef = useRef<PointerSample | null>(null);
  // Taken from the catalog rather than the deck sections, which are built
  // further down — the swipe must work whichever tab the deck happens to show.
  const filterOptions = useMemo(
    () => catalog.filter((e) => e.kind === 'shader' && !!e.config?.shader?.shaderId),
    [catalog],
  );
  const stepFilter = useCallback((dir: 'left' | 'right') => {
    if (filterOptions.length === 0) return;
    const cur = filterOptions.findIndex((e) => e.config?.shader?.shaderId === effectId);
    const next = cycleIndex(cur, filterOptions.length, dir);
    haptic('select');
    if (next < 0) applyEffect('none');
    else applyEffect(filterOptions[next].config!.shader!.shaderId, filterOptions[next]);
  }, [filterOptions, effectId, applyEffect]);

  const onStagePointerDown = useCallback((e: React.PointerEvent) => {
    if (phase !== 'camera') return;
    gestureStartRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  }, [phase]);

  const onStagePointerUp = useCallback((e: React.PointerEvent) => {
    const start = gestureStartRef.current;
    gestureStartRef.current = null;
    if (!start || phase !== 'camera') return;
    const end: PointerSample = { x: e.clientX, y: e.clientY, t: performance.now() };
    const swipe = detectSwipe(start, end);
    if (swipe) {
      lastTapRef.current = null;   // a swipe is never half of a double-tap
      stepFilter(swipe);
      return;
    }
    // Not a swipe → a tap. Two quick ones in the same spot flip the camera.
    if (isDoubleTap(lastTapRef.current, end)) {
      lastTapRef.current = null;
      if (canFlip && !recording) { haptic('toggle'); flipCamera(); }
      return;
    }
    lastTapRef.current = end;
  }, [phase, stepFilter, canFlip, recording, flipCamera]);

  // ── Orientation ───────────────────────────────────────────────────────
  // The stage is a fixed 9:16 box and the capture buffer is 1080x1920 by
  // construction, so a phone held sideways STILL produces a portrait photo —
  // a landscape "group shot" layout would silently crop the group it promised
  // to fit. Rather than lie about the frame, say so: a rotate prompt with an
  // honest reason and a "use it sideways" escape, so nobody is ever blocked.
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 0 : window.innerWidth,
    h: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  const cramped = isCrampedLandscape(viewport.w, viewport.h);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  // Turning back to portrait re-arms the prompt, so a guest who dismissed it
  // once in a lift is not stuck with it silently off for the whole event.
  useEffect(() => { if (!cramped) setRotateDismissed(false); }, [cramped]);
  const showRotatePrompt = cramped && !rotateDismissed && started && !error;
  // A guest who chose "use it sideways" gets the frame UNOBSTRUCTED. In cramped
  // landscape the 9:16 stage is only ~220px wide, and the full deck sits right
  // on top of it. Collapse to the booth's existing chrome-hidden layout — the
  // shutter plus a "Controls" pill — which is tested code and still lets them
  // bring the deck back deliberately.
  useEffect(() => {
    if (cramped && rotateDismissed) setUiHidden(true);
  }, [cramped, rotateDismissed]);

  // ── Recording progress ring ───────────────────────────────────────────
  // Hoisted: this is a matchMedia() call, and it used to run on EVERY render of
  // the booth. It only feeds a tap-scale animation, so reading it once at mount
  // is the same answer for the life of the screen.
  const reducedMotionPref = useMemo(prefersReducedMotion, []);
  const ringCircumference = 2 * Math.PI * 28; // r=28 for a 60px button

  // ── Control deck ──────────────────────────────────────────────────────
  const deckSections = useMemo(() => buildDeck(catalog), [catalog]);
  // Memoized: a fresh object literal per render made this a new prop identity
  // on every single re-render of the booth, defeating any memo downstream.
  const deckSelection: DeckSelection = useMemo(() => ({
    effectId,
    frameId: frameExp?.id ?? null,
    attachmentId: attachExp?.id ?? null,
  }), [effectId, frameExp, attachExp]);
  const [deckCategory, setDeckCategory] = useState<DeckCategory | null>(null);
  // Open on whatever is already applied (an /experience/:id link or the
  // event's default), else the first category — but only once the catalog has
  // actually arrived, and never overriding a tab the guest chose themselves.
  const deckCatSetRef = useRef(false);
  useEffect(() => {
    if (deckCatSetRef.current || deckSections.length === 0) return;
    setDeckCategory(initialCategory(deckSections, deckSelection));
    deckCatSetRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckSections]);

  /* The shutter lives here, not in the deck: it owns capture, recording and
     the progress ring. Extracted so the deck and the chrome-hidden view render
     the SAME control rather than two copies that drift apart. */
  const shutterNode = (
    <div className="relative flex items-center justify-center">
      {mediaMode === 'photo' ? (
        <motion.button
          onClick={() => { haptic('capture'); handleShutterPress(); }}
          whileTap={reducedMotionPref ? undefined : { scale: 0.88 }}
          className="relative h-[74px] w-[74px] rounded-full bg-foil glow-accent flex items-center justify-center"
          style={{ boxShadow: '0 0 34px -6px rgba(var(--accent-rgb),0.85), inset 0 1px 0 rgba(255,255,255,0.4)' }}
          aria-label="Take photo"
        >
          <span className="absolute inset-2 rounded-full border-2 border-ivory/60" />
          <span className="h-5 w-5 rounded-full bg-ivory/85" />
        </motion.button>
      ) : recording ? (
        <div className="relative">
          <svg className="absolute inset-0 -rotate-90" width="74" height="74" viewBox="0 0 74 74">
            <circle cx="37" cy="37" r="28" fill="none" stroke="rgba(var(--accent-rgb),0.2)" strokeWidth="3" />
            <RecordingClock subs={recordingMsSubsRef}>
              {(ms) => (
                <circle
                  cx="37" cy="37" r="28" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringCircumference * (1 - Math.min(ms / VIDEO_MAX_MS, 1))}
                  style={{ transition: 'stroke-dashoffset 0.1s linear' }}
                />
              )}
            </RecordingClock>
          </svg>
          <button
            onClick={() => { haptic('toggle'); stopRecording(); }}
            className="pressable relative flex h-[74px] w-[74px] items-center justify-center rounded-full"
            aria-label="Stop recording"
          >
            <span className="h-8 w-8 rounded-lg bg-red-500 glow-soft" />
          </button>
        </div>
      ) : (
        <motion.button
          onClick={() => { haptic('capture'); handleShutterPress(); }}
          whileTap={reducedMotionPref ? undefined : { scale: 0.88 }}
          className="relative flex h-[74px] w-[74px] items-center justify-center rounded-full border-4 border-red-500"
          style={{ background: 'rgba(239,68,68,0.15)' }}
          aria-label="Start recording"
        >
          <span className="h-6 w-6 rounded-full bg-red-500" />
        </motion.button>
      )}
      {mediaMode === 'video' && recording && (
        <span className="absolute -bottom-5 font-label text-[8px] uppercase tracking-wide text-brand-muted/60">
          <RecordingClock subs={recordingMsSubsRef}>
            {(ms) => <>{Math.ceil((VIDEO_MAX_MS - ms) / 1000)}s left</>}
          </RecordingClock>
        </span>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden app-bg select-none">
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
            <div className="relative h-12 w-12">
              <div className="absolute inset-0 rounded-full border border-gold-400/30 animate-pulse-glow" />
              <div className="absolute inset-1 animate-spin rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)]" />
            </div>
            <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/40">
              Starting camera…
            </p>
          </div>
        </div>
      )}

      {/* ── Camera stage + chrome (flex column; the FULL 9:16 frame shows) ── */}
      {!error && (
        <div className="relative z-0 flex-1 flex flex-col min-h-0">

          {/* Floating chrome — the old header was a wrapping row of five
              labelled pills above the viewfinder, which on a phone took two
              rows and hid the top of the very frame the guest was choosing.
              It now floats OVER the stage, camera-app style. */}
          {phase === 'camera' && ready && (
            <RecordingClock subs={recordingMsSubsRef}>
              {(ms) => (
                <BoothTopBar
                  basePath={basePath}
                  uiHidden={uiHidden}
                  onToggleUi={() => setUiHidden((h) => !h)}
                  recording={recording}
                  recordingMs={ms}
                  canFlip={canFlip}
                  onFlip={() => { if (!recording) flipCamera(); }}
                  leading={
                    <>
                      <Emblem size={30} className="shrink-0 drop-shadow-[0_0_10px_rgba(var(--accent-rgb),0.35)]" />
                      {wallSettings.showChallenges && !recording && (
                        <ChallengeSelector selectedChallenge={selectedChallenge} onSelect={setSelectedChallenge} />
                      )}
                    </>
                  }
                />
              )}
            </RecordingClock>
          )}

          {/* Stage — a TRUE 9:16 box, letterboxed inside whatever space is left.
              It previously claimed to be letterboxed while being `h-full` +
              `aspect-[9/16]` + `max-w-full`, which is not a 9:16 box: CSS
              `aspect-ratio` only derives the axis that is MISSING, and `h-full`
              made the height definite, so clamping the width never gave the
              height back. On a 390x844 phone the box came out ~390x750 = 0.52
              against the 720x1280 (0.5625) canvas, and `object-cover` ate ~16px
              off each side — the guest framed their shot against a frame whose
              edges only reappeared at review. Same bug and same fix as the
              studio stage (src/lib/studio/stageLayout.ts, StudioStage.tsx).
              `height` is the min of the space available and the height this
              width can support, so the ratio survives a width-bound layout. The
              Tailwind classes stay as the fallback: a browser without container
              units drops the inline `height` and lands on today's behaviour
              rather than a collapsed (zero-height) stage. */}
          <div
            className="flex-1 relative min-h-0 flex items-center justify-center px-2 pb-1"
            style={{ containerType: 'size' }}
          >
            <div
              className="relative h-full aspect-[9/16] max-w-full rounded-[1.4rem] overflow-hidden ring-1 ring-gold-700/25 shadow-[0_10px_50px_rgba(0,0,0,0.6)] bg-noir-900 touch-pan-y"
              style={{ height: 'min(100cqh, calc(100cqw * 16 / 9))' }}
              // Swipe sideways = next/previous filter; double-tap = flip camera.
              // Scoped to the stage box, so the control deck below keeps its own
              // horizontal scroll and drag behaviour untouched.
              onPointerDown={onStagePointerDown}
              onPointerUp={onStagePointerUp}
              onPointerCancel={() => { gestureStartRef.current = null; }}
            >
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
                  lettering={stageLettering}
                  // The recorded clip IS this canvas (captureStream below), and
                  // the preview pass skips the signature — so every video used
                  // to ship unsigned while every photo shipped signed. On only
                  // while recording, so the viewfinder stays clean otherwise.
                  burnSignature={recording}
                />
              )}
              <div ref={feedContainerRef} className="absolute inset-0">
                {is3D && anchorConfig && (
                  <HeadScaleOverlay3D
                    base={studioCfg.headScale}
                    subRef={headScaleSubRef}
                    assetUrl={attachExp!.asset_url}
                    proceduralId={attachExp!.config?.procedural}
                    anchor={anchorConfig}
                    videoId="booth-video"
                    mirror={isFront}
                    occlude={source === 'db' && attachExp!.config?.occlusion === true}
                    onFaceVisible={setFaceVisible}
                    pieces={overlayPieces}
                    reveal={reveal}
                    lightingPreset={boothLighting}
                    onAssetReady={markAssetLoaded}
                  />
                )}
              </div>
              {/* Face-trigger particles. This canvas is the SOURCE: it is passed
                  to StageCanvas.effectsCanvas (:1081) and composited into the
                  same canvas that produces the preview, the JPEG and the recorded
                  video. It must stay MOUNTED and rendering, but it must not also
                  be drawn on top — it was, so every burst was drawn twice on
                  screen and the live preview came out brighter than the photo the
                  guest keeps. `opacity-0` rather than `hidden` because the
                  component hardcodes `display: block`. */}
              {hasTriggers && <TriggerEffects ref={triggerFxRef} className="absolute inset-0 w-full h-full pointer-events-none opacity-0" />}
              <div className="absolute top-4 inset-x-0 z-30 flex flex-col items-center gap-2 pointer-events-none">
                {/* Photo strip — which panel we're on, between shots. Without
                    this the camera silently reappears for a second and a half
                    and the guest cannot tell whether the strip is still going. */}
                <AnimatePresence>
                  {stripMode && mediaMode === 'photo' && stripTaken > 0 && phase === 'camera' && (
                    <motion.div
                      key="strip-progress"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-strong border border-gold-400/25"
                    >
                      <span className="flex gap-1">
                        {Array.from({ length: stripCount }, (_, i) => (
                          <span
                            key={i}
                            className="h-1.5 w-4 rounded-full"
                            style={{
                              background: i < stripTaken
                                ? 'var(--color-accent)'
                                : 'rgba(255,255,255,0.22)',
                            }}
                          />
                        ))}
                      </span>
                      <span className="font-label text-[10px] uppercase tracking-wide text-champagne/80">
                        {stripProgressLabel(stripTaken, stripCount)} — strike a new pose
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {boothHint && (
                    <motion.div
                      key="booth-hint"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-strong border border-gold-400/25"
                    >
                      <AlertCircle className="w-4 h-4 text-gold-300" />
                      <span className="font-label text-[10px] uppercase tracking-wide text-champagne/80">
                        {boothHint}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
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
                        {triggerHintCopy}
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

          {/* Control deck — the demo's shape: centered category tabs, one orb
              row, then the shutter row with the capture-mode pill and timer
              flanking the shutter. */}
          {phase === 'camera' && ready && !uiHidden && (
            <div className="absolute inset-x-0 bottom-0 z-20">
              <BoothControlDeck
                sections={deckSections}
                selection={deckSelection}
                category={deckCategory}
                onCategory={setDeckCategory}
                sparkles={sparkles}
                onToggleSparkles={setSparkles}
                onSelectEffect={applyEffect}
                onSelectFrame={handleSelectFrame}
                onSelectAttachment={setAttachExp}
                onClearAll={() => {
                  setEffectId('none');
                  setSparkles(false);
                  handleSelectFrame(null);
                  setAttachExp(null);
                }}
                onOpenAll={() => setMoreOpen(true)}
                mediaMode={mediaMode}
                onMediaMode={setMediaMode}
                videoAllowed={videoAllowed}
                timerSec={timerSec}
                onTimerSec={(t) => setTimerSec(t)}
                timerOptions={TIMER_OPTIONS}
                recording={recording}
                shutter={shutterNode}
                pendingIds={pendingExperienceIds}
                stripMode={stripMode}
                onStripMode={setStripMode}
                stripShots={stripCount}
                onOpenStripPicker={() => setStripPickerOpen(true)}
              />
            </div>
          )}

          {/* Chrome hidden — just the shutter and a way back. */}
          {phase === 'camera' && ready && uiHidden && (
            <div className="absolute bottom-0 left-0 right-0 z-20 pb-safe-bottom [--safe-bottom:1.75rem] flex flex-col items-center gap-3">
              {shutterNode}
              <button
                onClick={() => { haptic('toggle'); setUiHidden(false); }}
                className="pressable liquid-glass-raised flex min-h-11 items-center gap-1 rounded-full px-4 font-label text-[10px] uppercase tracking-wide text-brand-fg/70"
              >
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

      {/* ── Photo-strip format picker ─────────────────────────────────── */}
      {stripPickerOpen && (
        <StripPicker
          stripMode={stripMode}
          current={stripCount}
          onPick={(n) => {
            setStripCount(n);
            setMediaMode('photo');
            setStripMode(true);
            setStripPickerOpen(false);
          }}
          onSingle={() => {
            setStripMode(false);
            setStripPickerOpen(false);
          }}
          onClose={() => setStripPickerOpen(false)}
        />
      )}

      {/* ── Countdown ─────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown
          from={countdownFrom || 3}
          onComplete={handleCountdownComplete}
          onCancel={handleCountdownCancel}
          caption={mediaMode === 'photo' && stripMode ? stripProgressLabel(stripTaken, stripCount) : undefined}
        />
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
              onSelectEffect={applyEffect}
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
          selectedChallenge={selectedChallenge}
        />
      )}

      {/* ── AI challenge photo-check ──────────────────────────────────── */}
      {(phase === 'checking' || phase === 'checkFailed') && capturedDataUrl && (
        <ChallengeCheck
          dataUrl={capturedDataUrl}
          phase={phase === 'checking' ? 'checking' : 'failed'}
          challengeTitle={selectedChallenge?.title}
          reason={checkReason}
          onRetake={handleRetake}
          onPostAnyway={() => {
            const p = pendingSendRef.current;
            doSubmit(p?.guestName ?? '', p?.message ?? '', false);
          }}
        />
      )}

      {/* ── Name for the frame (asked once, before the first shot) ─────── */}
      {askName && (
        <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-noir-900/70 backdrop-blur-sm px-4 pb-safe-bottom [--safe-bottom:1.5rem]">
          <div className="w-full max-w-sm liquid-glass rounded-3xl px-6 py-6 text-center">
            <h3 className="font-serif text-2xl text-ivory mb-1">Put your name on it</h3>
            <p className="font-sans text-[13px] text-champagne/60 leading-relaxed mb-5">
              This frame writes your name across every shot you take. Skip it and the frame stays as it is.
            </p>
            <input
              type="text"
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value.slice(0, 60))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || nameDraft.trim().length < 2) return;
                setGuestName(eventId, nameDraft);
                setGuestNameTick((t) => t + 1);
                setAskName(false);
              }}
              placeholder="Your name"
              className="w-full text-center bg-noir-800/70 border border-gold-400/25 rounded-xl px-4 py-3 font-sans text-base text-ivory placeholder-champagne/30 outline-none focus:border-gold-400/60 transition-colors mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  // Remembered per event: never ask this guest again, and the
                  // lettering simply draws nothing for them.
                  skipGuestName(eventId);
                  setGuestNameTick((t) => t + 1);
                  setAskName(false);
                }}
                className="flex-1 glass rounded-xl px-4 py-3 font-label uppercase tracking-luxe text-[11px] text-champagne/60 hover:text-ivory transition-colors"
              >
                Continue without a name
              </button>
              <button
                onClick={() => {
                  setGuestName(eventId, nameDraft);
                  setGuestNameTick((t) => t + 1);
                  setAskName(false);
                }}
                disabled={nameDraft.trim().length < 2}
                className="flex-1 bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl px-4 py-3 hover:brightness-110 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
              >
                Use it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Send-off + success ────────────────────────────────────────── */}
      {(phase === 'sending' || phase === 'success') && capturedDataUrl && (
        <SendOff
          dataUrl={capturedDataUrl}
          mediaType={capturedMediaTypeRef.current}
          uploading={phase === 'sending'}
          success={phase === 'success'}
          pendingApproval={pendingApproval}
          onTakeAnother={handleTakeAnother}
        />
      )}

      {/* ── Rotate prompt (cramped landscape) ─────────────────────────────
          NOT a block: "Use it sideways" dismisses it and the booth stays fully
          usable, because a guest who has chosen to shoot sideways is allowed
          to. It exists to tell the truth about the frame — every capture is
          1080x1920 by construction, so a sideways group shot gets cropped to
          portrait whatever we lay out. Saying that up front is kinder than a
          collapsed stage with the deck sitting on top of it. */}
      {showRotatePrompt && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-noir-900/92 backdrop-blur-md px-6">
          <div className="flex max-w-sm flex-col items-center gap-5 text-center">
            <motion.div
              animate={reducedMotionPref ? undefined : { rotate: [0, -90, -90, 0] }}
              transition={reducedMotionPref ? undefined : { duration: 3, repeat: Infinity, times: [0, 0.35, 0.75, 1], ease: 'easeInOut' }}
              className="flex h-20 w-14 items-center justify-center rounded-2xl border-2 border-gold-400/50"
              style={{ boxShadow: '0 0 30px -6px rgba(var(--accent-rgb),0.6)' }}
            >
              <RotateCcw className="h-6 w-6 text-gold-300" />
            </motion.div>
            <div className="space-y-2">
              <h3 className="font-serif text-2xl text-ivory">Turn your phone upright</h3>
              <p className="font-sans text-[13px] leading-relaxed text-champagne/60">
                Every shot from this booth is a tall 9:16 photo — sideways, you
                only see a sliver of the frame you&rsquo;re actually posing in.
              </p>
            </div>
            <button
              onClick={() => { haptic('tap'); setRotateDismissed(true); }}
              className="pressable glass min-h-11 rounded-full px-6 font-label text-[11px] uppercase tracking-luxe text-champagne/70 hover:text-ivory transition-colors"
            >
              Use it sideways anyway
            </button>
          </div>
        </div>
      )}

      {/* ── Send failed — retry or save locally, never silently lost ──── */}
      {phase === 'sendFailed' && capturedDataUrl && (
        <SendFailed
          dataUrl={capturedDataUrl}
          mediaType={capturedMediaTypeRef.current}
          errorKind={sendError}
          onRetry={() => {
            const p = lastSubmitRef.current;
            if (p) doSubmit(p.guestName, p.message, p.withChallenge);
          }}
          onBackToBooth={handleTakeAnother}
        />
      )}
    </div>
  );
}
