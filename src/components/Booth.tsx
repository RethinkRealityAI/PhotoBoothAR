/**
 * Hope Gala 2026 — Guest Photo Booth (Round 2)
 *
 * Architecture:
 *   • Single composited StageCanvas (preview + capture + record)
 *   • Collapsible PickerDrawer (effects + frames + 3D — combinable)
 *   • Front/back camera flip (only shown when hasMultipleCameras)
 *   • Photo / Video mode toggle (record up to the plan's videoMaxSec via StreamRecorder)
 *   • Timer selector: Off / 3s / 5s / 10s
 *   • First-launch Onboarding modal
 *   • Challenge selector (optional, tags post via challengeId)
 *   • Golden-disintegration send-off animation
 */
import {
  useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore,
} from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, ChevronUp, Hand, Images, Pencil, RotateCcw, ScanFace, Upload, X } from 'lucide-react';

import EventBackground from './ui/EventBackground';
import { Emblem } from './ui/EventLogo';

// Booth sub-components
import { useCameraStream } from './booth/useCameraStream';
import { useBoothTelemetry } from './booth/useBoothTelemetry';
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
import BoothLookDeck from './booth/BoothLookDeck';
import LooksSheet from './booth/LooksSheet';
import WorldStage, { preloadWorldBoard } from './booth/WorldStage';
import SkyStage from './booth/SkyStage';
import {
  isSkyShaderId, skyEffect, skyExperiences, skyIdFrom, skyIdOfShader, skyPalette, skyQuery, skyWords,
  stageShaderId, SKY_ONLY_AR_ID, SKY_PARAM, SKY_SHADER_PREFIX,
} from '../lib/world/skyFx';
import { isWorldLook, withWorldLooks, worldLookFrameUrl, WORLD_LOOK_PREFIX } from '../lib/world/worldLooks';
import {
  arFrameIdFrom, enterArUrl, leaveArUrl, worldTrackerFrom, CAMERA_ON_PARAM,
  AR_SWITCH_KEY, arSwitchDirFor, arSwitchNote, readArSwitchNote, type ArSwitchDir,
} from '../lib/world/arSession';
import ArSwitchScreen from './booth/ArSwitchScreen';
import { WorldSession, isPhoneUa } from '../lib/world/xr8World';
import type { CameraIncident, CameraSourceOverride } from './booth/useCameraStream';
import { TimerControl } from './booth/BoothCaptureControls';
import {
  buildDeck, initialCategory, initialCategoryWhenReady, type DeckCategory, type DeckSelection,
} from '../lib/boothDeck';
import { isPaintLook } from '../lib/lookStrip';
import { mergePaintLayers } from '../lib/paintSlot';
import { haptic } from '../lib/haptics';
import Countdown from './booth/Countdown';
import ReviewPanel from './booth/ReviewPanel';
import ChallengeCheck from './booth/ChallengeCheck';
import SendOff from './booth/SendOff';
import SendFailed from './booth/SendFailed';
import Onboarding, { useOnboarding } from './booth/Onboarding';
import {
  CAMERA_HINT_COPY, cameraHintSeen, markCameraHintSeen, safeLocalStorage, skipBoothSplash,
  challengeFromRouterState, nextChallenge,
} from '../lib/guestFlow';
import { shouldShowOnboarding } from '../lib/boothCameraGate';
import ChallengeSelector from './booth/ChallengeSelector';

// Foundation APIs
import { useStore } from '../store';
import { useEvent } from '../events/EventContext';
import { buildCatalog } from '../lib/catalog';
import {
  getActiveFaceEngineInfo, initFaceEngine, isLegacyFaceSurface, resolveSurfaceFaceMode, setFaceTrackingMode, setFrameLockRecording, subscribeFaceEngine,
} from '../lib/faceEngine';
import { parseFaceTrackingMode } from '../lib/faceEngine/engineSelect';
import TrackingReadout from './ar/TrackingReadout';
import LightingTuner from './booth/LightingTuner';
import { getHandTrackerError, initializeHandLandmarker } from '../lib/handTracking';
import { fitStageBox, type StageBox } from '../lib/studio/stageLayout';
import ReportIssueButton from './support/ReportIssueButton';
import { getLatestBlendshapes, detectFaceNow, getHeadFitEstimate } from '../lib/faceRig';
import { detectHandsNow, getLatestHandFrame, resetHandRig } from '../lib/handRig';
import { GUEST_HAND_TRACKING, isHandAnchorId } from '../lib/handPose';
import { isHandOnlyLook } from '../lib/studio/sceneFamilies';
import {
  collectTriggers,
  createTriggerEngine,
  hasHandSource,
  isHandSource,
  mergeDetectionScores,
  revealTargetIdsOf,
  isLayerVisible,
  resolvePulseShader,
  pulseRestoreValue,
  shouldRunTriggers,
  type AnimatePreset,
  type TriggerConfig,
  type TriggerEvent,
} from '../lib/studio/triggers';
import { makeBeamSpec } from '../lib/studio/beam';
import { emitFx } from '../lib/studio/fxBus';
import { submitPostDetailed, getStudioSettings } from '../lib/db';
import { DEFAULT_STUDIO_SETTINGS, HEAD_SCALE_MIN, HEAD_SCALE_MAX, type StudioSettings } from '../lib/studio/occluder';
import {
  savePhoto, addCompletedChallenge, getCompletedChallenges, setGuestName, getGuestName, hasSkippedGuestName, skipGuestName,
  getGuestInitials, setGuestInitials,
  getCoverNames, setCoverNames, hasAskedCoverNames, markCoverNamesAsked,
} from '../lib/session';
import {
  COVER_MAX_GUESTS, coverExperiences, coverTemplateOfId, coverWantsGuestNames, joinNames, normalizeCovers, normalizeNames, resolveCover,
} from '../lib/cover/spec';
import { useCoverArt } from './booth/useCoverArt';
import CoverNamesSheet from './booth/CoverNamesSheet';
import { MAX_INITIALS, initialsFrom, normalizeInitials } from '../lib/studio/assetTemplate';
import { normalizeGuestLettering } from '../lib/letteringFit';
import { StreamRecorder, buildRecordStream, liveAudioTrack, primeEncoderInfo, recordingSupported } from '../lib/recorder';
import { audioDelayForPicture, audioSyncDefaultOn, createAudioSync, parseAvSyncUrl, type AudioSync } from '../lib/audioSync';
import { boothPictureClock, smoothedPictureAgeMs } from '../lib/pictureClock';
import { acquireMicTrack } from '../lib/camera';
import { useEntitlements } from '../lib/entitlements';
import { videoBitsPerSecondFor } from '../lib/plans';
import { dataUrlToBlob } from './booth/capture';
import { challengeNeedsCheck, validateChallengePhoto } from '../lib/challengeValidation';
import { reportError } from '../lib/errorReport';
import { fileToImagePart } from '../lib/imageInput';
import RevealShimmer from './booth/RevealShimmer';
import { REVEAL_SHIMMER_MS } from '../lib/studio/reveal';
import { introFieldsOf } from '../lib/studio/animation';
import { gestureCoachFor } from '../lib/gestureCoach';
import GestureCoach, { GestureCoachChip } from './booth/GestureCoach';
import { setThumbSource } from './booth/filterThumbEngine';
import { assetUrlsOf, glbPreloadQueue, isPending, layersWantGuestInitials, layersWantGuestName, selectionSignature, withLoaded } from '../lib/boothAssets';
import { isModelCached, preloadModel } from '../lib/glbCache';
import {
  detectSwipe, isDoubleTap, cycleIndex, isCrampedLandscape, type PointerSample,
} from '../lib/boothGestures';
import { playCue, primeAudio } from '../lib/boothAudio';
import {
  composeStrip, stripComplete, stripProgressLabel,
  STRIP_GAP_MS, STRIP_LEAD_SEC, DEFAULT_STRIP_FORMAT, stripFormat, type StripFormatId,
} from '../lib/photoStrip';
import StripPicker from './booth/StripPicker';
import { ShutterFace } from './ui/BrandShutter';
import type { Transform2D, Experience, ExperienceLayer, AnchorConfig, Challenge } from '../types';
import { layerToPiece } from '../lib/studio/draftMapping';
import { applyGuestColor, guestColorSlot } from '../lib/guestPalette';
import { effectiveOpeningLookId } from '../lib/openingLook';
import { isPlatformBooth, useViewportLock } from '../lib/boothViewport';
import { resolveBoothFpsCap } from '../lib/frameBudget';

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
/** Idle prop preload: wait this long after the booth settles, then pause this
 *  long between models so parsing never stacks up on the main thread. */
const PRELOAD_START_MS = 2_500;
const PRELOAD_GAP_MS = 600;
/** World mode, mid-clip: why a tap that would change page did nothing yet. */
const WORLD_REC_HINT_LEAVE = 'Stop recording to switch to a selfie Look';
const WORLD_REC_HINT_ENTER = 'Stop recording to stand a Frame up in the room';
const WORLD_REC_HINT_REMOVE = 'Stop recording to take the Frame away';
const WORLD_REC_HINT_SKY = 'Stop recording to change the sky';

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

/** Anchor for the powerFx-only Overlay3D mount (no 3D attach selected): the
 *  rig itself renders nothing — BeamFX's own FaceRig carries the beam. */
/** CSS container query units (cqw/cqh) — absent on older engines (Safari < 16, Chrome < 105). */
const HAS_CONTAINER_UNITS = (() => {
  try {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('height', '1cqh');
  } catch {
    return false;
  }
})();

const POWERFX_ONLY_ANCHOR: AnchorConfig = {
  anchor: 'noseBridge',
  offset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1,
};

export default function Booth() {
  const { id: routeExperienceId } = useParams<{ id?: string }>();
  const { eventId, config: eventConfig, basePath, source } = useEvent();
  const entitlements = useEntitlements();
  // Platform booths hold the phone's real visible viewport: no page scroll,
  // no pinch or double-tap zoom, 16px fields (src/lib/boothViewport.ts).
  // Legacy builds/events keep the document exactly as shipped.
  const platformBooth = isPlatformBooth(source);
  useViewportLock(platformBooth, true);

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

  // Face tracking readiness — tracked, not fire-and-forget: the "Center your
  // face" hint below must not coach a guest toward a tracker that never loaded.
  // Read live from the face-engine manager, so it also goes false while a
  // filter switch loads a different engine and true again after an automatic
  // 8th Wall → MediaPipe fallback. The init itself runs below, after the
  // selected filter's mode is known.
  const faceEngineInfo = useSyncExternalStore(subscribeFaceEngine, getActiveFaceEngineInfo, getActiveFaceEngineInfo);
  const trackerReady = faceEngineInfo.ready;
  const trackerFailed = faceEngineInfo.failed;

  // ── Onboarding ────────────────────────────────────────────────────────
  const { showOnboarding, dismiss: dismissOnboarding } = useOnboarding();
  // Platform events replace the five-slide intro with ONE dismissible line
  // over the live camera (cameraHint below); legacy keeps the intro as shipped.
  const [onboardingVisible, setOnboardingVisible] = useState(source === 'db' ? false : showOnboarding);
  const [cameraHint, setCameraHint] = useState(() => source === 'db' && !cameraHintSeen(safeLocalStorage()));
  const dismissCameraHint = useCallback(() => {
    setCameraHint(false);
    markCameraHintSeen(safeLocalStorage());
  }, []);

  // Challenge-awareness for the onboarding's optional last step. Fetched only
  // while the (once-per-device) onboarding is actually on screen, so no build
  // gains a network call it didn't have on every booth mount.
  const challenges = useStore((s) => s.challenges);
  const challengesLoaded = useStore((s) => s.challengesLoaded);
  const fetchChallenges = useStore((s) => s.fetchChallenges);
  useEffect(() => {
    if (onboardingVisible && !challengesLoaded) void fetchChallenges(true);
  }, [onboardingVisible, challengesLoaded, fetchChallenges]);

  // ── Camera ────────────────────────────────────────────────────────────
  // A platform guest who tapped the welcome page's booth CTA already saw the
  // camera line there, so the "Step inside" splash is skipped and the camera
  // starts on mount. That is the same start path the splash's tap uses: the
  // stream is requested from useCameraStream's effect, never synchronously in
  // a tap handler, so no browser gesture requirement changes. Opening /booth
  // directly (and every legacy event) still gets the splash.
  const location = useLocation();
  // ── World mode (AR) ───────────────────────────────────────────────────
  // A "3D" Props tile opens this same booth as its own page load,
  // `?ar=<frameId>` (lib/world/arSession.ts): 8th Wall's world engine and its
  // face engine both define window.XR8, so they can never share a page. On
  // that page the face engine never starts, 8th Wall owns the back camera and
  // its floor tracking stands the Frame up in the room (WorldStage). Leaving
  // is a page load back. PLATFORM booths only; legacy events never get here.
  const arFrameId = source === 'db' ? arFrameIdFrom(location.search) : null;
  const [arTracker, setArTracker] = useState<'xr8' | 'sensors'>(() => {
    const ua = typeof navigator !== 'undefined' ? navigator : null;
    const phone = ua ? isPhoneUa(ua.userAgent, ua.platform, ua.maxTouchPoints ?? 0) : false;
    const pick = worldTrackerFrom(location.search, import.meta.env.VITE_WORLD_TRACKER as string | undefined);
    // Computers get the motion-sensor fallback (the binary throws there).
    return pick === 'xr8' && !phone && !new URLSearchParams(location.search).has('desktop') ? 'sensors' : pick;
  });
  const worldCamH = useMemo(() => {
    const v = Number(new URLSearchParams(location.search).get('camh'));
    return Number.isFinite(v) && v >= 0.8 && v <= 2.2 ? v : 1.4;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Sky effects (lib/world/skyFx.ts) run on this same AR page: `&sky=<id>`,
  // with a standing Frame or on their own (`?ar=sky`). 8th Wall's sky layer
  // can only be started WITH the run, so whether this page load has it is
  // decided here, from the URL.
  const arSkyId = useMemo(
    () => (arFrameId !== null ? skyIdFrom(location.search) : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [arFrameId],
  );
  const worldSession = useMemo(
    () => (arFrameId !== null && arTracker === 'xr8' && typeof document !== 'undefined'
      ? new WorldSession(worldCamH, undefined, { skyLayer: arSkyId !== null })
      : null),
    [arFrameId, arTracker, worldCamH, arSkyId],
  );
  /** Sky effects show as tiles: platform booths on phones, where 8th Wall's world engine runs. */
  const skyTiles = useMemo(() => {
    if (source !== 'db' || typeof navigator === 'undefined') return false;
    const phone = isPhoneUa(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0)
      || new URLSearchParams(location.search).has('desktop');
    return phone && arTracker === 'xr8';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, arTracker]);
  const [arTapped, setArTapped] = useState(false);
  const arHostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!worldSession) return;
    let alive = true;
    worldSession.load().catch((e) => {
      console.warn('[Booth] world engine failed to load; using motion sensors', e);
      if (alive) setArTracker('sensors');
    });
    return () => { alive = false; worldSession.stop(); };
  }, [worldSession]);
  const worldCamera = useMemo<CameraSourceOverride | null>(() => {
    if (!worldSession) return null;
    return {
      key: 'xr8-world',
      facing: 'environment',
      acquire: () => {
        const host = arHostRef.current;
        if (!host) return Promise.reject(new Error('world host missing'));
        return worldSession.start(host).catch((e: unknown) => {
          // 8th Wall could not run on this phone: our own tracking takes over.
          console.warn('[Booth] world tracking failed; using motion sensors', e);
          setArTracker('sensors');
          throw e;
        });
      },
      release: () => worldSession.stop(),
    };
  }, [worldSession]);
  /**
   * Full page loads: the two 8th Wall engines never share a page. A short
   * "Switching to AR mode" screen covers the reload on both sides: this page
   * shows it and leaves a note, index.html repaints it from the note before
   * any JS runs, and the arriving booth keeps it up until it is ready.
   */
  const switchAccent = eventConfig.accentHexes?.[0] ?? '#d4af37';
  const [switching, setSwitching] = useState<ArSwitchDir | null>(null);
  const goTo = useCallback((url: string) => {
    const dir = arSwitchDirFor(url);
    try { sessionStorage.setItem(AR_SWITCH_KEY, arSwitchNote(dir, switchAccent, Date.now())); } catch { /* private mode */ }
    setSwitching(dir);
    // Let the screen paint before the page goes.
    window.setTimeout(() => window.location.assign(url), 180);
  }, [switchAccent]);
  const [arrival, setArrival] = useState<{ dir: ArSwitchDir; accent: string } | null>(() => {
    if (source !== 'db' || typeof window === 'undefined') return null;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(AR_SWITCH_KEY); sessionStorage.removeItem(AR_SWITCH_KEY); } catch { /* private mode */ }
    return readArSwitchNote(raw, Date.now());
  });
  const arrivalSinceRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0);
  // React's copy is up: drop the plain one index.html painted.
  useEffect(() => { document.getElementById('ar-switch-boot')?.remove(); }, []);
  // Back-button return from the bfcache: this page never left, so lift its screen.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setSwitching(null); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const [started, setStarted] = useState(() =>
    skipBoothSplash(source === 'db', location.state)
    || arFrameId !== null
    || (source === 'db' && new URLSearchParams(location.search).get(CAMERA_ON_PARAM) === '1'));
  // `?mode=video` opens a platform booth straight in Video mode (tester and
  // preview links; the entitlement effect below still snaps it back to photo
  // when the plan has no video). Legacy builds ignore it.
  const [mediaMode, setMediaMode] = useState<MediaMode>(() =>
    source === 'db' && new URLSearchParams(location.search).get('mode') === 'video' ? 'video' : 'photo');

  // Video capture is entitlement-gated. If the flag resolves after the guest
  // already toggled, snap back to photo mode.
  const videoAllowed = entitlements.videoEnabled;
  // Clip length is per plan (30 / 60 / 90 s; legacy sites stay at 30). The
  // server derives its byte ceiling from the same value (submit-post).
  const VIDEO_MAX_MS = entitlements.videoMaxSec * 1000;
  useEffect(() => {
    if (!videoAllowed && mediaMode === 'video') setMediaMode('photo');
  }, [videoAllowed, mediaMode]);

  // When the camera heals itself (muted after a tab switch, taken by another
  // app, frozen), log it, so the next "my camera went dark" has a when, a who
  // and a device in client_errors. Platform only: legacy sites log nothing new.
  const onCameraIncident = useCallback((i: CameraIncident) => {
    if (source !== 'db') return;
    reportError(new Error(`camera_${i.kind}_${i.reason}`), {
      attempt: i.attempt,
      eventSlug: eventId,
      visibility: typeof document !== 'undefined' ? document.visibilityState : null,
    });
  }, [source, eventId]);

  // Audio is only needed in video mode: the microphone joins the running
  // camera stream then (no camera restart), and `micTrack` says when it is on.
  const {
    videoRef, stream, micTrack, ready, error, retry,
    facingMode, flipCamera, canFlip,
  // Platform booths with video ask for camera AND microphone in one prompt at
  // entry (Dapo, Nov 24 2026), so switching to video never asks again.
  } = useCameraStream(
    // World mode on 8th Wall: the camera opens from the Start placing tap.
    started && (worldSession === null || arTapped),
    mediaMode === 'video',
    source === 'db' && entitlements.videoEnabled,
    { initialFacing: arFrameId !== null ? 'environment' : 'user', source: worldCamera, onIncident: onCameraIncident },
  );
  /**
   * The live picture stays mounted while the camera re-opens (platform), so
   * the guest sees the last frame for a moment instead of a dark stage
   * (StageCanvas holds its last frame while the video has none).
   */
  const [hadPicture, setHadPicture] = useState(false);
  useEffect(() => { if (ready) setHadPicture(true); }, [ready]);
  const stageMounted = ready || (source === 'db' && hadPicture && error === null);
  /** The camera is (or should be) opening: false while world mode waits for its tap. */
  const cameraWanted = started && (worldSession === null || arTapped);

  const feedContainerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageCanvasHandle>(null);

  // Wire stream → video element
  useLayoutEffect(() => {
    streamRef.current = stream;
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, videoRef]);

  // ── Lip-sync for clips (lib/audioSync.ts) ─────────────────────────────
  // A clip's picture is the camera's frame after the camera's delay and, on 3D
  // looks, the tracker's; its sound is live. So the recorded microphone runs
  // through a delay that follows the measured age of the picture
  // (lib/pictureClock.ts). Platform booths only; `?avsync=0` records the raw
  // microphone, `?avtrim=±ms` nudges the delay for a phone test.
  const avSync = useMemo(() => {
    const url = typeof window !== 'undefined' ? parseAvSyncUrl(window.location.search) : { enabled: null, trimMs: 0 };
    const byDefault = typeof navigator !== 'undefined' && audioSyncDefaultOn(navigator.userAgent, navigator.maxTouchPoints ?? 0);
    return { on: source === 'db' && (url.enabled ?? byDefault), trimMs: url.trimMs };
  }, [source]);
  const audioSyncRef = useRef<AudioSync | null>(null);
  const recordingNowRef = useRef(false);
  useEffect(() => {
    if (!avSync.on || mediaMode !== 'video' || !stream) return;
    const mic = liveAudioTrack(stream.getAudioTracks());
    if (!mic) return; // no microphone yet: this clip records whatever the record tap opens, undelayed
    const wanted = () => {
      const age = smoothedPictureAgeMs(boothPictureClock, performance.now());
      return age === null ? null : audioDelayForPicture(age, avSync.trimMs);
    };
    const sync = createAudioSync(mic, wanted() ?? 0);
    if (!sync) return;
    audioSyncRef.current = sync;
    // Browsers start an AudioContext only after a tap: any tap in video mode
    // wakes it, so it is running long before the record button is pressed.
    const wake = () => sync.resume();
    window.addEventListener('pointerdown', wake, { passive: true });
    const id = window.setInterval(() => {
      const w = wanted();
      if (w !== null) sync.setTarget(w, recordingNowRef.current);
    }, 250);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pointerdown', wake);
      if (audioSyncRef.current === sync) audioSyncRef.current = null;
      sync.dispose();
    };
  }, [avSync, mediaMode, stream, micTrack]);
  // Ask once which video encoder this phone runs in hardware (lib/recorder.ts).
  useEffect(() => {
    if (source === 'db') void primeEncoderInfo(PREVIEW_W, PREVIEW_H);
  }, [source]);

  // ── Picker state ──────────────────────────────────────────────────────
  const [effectId, setEffectId] = useState<string>(() => (arSkyId !== null ? `${SKY_SHADER_PREFIX}${arSkyId}` : 'none'));
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
  /** The face-paint slot (platform only): worn alongside the prop in attachExp. */
  const [paintExp, setPaintExp] = useState<Experience | null>(null);
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
  /** Which strip the guest armed in StripPicker (2, 3 or 4 stacked, or 2x2). */
  const [stripFormatId, setStripFormatId] = useState<StripFormatId>(DEFAULT_STRIP_FORMAT);
  const stripCount = stripFormat(stripFormatId).shots;
  const [stripPickerOpen, setStripPickerOpen] = useState(false);
  /** `capturePhoto` is a plain function reached through MEMOIZED callbacks
   *  (handleCountdownComplete memoizes on [mediaMode]), so reading `stripMode`
   *  from the render closure served a stale `false` and the strip captured one
   *  panel then jumped to review. A ref is read at call time, so no memoized
   *  caller can serve an out-of-date value. */
  const stripModeRef = useRef(stripMode);
  useEffect(() => { stripModeRef.current = stripMode; }, [stripMode]);
  /** Same call-time-read reasoning: `advanceStrip` runs from `capturePhoto`. */
  const stripFormatRef = useRef<StripFormatId>(stripFormatId);
  useEffect(() => { stripFormatRef.current = stripFormatId; }, [stripFormatId]);
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

  // Platform: a challenge tapped on /challenges arrives as router state and is
  // preselected here, so the guest lands in the camera already on that mission
  // instead of hunting for the pill again. Applied once, after the challenge
  // list has loaded; only a live, unfinished challenge of THIS event counts.
  const routerChallengeAppliedRef = useRef(false);
  const routerChallengeId = source === 'db'
    && typeof location.state === 'object' && location.state !== null
    ? (location.state as { challengeId?: unknown }).challengeId
    : undefined;
  useEffect(() => {
    if (typeof routerChallengeId === 'string' && !challengesLoaded) void fetchChallenges(true);
  }, [routerChallengeId, challengesLoaded, fetchChallenges]);
  useEffect(() => {
    if (routerChallengeAppliedRef.current || !challengesLoaded) return;
    if (typeof routerChallengeId !== 'string') return;
    routerChallengeAppliedRef.current = true;
    const pick = challengeFromRouterState(
      source === 'db', location.state, challenges, getCompletedChallenges(eventId), wallSettings.showChallenges !== false,
    );
    if (pick) setSelectedChallenge(pick);
  }, [routerChallengeId, challengesLoaded, challenges, eventId, source, location.state, wallSettings.showChallenges]);

  // What the "Sent!" screen celebrates and links to (platform). Set by
  // doSubmit, read only by SendOff.
  const [sentPostId, setSentPostId] = useState<string | null>(null);
  const [sentChallenge, setSentChallenge] = useState<Challenge | null>(null);

  // ── Phase & capture ───────────────────────────────────────────────────
  const [phase, setPhase] = useState<BoothPhase>('camera');
  // Observe-only telemetry (camera lost/regained/flapping/stuck, tracker,
  // look switches): never touches the camera. Platform booths only.
  useBoothTelemetry({
    enabled: source === 'db', videoRef, stream, ready, errorKind: error, facingMode,
    live: phase === 'camera' && cameraWanted, mediaMode,
    looks: {
      frame: frameExp?.id ?? null, prop: attachExp?.id ?? null,
      paint: paintExp?.id ?? null, effect: effectId === 'none' ? null : effectId,
    },
  });
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
  /** True while startRecording waits for a fresh microphone (see there). */
  const micCheckPendingRef = useRef(false);
  const [recording, setRecording] = useState(false);
  recordingNowRef.current = recording;
  /**
   * This clip keeps frame-lock (props drawn on the exact frame they were
   * measured on). True when its sound runs through the lip-sync delay, which
   * lines the sound up with the locked picture. Without that delay the clip
   * shows the live camera instead, so lips and words stay close.
   * `?reclock=0|1` forces it either way for a phone A/B.
   */
  const [clipLocked, setClipLocked] = useState(false);
  // While a clip records, a fall-back to the live camera lasts until it ends:
  // the picture changes source at most once per clip (frameLockGuard.holdLive).
  useEffect(() => {
    if (source !== 'db') return;
    setFrameLockRecording(recording);
    return () => setFrameLockRecording(false);
  }, [recording, source]);
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

  // ── Magazine covers ───────────────────────────────────────────────────
  // Opt-in per event (arContent.covers, set in the host's Looks step). Each
  // cover is a Frame whose art is drawn here, with the names of the guests
  // in the shot (asked when they pick one). PLATFORM only: legacy coded
  // events never read the key.
  const coverSettings = useMemo(
    () => (source === 'db' ? normalizeCovers(eventConfig.arContent.covers) : []),
    [source, eventConfig],
  );
  const [coverNamesTick, setCoverNamesTick] = useState(0);
  const coverNames = useMemo(() => {
    void coverNamesTick;
    return normalizeNames(getCoverNames(eventId), COVER_MAX_GUESTS);
  }, [eventId, coverNamesTick]);
  const coverArt = useCoverArt(coverSettings, eventConfig.copy.eventName, coverNames);

  // ── Build catalog ─────────────────────────────────────────────────────
  const catalog = useMemo(() => {
    const all = buildCatalog(eventConfig.arContent, experiencesLoaded ? experiences : [], presetOverrides, experiencesLoaded ? linkedGlobals : [], source === 'db');
    // The host turned these on, so they lead the Frames.
    const covers = coverExperiences(coverSettings, coverArt);
    // A look that is ONLY hand-held gear shows nothing without hand tracking,
    // which guest booths don't run (GUEST_HAND_TRACKING): leave it out.
    // Sky effects: AR tiles in the Effects tab (hosts can hide them like any built-in).
    const sky = skyTiles ? skyExperiences(presetOverrides?.hidden, eventConfig.theme?.pack ?? null) : [];
    return [...covers, ...(GUEST_HAND_TRACKING || source !== 'db' ? all : all.filter((e) => !isHandOnlyLook(e))), ...sky];
  }, [eventConfig, experiences, linkedGlobals, experiencesLoaded, presetOverrides, source, coverSettings, coverArt, skyTiles]);

  // Pre-select from route param
  useEffect(() => {
    if (!routeExperienceId || !experiencesLoaded) return;
    const exp = catalog.find((e) => e.id === routeExperienceId);
    if (exp) {
      if (exp.kind === 'shader' && isSkyShaderId(exp.config?.shader?.shaderId)) {
        // A link to a sky effect opens the AR page it lives on.
        selectEffect(exp.config!.shader!.shaderId, exp);
      } else if (exp.kind === 'shader') {
        setEffectId(exp.config?.shader?.shaderId ?? 'none');
        setEffectExp(exp);
      } else if (exp.kind === 'border' || exp.kind === '2d_filter') {
        setFrameExp(exp);
        setOverlayTransform(exp.config?.transform ?? DEFAULT_TRANSFORM);
        if (exp.config?.ambientShader?.shaderId) setEffectId(exp.config.ambientShader.shaderId);
      } else if (exp.kind === '3d_attachment') {
        if (source === 'db' && isPaintLook(exp)) setPaintExp(exp); else setAttachExp(exp);
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
    // World mode opens on its own 3D Frame only: no default Frame on top, so
    // the deck opens on Props with that tile lit.
    if (routeExperienceId || arFrameId !== null) { appliedDefaultRef.current = true; return; }
    if (!experiencesLoaded) return;
    // The same resolver the host's Library / Settings read (openingLook.ts).
    const id = effectiveOpeningLookId(wallSettings.defaultExperienceId, eventConfig.defaultExperienceId);
    if (!id) return;
    const exp = catalog.find((e) => e.id === id);
    if (!exp) return;
    // A sky effect cannot be the opening look: it would send every guest to the back camera.
    if (exp.kind === 'shader' && isSkyShaderId(exp.config?.shader?.shaderId)) { appliedDefaultRef.current = true; return; }
    if (exp.kind === 'shader') {
      setEffectId(exp.config?.shader?.shaderId ?? 'none');
      setEffectExp(exp);
    } else if (exp.kind === 'border' || exp.kind === '2d_filter') {
      setFrameExp(exp);
      setOverlayTransform(exp.config?.transform ?? DEFAULT_TRANSFORM);
      if (exp.config?.ambientShader?.shaderId) setEffectId(exp.config.ambientShader.shaderId);
    } else if (exp.kind === '3d_attachment') {
      if (source === 'db' && isPaintLook(exp)) setPaintExp(exp); else setAttachExp(exp);
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
    // In world mode a 2D Frame (drawn on the selfie view, not in the room)
    // leaves it: back to the normal booth with that Frame on.
    if (arFrameId !== null) {
      if (exp !== null && recording) { showBoothHint(WORLD_REC_HINT_LEAVE); return; }
      if (exp !== null) goTo(leaveArUrl(basePath, location.search, exp.id));
      return;
    }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameExp, attachExp, arFrameId, recording, basePath, goTo, showBoothHint]);

  /**
   * Picking a Prop. A "3D" standing Frame opens world mode (its own page
   * load); in world mode another 3D tile swaps the board in place and any
   * other Prop, or none, goes back to the normal booth. Outside world mode
   * every other Prop is exactly setAttachExp, as before.
   */
  const handleSelectAttachment = useCallback((exp: Experience | null) => {
    // While a clip records, standing Frames swap in place (same camera, same
    // page). Anything that would change page (into or out of world mode)
    // waits for the clip, and says so instead of silently doing nothing.
    if (recording && arFrameId === null && isWorldLook(exp)) { showBoothHint(WORLD_REC_HINT_ENTER); return; }
    if (recording && arFrameId !== null && !isWorldLook(exp)) {
      showBoothHint(exp === null ? WORLD_REC_HINT_REMOVE : WORLD_REC_HINT_LEAVE);
      return;
    }
    if (arFrameId !== null) {
      if (isWorldLook(exp)) {
        setAttachExp(exp);
        const id = exp!.id.slice(WORLD_LOOK_PREFIX.length);
        const p = new URLSearchParams(location.search);
        p.set('ar', id);
        window.history.replaceState(window.history.state, '', `${location.pathname}?${p.toString()}`);
      } else if (exp === null && isSkyShaderId(effectId)) {
        // Taking the Frame away under a sky effect leaves the sky on its own.
        setAttachExp(null);
        const p = new URLSearchParams(window.location.search);
        p.set('ar', SKY_ONLY_AR_ID);
        window.history.replaceState(window.history.state, '', `${location.pathname}?${p.toString()}`);
      } else {
        goTo(leaveArUrl(basePath, location.search, exp?.id ?? null));
      }
      return;
    }
    if (isWorldLook(exp)) {
      goTo(enterArUrl(basePath, location.search, exp!.id.slice(WORLD_LOOK_PREFIX.length)));
      return;
    }
    setAttachExp(exp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arFrameId, recording, basePath, goTo, effectId, showBoothHint]);

  /**
   * Picking an Effect. A sky effect (lib/world/skyFx.ts) lives on the AR page:
   * from the selfie booth it opens that page; on it, sky effects swap in
   * place. The first sky effect on an AR page that started without the sky
   * layer reloads the page with it (8th Wall cannot add the layer mid-run).
   * Every other Effect is exactly applyEffect, as before.
   */
  const selectEffect = useCallback((shaderId: string, exp: Experience | null = null) => {
    const sky = skyIdOfShader(shaderId);
    const wasSky = isSkyShaderId(effectId);
    if (arFrameId === null) {
      if (sky === null) { applyEffect(shaderId, exp); return; }
      if (recording) { showBoothHint(WORLD_REC_HINT_SKY); return; }
      const p = new URLSearchParams(location.search);
      p.set(SKY_PARAM, sky);
      goTo(enterArUrl(basePath, `?${p.toString()}`, SKY_ONLY_AR_ID));
      return;
    }
    if (sky === null && !wasSky) { applyEffect(shaderId, exp); return; }
    // The AR page, and the sky is changing.
    const standing = isWorldLook(attachExp);
    const arId = standing ? attachExp!.id.slice(WORLD_LOOK_PREFIX.length) : SKY_ONLY_AR_ID;
    const query = skyQuery(window.location.search, arId, sky);
    if (query === null) {
      // The sky was all this page showed: back to the selfie booth, with the new Effect if one was picked.
      if (recording) showBoothHint(WORLD_REC_HINT_SKY);
      else goTo(leaveArUrl(basePath, location.search, shaderId === 'none' ? null : exp?.id ?? null));
      return;
    }
    if (sky !== null && worldSession?.skyCapable !== true) {
      if (recording) showBoothHint(WORLD_REC_HINT_SKY);
      else goTo(`${basePath}/booth?${query}`);
      return;
    }
    applyEffect(shaderId, exp);
    window.history.replaceState(window.history.state, '', `${location.pathname}?${query}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arFrameId, effectId, attachExp, recording, basePath, goTo, applyEffect, worldSession, showBoothHint]);
  // The effect in the slot is what 8th Wall's canvas paints.
  useEffect(() => {
    if (!worldSession) return;
    const id = skyIdOfShader(effectId);
    if (id === null || !worldSession.skyCapable) { worldSession.setSky(null); return; }
    const [a, b] = skyPalette(eventConfig.accentHexes);
    worldSession.setSky({ id, a, b, text: skyWords(id, eventConfig.copy.fullName, eventConfig.copy.eventName) });
  }, [worldSession, effectId, eventConfig]);
  // 8th Wall could not run here (the booth fell back to its own motion
  // tracking, which has no sky layer): a sky effect has nothing to paint.
  useEffect(() => {
    if (arFrameId === null || arTracker !== 'sensors' || !isSkyShaderId(effectId)) return;
    if (arFrameId === SKY_ONLY_AR_ID) goTo(leaveArUrl(basePath, location.search, null));
    else applyEffect('none');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arFrameId, arTracker, effectId]);

  /**
   * Picking a face paint: its own slot, so the guest's prop stays on. In world
   * mode (no face on screen) a paint leaves for the selfie booth with it on,
   * the same way a 2D Frame does.
   */
  const handleSelectPaint = useCallback((exp: Experience | null) => {
    if (arFrameId !== null) {
      if (exp !== null && recording) { showBoothHint(WORLD_REC_HINT_LEAVE); return; }
      if (exp !== null) goTo(leaveArUrl(basePath, location.search, exp.id));
      return;
    }
    setPaintExp(exp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arFrameId, recording, basePath, goTo, showBoothHint]);

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

  /** A piece's GLB failed to load (FaceRig classified it — bad wifi, KTX2,
   *  404…). Say so instead of rendering nothing forever: clear the orb's
   *  pending ring (the download is over, just not with geometry), DISARM the
   *  reveal shimmer so the magic moment doesn't celebrate an empty frame, and
   *  hint that the rest of the booth still works. */
  const handleAssetError = useCallback((url: string, message: string) => {
    console.warn('[Booth] 3D asset failed to load', url, message);
    armedRevealRef.current = null;
    markAssetLoaded(url);
    showBoothHint('That prop didn’t load — frames and effects still work');
  }, [markAssetLoaded, showBoothHint]);

  // ── Props parsed ahead of the tap (platform only) ─────────────────────
  // warmAsset above only fills the HTTP cache, so every prop switch still
  // parsed its GLB (hundreds of ms on a phone) before anything could show.
  // Once the booth is idle — camera and tracker up, nothing loading, not
  // recording — parse the event's other props into the shared model cache one
  // at a time, with a pause between, capped by glbPreloadQueue. Legacy events
  // never run this.
  useEffect(() => {
    if (source !== 'db' || phase !== 'camera' || !ready || !trackerReady || recording || selectionPending) return;
    const queue = glbPreloadQueue(catalog, isModelCached);
    if (queue.length === 0) return;
    let alive = true;
    let timer = 0;
    const next = () => {
      const url = queue.shift();
      if (!alive || url === undefined) return;
      // preloadModel never rejects (a failed preload just retries on the tap).
      void preloadModel(url).then(() => {
        if (alive) timer = window.setTimeout(next, PRELOAD_GAP_MS);
      });
    };
    timer = window.setTimeout(next, PRELOAD_START_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [source, phase, ready, trackerReady, recording, selectionPending, catalog]);

  // ── Camera taking too long ────────────────────────────────────────────
  // "Starting camera…" used to be an unbounded spinner: some webviews neither
  // resolve nor reject getUserMedia, and the guest had no way out. After ~8 s
  // the wait stays honest and offers the same exits as the error screen.
  const [cameraSlow, setCameraSlow] = useState(false);
  useEffect(() => {
    if (!cameraWanted || error !== null || ready) {
      setCameraSlow(false);
      return;
    }
    const t = window.setTimeout(() => setCameraSlow(true), 8_000);
    return () => window.clearTimeout(t);
  }, [cameraWanted, error, ready]);
  /** `/e/<slug>` → slug; null on legacy builds (no support desk to route to —
   *  same gate as BoothTopBar). */
  const boothSlug = /^\/e\/([^/]+)/.exec(basePath)?.[1] ?? null;

  // ── Derived flags ─────────────────────────────────────────────────────
  const isFront = facingMode === 'user';
  // A cover Frame's art is redrawn when the names change, so it is read live
  // rather than from the (older) copy the selection holds.
  const frameCover = coverTemplateOfId(frameExp?.id);
  const frameArt = frameCover ? (coverArt[frameCover] ?? null) : (frameExp?.asset_url ?? null);
  // Composite carries its 2D content in config.layers (never the singular
  // asset_url field, which the legacy mirror may repurpose for either family) —
  // so a composite frame "lights up" 2D by actually having a 2D-kind layer.
  const is2DOverlay = frameExp !== null && (
    (!!frameArt && (frameExp.kind === 'border' || frameExp.kind === '2d_filter')) ||
    (frameExp.kind === 'composite' && !!frameExp.config?.layers?.some((l) => l.kind === 'border' || l.kind === '2d_filter'))
  );
  // The 3D canvas is led by the prop; with no prop, a face paint leads it
  // (the paint slot, platform only — paintExp is never set on legacy events).
  const pieceExp = attachExp ?? paintExp;
  const is3D = pieceExp !== null && (
    (pieceExp.kind === '3d_attachment' && (!!pieceExp.asset_url || !!pieceExp.config?.procedural)) ||
    (pieceExp.kind === 'composite' && !!pieceExp.config?.layers?.some((l) => l.kind === '3d_attachment'))
  );
  const anchorConfig: AnchorConfig | null =
    is3D && pieceExp?.config?.anchor ? (pieceExp.config.anchor as AnchorConfig) : null;

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
  /** A selected 3D piece engraves the guest's name (a cap's front label).
   *  db-only: legacy/code events never carry layers. */
  const propWantsName = source === 'db' && layersWantGuestName(attachExp?.config?.layers);
  /** The piece engraves INITIALS (a mask's crest) rather than the whole name.
   *  Stored apart from the name so "DW" never becomes the guest's wall name. */
  const propWantsInitials = source === 'db' && layersWantGuestInitials(attachExp?.config?.layers);
  const guestInitials = useMemo(() => {
    void guestNameTick;
    return normalizeInitials(getGuestInitials(eventId));
  }, [eventId, guestNameTick]);
  /** What the crest actually shows: typed initials, else the name's. */
  const crestInitials = guestInitials || initialsFrom(guestName);
  const needsGuestName =
    ((letteringSpec?.token === 'guestName' && !guestLetteringName)
      || (propWantsName && (propWantsInitials ? !crestInitials : !guestName.trim())))
    && !hasSkippedGuestName(eventId);
  const [askName, setAskName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  // Picking a name-wearing prop asks for the name right away, so the guest sees
  // it on the piece while framing instead of an empty front until they shoot.
  useEffect(() => {
    if (!propWantsName || !needsGuestName || phase !== 'camera') return;
    setNameDraft('');
    setAskName(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachExp?.id]);
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
  // Event-wide power-ups (setup wizard) ride after the filter's own triggers,
  // so a filter that already maps the same gesture keeps its own action
  // (collectTriggers dedupes by id; power-up ids are prefixed). Absent on
  // every event that never set them → the list below is unchanged.
  const eventPowerUps = eventConfig.powerUps;
  const triggers = useMemo<TriggerConfig[]>(
    () => (source !== 'db'
      ? []
      : collectTriggers([
        attachExp,
        frameExp,
        effectExp,
        paintExp,
        eventPowerUps ? { id: 'event:powerUps', config: { triggers: eventPowerUps } } : null,
      ])),
    [source, attachExp, frameExp, effectExp, paintExp, eventPowerUps],
  );
  const hasTriggers = triggers.length > 0;
  /**
   * The selected LOOK's own triggers, without the event-wide power-ups. Hand
   * tracking is gated on these (see needsHands): a wizard event with hand
   * power-ups switched on used to start the hand landmarker for EVERY look,
   * and that second blocking CPU model beside 8th Wall froze the frame-locked
   * feed on fast camera moves (phone test, Nov 2026). Event hand gestures now
   * ride along only on looks that already track a hand; face-gesture
   * power-ups (smile, open mouth) still work on every look.
   */
  // Drawing budget (lib/frameBudget.ts): platform booths composite + render 3D
  // at the camera's 30 fps instead of every screen refresh (`?fps=0` = old
  // behaviour, for a phone A/B). Coded/legacy surfaces keep their loops as shipped.
  const boothFpsCap = useMemo(
    () => (source === 'db' && typeof window !== 'undefined' ? resolveBoothFpsCap(window.location.search) : 0),
    [source],
  );
  const lookTriggers = useMemo<TriggerConfig[]>(
    () => (source !== 'db' ? [] : collectTriggers([attachExp, frameExp, effectExp, paintExp])),
    [source, attachExp, frameExp, effectExp, paintExp],
  );

  // ── Face-tracking engine (per filter) ─────────────────────────────────
  // The SELECTED filter picks the engine (config.tracking, validated), with
  // the same attach → frame → effect priority as activeTriggerExp. Coded
  // events (source !== 'db') count as legacy: always MediaPipe, byte-identical,
  // and they never download 8th Wall. Declared BEFORE the init effect so the
  // first engine started is already the right one.
  const trackingConfig = source !== 'db'
    ? undefined
    : [attachExp, frameExp, effectExp, paintExp]
      .map((e) => e?.config?.tracking)
      .find((t) => parseFaceTrackingMode(t) !== null);
  // Living Face Paint rides the 8th Wall face mesh, so a painted scene must
  // resolve to an 8th Wall mode (engineSelect's requiresFaceMesh rule).
  const hasFacePaint = source === 'db' && [attachExp, frameExp, effectExp, paintExp]
    .some((e) => e?.config?.layers?.some((l) => l.facePaint !== undefined && l.hidden !== true) === true);
  const faceMode = useMemo(
    () => resolveSurfaceFaceMode({ legacy: source !== 'db', config: trackingConfig, triggers, facePaint: hasFacePaint }).mode,
    [source, trackingConfig, triggers, hasFacePaint],
  );
  // `legacy` also keeps a coded event on the shipped detection input, pose
  // filter and live-<video> composite (no frame-lock) — byte-identical photos.
  // Never on the world-mode page: its 8th Wall world engine owns window.XR8.
  useEffect(() => {
    if (arFrameId === null) setFaceTrackingMode(faceMode, { legacy: source !== 'db' });
  }, [faceMode, source, arFrameId]);
  useEffect(() => {
    if (arFrameId !== null) return;
    initFaceEngine().catch((e) => console.warn('[Booth] face tracker init failed', e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A beam action anywhere in the scene mounts BeamFX inside the 3D canvas
  // (and the canvas itself for frame/filter-only scenes). db-only, like every
  // trigger feature — legacy events can never carry one.
  const powerFxActive = useMemo(
    () => source === 'db' && triggers.some((t) => t.action.type === 'beam'),
    [source, triggers],
  );
  // Layer ids that a reveal trigger hides until it fires; `revealedIds` is the
  // runtime set already fired. NEVER persisted — a fresh scene starts all hidden.
  const revealTargetIds = useMemo(() => revealTargetIdsOf(triggers), [triggers]);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => { setRevealedIds(new Set()); }, [activeTriggerExp]);
  // One-shot `animate` pulses per layer id — a Map write per FIRE (≤ once per
  // 2.5s cooldown), never per frame; AnimatedPiece decays each to identity.
  const [pulseMap, setPulseMap] = useState<ReadonlyMap<string, { preset: AnimatePreset; at: number }>>(new Map());
  useEffect(() => { setPulseMap(new Map()); }, [activeTriggerExp]);
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
        // Animated Frames: entrance + pivot, validated (absent ⇒ no keys).
        ...introFieldsOf(l),
      }));
  }, [frameLayers, layerVisible]);
  // Replay: restarts every entrance of the current Frame (a new Frame restarts
  // them by itself). Shown only when the Frame actually has an entrance.
  const frameHasIntro = useMemo(
    () => source === 'db' && (frameLayers ?? []).some((l) => introFieldsOf(l).intro !== undefined),
    [source, frameLayers],
  );
  const [introRun, setIntroRun] = useState(0);
  const introKey = `${frameExp?.id ?? ''}:${introRun}`;

  // ── World mode ────────────────────────────────────────────────────────
  // PLATFORM booths only: each Frame also appears in Props as a "3D" tile
  // (lib/world/worldLooks). Picking one opens the world-mode page (arFrameId,
  // above), which stands the Frame up in the room (WorldStage); picking any
  // other look goes back to the normal booth. Legacy events never get tiles.
  const worldSelected = arFrameId !== null && isWorldLook(attachExp);
  const worldFrameUrl: string | null = worldSelected ? worldLookFrameUrl(attachExp) : null;
  const worldMode = worldFrameUrl !== null;
  /** A sky effect is on, on the AR page (with or without a standing Frame). */
  const skyOn = arFrameId !== null && worldSession !== null && isSkyShaderId(effectId);
  /** The stage shows 8th Wall's own canvas: a Frame stands in it, or the sky is painted in it. */
  const arStage = worldMode || skyOn;

  // World mode: work out the event's other standing Frames ahead, one at a
  // time while the guest is not recording, so swapping Frames mid-clip only
  // uploads a texture (no pixel read, no outline trace = no stutter).
  useEffect(() => {
    if (!worldMode || recording || phase !== 'camera') return;
    const queue = withWorldLooks(catalog)
      .map((e) => worldLookFrameUrl(e))
      .filter((u): u is string => u !== null && u !== worldFrameUrl);
    if (queue.length === 0) return;
    let alive = true;
    let timer = 0;
    const next = () => {
      const url = queue.shift();
      if (!alive || url === undefined) return;
      void preloadWorldBoard(url).then(() => {
        if (alive) timer = window.setTimeout(next, PRELOAD_GAP_MS);
      });
    };
    timer = window.setTimeout(next, PRELOAD_START_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [worldMode, worldFrameUrl, recording, phase, catalog]);

  // The cover in use (a selfie Frame or its standing 3D tile), and the cover
  // that stands up in world mode, printed with this group's names.
  const activeCover = useMemo(() => {
    const t = worldSelected ? coverTemplateOfId(attachExp?.id) : frameCover;
    return t ? coverSettings.find((c) => c.template === t) ?? null : null;
  }, [worldSelected, attachExp, frameCover, coverSettings]);
  const worldCover = useMemo(
    () => (worldSelected && activeCover ? resolveCover(activeCover, eventConfig.copy.eventName, coverNames) : null),
    [worldSelected, activeCover, eventConfig, coverNames],
  );
  const coverWantsNames = coverWantsGuestNames(activeCover);
  const [askCoverNames, setAskCoverNames] = useState(false);
  // Picking a cover asks once for the names to print (Skip is remembered; the
  // chip below changes them any time).
  useEffect(() => {
    // Only once the guest can see the cover (camera live, past the splash).
    if (!coverWantsNames || phase !== 'camera' || !ready || hasAskedCoverNames(eventId)) return;
    setAskCoverNames(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCover?.template, coverWantsNames, ready]);
  // The switch screen lifts once this booth can show something real: the AR
  // intro (its frame picked) or the live selfie camera. Never under 0.45 s (no
  // flicker), never over 4.5 s (a slow camera has its own screen).
  const arrivalReady = arrival !== null && (arrival.dir === 'enter' ? arStage : ready);
  useEffect(() => {
    if (arrival === null) return;
    const since = performance.now() - arrivalSinceRef.current;
    const wait = arrivalReady ? Math.max(0, 450 - since) : Math.max(0, 4500 - since);
    const t = window.setTimeout(() => setArrival(null), wait);
    return () => window.clearTimeout(t);
  }, [arrival, arrivalReady]);
  // The world-mode page opens on its frame's 3D tile once the catalog is in.
  const arAppliedRef = useRef(false);
  useEffect(() => {
    if (arFrameId === null || arAppliedRef.current || !experiencesLoaded) return;
    // A cover's tile exists once its art is drawn (a moment after load).
    const arCover = coverTemplateOfId(arFrameId);
    if (arCover && coverSettings.some((c) => c.template === arCover) && !coverArt[arCover]) return;
    const tile = withWorldLooks(catalog).find((e) => e.id === `${WORLD_LOOK_PREFIX}${arFrameId}`);
    arAppliedRef.current = true;
    if (tile) setAttachExp(tile);
    else if (arFrameId === SKY_ONLY_AR_ID && arSkyId !== null) { /* the sky on its own: nothing to stand up */ }
    else goTo(leaveArUrl(basePath, location.search, null)); // unknown frame: plain booth
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arFrameId, experiencesLoaded, catalog, coverArt]);
  // XR8's intrinsics describe its canvas, which the stage cover-fits: keep the
  // two the same shape.
  useEffect(() => {
    const el = feedContainerRef.current;
    if (!worldSession || !el) return;
    const fit = () => worldSession.sizeTo(el.clientWidth, el.clientHeight);
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [worldSession]);
  const leaveWorld = useCallback(() => {
    if (!recording) goTo(leaveArUrl(basePath, location.search, null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, basePath, goTo]);
  /** The tracked camera picture, drawn by the stage instead of the live video. */
  const worldFrameSource = useCallback(() => worldSession?.frame() ?? null, [worldSession]);
  /** The flip button (and double-tap): in world mode it means "back to the selfie camera". */
  const flipOrLeave = useCallback(() => {
    if (arFrameId !== null) leaveWorld(); else flipCamera();
  }, [arFrameId, leaveWorld, flipCamera]);

  // The prop's layers plus the paint slot's (same reference as before when no
  // paint is on, so every memo below is unchanged for a prop-only booth).
  const rawAttachLayers = useMemo(
    () => mergePaintLayers(attachExp, source === 'db' ? paintExp : null),
    [attachExp, paintExp, source],
  );
  // ── Guest lens colour ─────────────────────────────────────────────────
  // Session-only: a swatch pick recolours the template's guest-pickable region
  // through the ordinary customization path (so the lens AND an 'auto' beam
  // follow in one move) and resets whenever the selection changes. db-only by
  // construction — legacy/code events never carry layers or templates.
  const [guestHex, setGuestHex] = useState<string | null>(null);
  const colorSlot = useMemo(
    () => (source === 'db' ? guestColorSlot(rawAttachLayers) : null),
    [source, rawAttachLayers],
  );
  useEffect(() => { setGuestHex(null); }, [attachExp?.id]);
  // Same array reference whenever no pick is active (applyGuestColor's
  // contract), so every existing memo below is churn-free by default.
  const attachLayers = useMemo(
    () => applyGuestColor(rawAttachLayers, colorSlot, guestHex),
    [rawAttachLayers, colorSlot, guestHex],
  );
  const overlayPieces: Overlay3DPiece[] | undefined = useMemo(() => {
    if (!attachLayers || attachLayers.length === 0) return undefined;
    return attachLayers
      // Same layerVisible rule as the 2D builder above (eye toggle, except
      // reveal targets which are gated only by their trigger firing).
      .filter((l) => l.kind === '3d_attachment' && !!l.anchor && layerVisible(l))
      // Hand-held gear needs the hand tracker, which guest booths don't run
      // (GUEST_HAND_TRACKING). Drawn without it, its HandRig would start the
      // tracker itself, so it is left out instead.
      .filter((l) => GUEST_HAND_TRACKING || !isHandAnchorId(l.handAnchor))
      // ONE mapper, shared with StudioPreview and Studio3DView (draftMapping):
      // animation, occlusion, finish/tint and customization were hand-written
      // three times and nothing compared them. The source==='db' gates stay
      // EXPLICIT here — legacy/code events never carry layers, and that
      // invariant is worth stating rather than inferring.
      .map((l) => {
        const piece = layerToPiece(l, {
          guestName,
          guestInitials,
          occlusionEnabled: source === 'db',
          customizationEnabled: source === 'db',
        });
        // One-shot `animate` trigger pulse for this layer, if one fired.
        const pulse = pulseMap.get(l.id);
        return pulse !== undefined ? { ...piece, pulse } : piece;
      });
  }, [attachLayers, source, layerVisible, guestName, guestInitials, pulseMap]);

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
    } else if (a.type === 'beam') {
      // Emitter: the named layer, else the scene's first VISIBLE 3D piece —
      // its template + customization resolve `color:'auto'` (the guest's lens
      // hex travels on the piece via the shared mapper), and its fxKey routes
      // the bolt to the piece's registered emitter point (lens front / wand
      // tip / gauntlet palm). Visibility matters structurally now: a hidden or
      // unrevealed piece has NO mounted rig to fire from, so a named-but-
      // hidden target degrades to the per-origin default (null), never to a
      // DIFFERENT asset's colour and muzzle.
      const layers = attachLayers ?? null;
      const visible3D = (l: ExperienceLayer) => l.kind === '3d_attachment' && !!l.anchor && layerVisible(l);
      const named = a.objectId !== undefined && layers ? layers.find((l) => l.id === a.objectId) : undefined;
      const emitterLayer =
        named !== undefined
          ? visible3D(named) ? named : undefined
          : layers?.find(visible3D);
      const piece = emitterLayer
        ? layerToPiece(emitterLayer, { guestName, occlusionEnabled: false, customizationEnabled: source === 'db' })
        : null;
      emitFx({ kind: 'beam', spec: makeBeamSpec(a, piece, isHandSource(e.source), performance.now()) });
    } else if (a.type === 'animate') {
      setPulseMap((prev) => {
        const next = new Map(prev);
        next.set(a.objectId, { preset: a.preset, at: performance.now() });
        return next;
      });
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
    } else if (a.type === 'filterPulse') {
      startFilterPulse(a.shaderId, a.durationMs);
    }
  }, [startFilterPulse, attachLayers, guestName, source, layerVisible]);
  const handleTriggerEventRef = useRef(handleTriggerEvent);
  useEffect(() => { handleTriggerEventRef.current = handleTriggerEvent; }, [handleTriggerEvent]);

  // Hand tracking is LAZY: the landmarker (7.8MB model + a second CPU inference
  // stream) initializes only when the scene's triggers name a hand gesture OR
  // a piece is hand-ANCHORED (a wand with only a smile trigger still needs a
  // tracked hand to sit in). Derived from the RAW layers, not the visible
  // pieces: a reveal-gated wand must start its model download NOW, not at the
  // moment the reveal fires. No stored legacy config can have either (the
  // parse gates), so every existing event stays byte-identical in behaviour
  // AND bandwidth.
  const needsHands = useMemo(
    () =>
      // Off on every guest booth for now (handPose.GUEST_HAND_TRACKING): the
      // model never downloads and its inference never competes with the face.
      GUEST_HAND_TRACKING && (
        hasHandSource(lookTriggers) ||
        (rawAttachLayers ?? []).some((l) => l.kind === '3d_attachment' && isHandAnchorId(l.handAnchor))
      ),
    [lookTriggers, rawAttachLayers],
  );
  /** The hand tracker FAILED to start (handTracking.getHandTrackerError). */
  const [handTrackerFailed, setHandTrackerFailed] = useState(false);
  useEffect(() => {
    // No hasTriggers gate: a hand-anchored piece needs tracking even in a
    // scene with zero triggers (the rigs self-detect; this effect owns the
    // EARLY download + the stash reset on scene exit).
    if (source !== 'db' || !ready || !needsHands) return;
    initializeHandLandmarker().catch((e) => {
      console.warn('[Booth] hand tracker init failed', e);
      setHandTrackerFailed(getHandTrackerError() !== null);
    });
    return () => resetHandRig();
  }, [source, ready, needsHands]);

  // Detection + engine loop — only for a DB scene with triggers while the camera
  // is live. Drives detection itself (detectFaceNow / detectHandsNow — both
  // self-throttle and interleave so the two blocking inferences never share a
  // tick), and steps the engine once per NEW detection of EITHER task.
  useEffect(() => {
    if (!shouldRunTriggers(source, hasTriggers, phase, ready)) return;
    const engine = createTriggerEngine(triggers);
    let raf = 0;
    let lastFaceT = -1;
    let lastHandT = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current;
      if (!v) return;
      detectFaceNow(v);
      if (needsHands) detectHandsNow(v);
      const b = getLatestBlendshapes();
      const h = needsHands ? getLatestHandFrame() : null;
      const faceT = b?.t ?? -1;
      const handT = h?.t ?? -1;
      if (faceT === lastFaceT && handT === lastHandT) return;
      const handChanged = handT !== lastHandT;
      lastFaceT = faceT;
      lastHandT = handT;
      // The face clock (~33ms) steps this loop 2-4x per hand inference (66/150ms).
      // mergeDetectionScores decides whether the hand keys are new, merely
      // between inferences (held), or a frozen stash (zeroed) — replaying the
      // last hand sample into the EMA fires a beam with no hand in frame.
      const now = performance.now();
      const merged = mergeDetectionScores(b?.scores ?? null, h, handChanged, now);
      for (const ev of engine.step(merged.scores, now, merged.stale)) handleTriggerEventRef.current(ev);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [source, hasTriggers, phase, ready, videoRef, triggers, needsHands]);

  // A one-off guest hint when the scene has triggers. The copy names the source
  // the HOST actually authored — it used to hard-code "Smile for a surprise", so
  // a wink-triggered scene told every guest to do the wrong thing.
  // Now a "Try this" card (GestureCoach) that names the gesture AND what it
  // does, and comes back whenever the guest picks a Look with DIFFERENT
  // gestures — not once per camera session.
  const coach = useMemo(() => (source === 'db' ? gestureCoachFor(triggers, { hands: GUEST_HAND_TRACKING }) : null), [source, triggers]);
  const coachKey = coach?.key ?? '';
  const [coachOpen, setCoachOpen] = useState(false);
  const closeCoach = useCallback(() => setCoachOpen(false), []);
  const coachShownRef = useRef('');

  // ── Face/hand-tracking hint ───────────────────────────────────────────
  // A 3D piece is invisible until the tracker finds its subject — without
  // feedback that reads as "broken". A scene whose 3D pieces are ALL
  // hand-anchored (a lone wand) must coach "show your hand", not "center your
  // face": it may never mount a FaceRig at all, so faceVisible would coach a
  // face nothing is tracking.
  const [faceVisible, setFaceVisible] = useState(false);
  const [handVisible, setHandVisible] = useState(false);
  const handOnly3D = useMemo(
    () => overlayPieces !== undefined && overlayPieces.length > 0 && overlayPieces.every((p) => p.handAnchor !== undefined),
    [overlayPieces],
  );
  const [faceHint, setFaceHint] = useState(false);
  useEffect(() => {
    // trackerReady gate: before the landmarker has loaded, "Center your face
    // in the frame" is a lie — no amount of centering can be seen. The hint
    // now only coaches a tracker that is actually looking. Hand-only scenes
    // skip that gate (the FACE tracker may rightly never load) and get a
    // longer grace instead — the hand model is a 7.8MB download.
    const subjectVisible = handOnly3D ? handVisible : faceVisible;
    // A FAILED hand tracker can never see the hand: no "show your hand" coaching
    // (the one-off hint below says what happened instead).
    if (is3D && !subjectVisible && phase === 'camera' && ready && (handOnly3D || trackerReady) && !(handOnly3D && handTrackerFailed)) {
      const tid = setTimeout(() => setFaceHint(true), handOnly3D ? 2500 : 1500);
      return () => clearTimeout(tid);
    }
    setFaceHint(false);
  }, [is3D, faceVisible, handVisible, handOnly3D, phase, ready, trackerReady, handTrackerFailed]);

  // Tracker init FAILED (bad venue wifi, blocked CDN): tell the guest once,
  // the moment it matters — when a 3D piece is selected and can never appear.
  const trackerFailHintShownRef = useRef(false);
  useEffect(() => {
    if (trackerFailed && is3D && phase === 'camera' && ready && !trackerFailHintShownRef.current) {
      trackerFailHintShownRef.current = true;
      showBoothHint('Props aren’t loading on this connection — frames and effects still work');
    }
  }, [trackerFailed, is3D, phase, ready, showBoothHint]);
  // Same, for the HAND tracker (CPU delegate failed — never retried on GPU):
  // once, in the existing auto-dismissing hint (10px, overlaid — no layout shift).
  const handFailHintShownRef = useRef(false);
  useEffect(() => {
    if (handTrackerFailed && needsHands && phase === 'camera' && ready && !handFailHintShownRef.current) {
      handFailHintShownRef.current = true;
      showBoothHint('Hand tracking couldn’t load — hand gestures and hand props are off');
    }
  }, [handTrackerFailed, needsHands, phase, ready, showBoothHint]);

  // ── Stage box without CSS container units (#25) ───────────────────────
  // The stage's `min(100cqh, …cqw)` height needs container query units; a
  // browser without them drops it and falls back to h-full + aspect-[9/16] +
  // max-w-full, which is ~0.52 on a phone, not 0.5625 — the 3D layer is then
  // stretched ~8% into the 9:16 photo. Measure the space and size the box in
  // JS instead (same fitStageBox maths as the studio). Container units
  // present = this never runs and the inline style is unchanged.
  const stageAreaRef = useRef<HTMLDivElement | null>(null);
  const [fallbackStage, setFallbackStage] = useState<StageBox | null>(null);
  useEffect(() => {
    if (HAS_CONTAINER_UNITS) return;
    const el = stageAreaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const box = fitStageBox(r.width, r.height);
      setFallbackStage((prev) => (prev && prev.w === box.w && prev.h === box.h ? prev : box.w > 0 ? box : null));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  // ── Shutter / countdown ───────────────────────────────────────────────
  const handleShutterPress = useCallback(() => {
    if (phase !== 'camera') return;
    if (mediaMode === 'video' && recording) return; // handled by stop button
    if (cameraHint) dismissCameraHint();
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
  }, [phase, mediaMode, recording, timerSec, needsGuestName, askName, stripMode, resetStrip, cameraHint, dismissCameraHint]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const format = stripFormat(stripFormatRef.current);
    if (!stripComplete(shots.length, format.shots)) {
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
        cols: format.cols,
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
  /** `?reclock=0|1`: force a clip's picture live / frame-locked (tester A/B). null = decide per clip. */
  function clipLockOverride(): boolean | null {
    try {
      const v = new URLSearchParams(window.location.search).get('reclock');
      return v === '1' ? true : v === '0' ? false : null;
    } catch {
      return null;
    }
  }

  function startRecording() {
    if (!recordingSupported()) {
      showBoothHint('Video recording isn’t supported in this browser');
      return;
    }
    const canvas = stageRef.current?.canvas;
    if (!canvas) return;
    if (micCheckPendingRef.current) return; // a second tap while the mic opens

    // A clip is only as good as its microphone. The track opened with the
    // camera can be missing (mic refused at entry), ended, or muted by the OS,
    // and any of those records a silent video. Open a fresh mic first; if that
    // fails too, say so instead of handing the guest a silent clip.
    const source = streamRef.current;
    if (source && !liveAudioTrack(source.getAudioTracks())) {
      micCheckPendingRef.current = true;
      void acquireMicTrack().then((track) => {
        micCheckPendingRef.current = false;
        if (track && streamRef.current === source) {
          for (const old of source.getAudioTracks()) { source.removeTrack(old); old.stop(); }
          source.addTrack(track); // the camera hook's teardown stops it with the rest
        } else {
          track?.stop(); // the camera restarted meanwhile; its own stream decides
          if (!track) showBoothHint('Microphone is off, so this video will have no sound');
        }
        beginRecording(canvas);
      });
      return;
    }
    beginRecording(canvas);
  }

  function beginRecording(canvas: HTMLCanvasElement) {
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
      // Sound: the lip-sync delayed microphone when it is running, else the raw
      // one (a suspended AudioContext would record silence, so it is never used).
      let audio: MediaStream | MediaStreamTrack | undefined = streamRef.current ?? undefined;
      let delayed = false;
      const sync = audioSyncRef.current;
      const mic = liveAudioTrack(streamRef.current?.getAudioTracks() ?? []);
      if (sync && mic) {
        sync.bind(mic); // the record tap may have opened a fresh microphone
        const track = sync.ready() ? sync.track : null;
        if (track) {
          audio = track;
          delayed = true;
        }
      }
      setClipLocked(clipLockOverride() ?? delayed);
      // A capped booth already draws at the camera's rate: record every drawn
      // frame instead of sampling the canvas on a second, drifting 30 Hz timer.
      const recStream = buildRecordStream(canvas, audio, boothFpsCap > 0 && boothFpsCap <= 30 ? null : 30);
      const rec = new StreamRecorder({
        maxMs: VIDEO_MAX_MS,
        videoBitsPerSecond: videoBitsPerSecondFor(entitlements.videoMaxSec),
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
    // Clip length is measured at the tap: stop() then spends a moment turning
    // the recording into a plain MP4 (lib/mp4Export.ts).
    const stoppedAt = performance.now();
    const blob = await rec.stop();
    rec.dispose();
    recorderRef.current = null;

    const url = URL.createObjectURL(blob);
    recordVideoUrlRef.current = url;
    setCapturedDataUrl(url);
    setCapturedBlobRef(blob);
    setCapturedDurationMs(Math.max(0, Math.round(stoppedAt - recordStartRef.current)));
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

      const expId = attachExp?.id ?? paintExp?.id ?? frameExp?.id ?? (effectId !== 'none' ? `builtin:shader:${effectId}` : undefined);
      const taggedChallenge = withChallenge ? selectedChallenge : null;

      // Bounded wait: a stalled upload resolves as a 'network' failure (the
      // honest SendFailed screen with Retry) instead of "Beaming…" forever.
      const { post, error, deleteToken } = await withTimeout(
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
      setSentPostId(post.id);
      setSentChallenge(taggedChallenge ?? null);

      savePhoto(eventId, {
        id: post.id,
        image_url: post.image_url,
        media_type: isVideo ? 'video' : 'image',
        message: message || undefined,
        createdAt: Date.now(),
        // This device's proof it made the post — the ONLY copy that ever leaves
        // the server (post_secrets, migration 035). Without it stored here the
        // guest keeps the photo but loses the ability to take it down, so it
        // rides the local record, never a posts field.
        deleteToken,
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
        // The check failed OPEN (AI/network error let the shot through) — the
        // guest never sees this; the operator does, in client_errors. Platform
        // events only (legacy coded events never reach the check anyway).
        if (source === 'db' && 'failedOpen' in outcome && outcome.failedOpen === true) {
          reportError(new Error('challenge_check_failed_open'), { challengeId: selectedChallenge.id, eventSlug: eventId });
        }
        if (!outcome.pass) {
          setCheckReason(outcome.reason);
          setPhase('checkFailed');
          return;
        }
      }
      await doSubmit(guestName, message, true);
    },
    [capturedDataUrl, selectedChallenge, eventId, doSubmit, source],
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
    // Sky effects are not part of the swipe: they open the AR page.
    () => catalog.filter((e) => e.kind === 'shader' && !!e.config?.shader?.shaderId && !isSkyShaderId(e.config.shader.shaderId)),
    [catalog],
  );
  const stepFilter = useCallback((dir: 'left' | 'right') => {
    if (filterOptions.length === 0) return;
    const cur = filterOptions.findIndex((e) => e.config?.shader?.shaderId === effectId);
    const next = cycleIndex(cur, filterOptions.length, dir);
    haptic('select');
    if (next < 0) selectEffect('none');
    else selectEffect(filterOptions[next].config!.shader!.shaderId, filterOptions[next]);
  }, [filterOptions, effectId, selectEffect]);

  const onStagePointerDown = useCallback((e: React.PointerEvent) => {
    if (phase !== 'camera' || arStage) return;
    gestureStartRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  }, [phase, arStage]);

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
      if (canFlip && !recording) { haptic('toggle'); flipOrLeave(); }
      return;
    }
    lastTapRef.current = end;
  }, [phase, stepFilter, canFlip, recording, flipOrLeave]);

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
  // Platform (db) events get the look strip + "More looks" sheet + compact
  // top bar; legacy/code events keep the category-tab deck, PickerDrawer and
  // the original top bar exactly as shipped.
  const lookDeckUi = source === 'db';
  const clearAllLooks = () => {
    setEffectId('none');
    setSparkles(false);
    handleSelectFrame(null);
    setAttachExp(null);
    setPaintExp(null);
  };
  const deckSections = useMemo(
    () => buildDeck(source === 'db' ? withWorldLooks(catalog) : catalog),
    [catalog, source],
  );
  // Memoized: a fresh object literal per render made this a new prop identity
  // on every single re-render of the booth, defeating any memo downstream.
  const deckSelection: DeckSelection = useMemo(() => ({
    effectId,
    frameId: frameExp?.id ?? null,
    attachmentId: attachExp?.id ?? null,
    paintId: paintExp?.id ?? null,
  }), [effectId, frameExp, attachExp, paintExp]);
  const [deckCategory, setDeckCategory] = useState<DeckCategory | null>(null);
  // Open on whatever is already applied (an /experience/:id link or the
  // event's default), else the first category — but only once the catalog has
  // actually arrived, and never overriding a tab the guest chose themselves.
  const deckCatSetRef = useRef(false);
  // Platform events wait for their own experiences AND for the route/default
  // pick to be applied (initialCategoryWhenReady) — otherwise an AI frame set
  // as the default was applied but its tab never shown. Legacy/code events
  // keep the original first-non-empty rule exactly.
  const expectedOpenId = effectiveOpeningLookId(wallSettings.defaultExperienceId, eventConfig.defaultExperienceId, routeExperienceId);
  useEffect(() => {
    if (deckCatSetRef.current) return;
    const next = source === 'db'
      ? initialCategoryWhenReady(deckSections, deckSelection, { loaded: experiencesLoaded, expectedId: expectedOpenId })
      : deckSections.length === 0 ? undefined : initialCategory(deckSections, deckSelection);
    if (next === undefined) return;
    setDeckCategory(next);
    deckCatSetRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckSections, deckSelection, experiencesLoaded, source]);
  /** A tab the guest picked is final — the first-paint choice never overrides it. */
  const chooseDeckCategory = useCallback((c: DeckCategory) => {
    deckCatSetRef.current = true;
    setDeckCategory(c);
  }, []);

  /* The shutter lives here, not in the deck: it owns capture, recording and
     the progress ring. Extracted so the deck and the chrome-hidden view render
     the SAME control rather than two copies that drift apart. */
  const shutterNode = (
    <div className="relative flex items-center justify-center">
      {mediaMode === 'photo' && source === 'db' ? (
        // Platform booths: the brand shutter (purple glass core, white ring,
        // soft brand-hued inner glow). Coded legacy events keep their own.
        <motion.button
          onClick={() => { haptic('capture'); handleShutterPress(); }}
          whileTap={reducedMotionPref ? undefined : { scale: 0.9 }}
          className="bw-shutter"
          aria-label="Take photo"
        >
          <ShutterFace />
        </motion.button>
      ) : mediaMode === 'photo' ? (
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

  // The first-run camera hint is on screen only over a live camera; the first
  // tap anywhere (or a capture, in handleShutterPress) puts it away for good.
  const cameraHintShown = cameraHint && started && !error && ready && phase === 'camera' && !uiHidden;
  useEffect(() => {
    if (!cameraHintShown) return;
    const onTap = () => dismissCameraHint();
    window.addEventListener('pointerdown', onTap, { capture: true, once: true });
    return () => window.removeEventListener('pointerdown', onTap, { capture: true });
  }, [cameraHintShown, dismissCameraHint]);
  // The "Try this" card opens once per new set of gestures, after the
  // first-run camera tip has gone (two cards at the top would stack).
  useEffect(() => {
    if (!coachKey) { coachShownRef.current = ''; setCoachOpen(false); return; }
    // (camera-only — it is guidance before the shutter)
    if (phase !== 'camera' || !ready) { setCoachOpen(false); return; }
    if (cameraHintShown) return;
    if (coachShownRef.current === coachKey) return;
    coachShownRef.current = coachKey;
    setCoachOpen(true);
  }, [coachKey, phase, ready, cameraHintShown]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      className={platformBooth
        // `fixed inset-0` tracks iOS's DYNAMIC viewport (toolbars in or out),
        // where the AppShell's 100vh is the large one; pan-only touch-action
        // kills pinch/double-tap zoom in every engine that honours it, with
        // useViewportLock's listeners covering iOS Safari.
        ? 'fixed inset-0 flex flex-col overflow-hidden overscroll-none app-bg select-none [touch-action:pan-x_pan-y] [-webkit-tap-highlight-color:transparent]'
        : 'absolute inset-0 flex flex-col overflow-hidden app-bg select-none'}
    >
      <EventBackground density={44} sparkle={0.7} />
      {/* Tester-only (?faceEngine= / ?trackdebug); renders nothing otherwise. */}
      <TrackingReadout />
      {/* Tester-only (?lightdebug): live sliders for the 3D props' light. */}
      <LightingTuner presetId={boothLighting} />

      {/* ── Welcome gate ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {!started && !error && (
          <Welcome key="welcome" onStart={() => setStarted(true)} />
        )}
      </AnimatePresence>

      {/* ── First-launch onboarding ────────────────────────────────────── */}
      <AnimatePresence>
        {/* A camera error wins over the tutorial (it sits above the error
            screen): a guest who denied the camera hears that first. */}
        {shouldShowOnboarding({ started, onboardingVisible, cameraError: error }) && (
          <Onboarding
            key="onboarding"
            withChallengesStep={wallSettings.showChallenges !== false && challenges.some((c) => c.active)}
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
      {cameraWanted && !error && !ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-8">
          <div className="flex w-full max-w-xs flex-col items-center gap-4 animate-rise-in">
            <div className="relative h-12 w-12">
              <div className="absolute inset-0 rounded-full border border-gold-400/30 animate-pulse-glow" />
              <div className="absolute inset-1 animate-spin rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)]" />
            </div>
            <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/40">
              {cameraSlow ? 'Still trying to reach your camera…' : 'Starting camera…'}
            </p>
            {/* After ~8 s this is no longer a wait, it's a hang (some webviews
                never resolve getUserMedia) — offer the CameraError screen's
                ways-out so the guest is never stuck behind a spinner. */}
            {cameraSlow && (
              <div className="flex w-full flex-col items-stretch gap-2 animate-rise-in">
                <Link
                  to={`${basePath}/upload`}
                  className="glass min-h-11 rounded-xl flex items-center justify-center gap-2 font-label uppercase tracking-luxe text-[11px] text-champagne/80"
                >
                  <Upload className="w-4 h-4" />
                  Upload a photo instead
                </Link>
                <Link
                  to={`${basePath}/wall`}
                  className="glass min-h-11 rounded-xl flex items-center justify-center gap-2 font-label uppercase tracking-luxe text-[11px] text-champagne/80"
                >
                  <Images className="w-4 h-4" />
                  See the wall
                </Link>
                {boothSlug !== null && (
                  <ReportIssueButton
                    label="Report a problem"
                    iconSize={14}
                    prefill={{
                      source: 'guest_booth',
                      eventSlug: boothSlug,
                      subject: 'Camera never starts in the booth',
                      diagnostics: { cameraState: 'starting-timeout' },
                    }}
                    className="pressable min-h-11 rounded-xl flex items-center justify-center gap-2 font-label uppercase tracking-luxe text-[10px] text-champagne/50 hover:text-ivory transition-colors"
                  />
                )}
              </div>
            )}
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
                  onFlip={() => { if (!recording) flipOrLeave(); }}
                  licencesHref={arFrameId !== null && worldSession !== null ? '/licences' : undefined}
                  compact={lookDeckUi ? {
                    backTo: `${basePath}/welcome`,
                    // The timer moves up here on platform booths, camera-app
                    // style, so the shutter row has room for "More looks".
                    extra: mediaMode === 'photo' ? (
                      <TimerControl
                        className="relative"
                        variant="circle"
                        placement="down"
                        timerSec={timerSec}
                        onTimerSec={(t) => setTimerSec(t)}
                        timerOptions={TIMER_OPTIONS}
                      />
                    ) : undefined,
                  } : undefined}
                  leading={
                    <>
                      {!lookDeckUi && <Emblem size={30} className="shrink-0 drop-shadow-[0_0_10px_rgba(var(--accent-rgb),0.35)]" />}
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
            ref={stageAreaRef}
            // Platform phones: the 9:16 stage runs edge to edge from the top of
            // the screen (camera-app style) and the space left over gathers at
            // the bottom, under the deck, instead of two dead bands top and
            // bottom. From `sm` up it is centred and inset as before.
            className={platformBooth
              ? 'flex-1 relative min-h-0 flex items-start justify-center sm:items-center sm:px-2 sm:pb-1'
              : 'flex-1 relative min-h-0 flex items-center justify-center px-2 pb-1'}
            style={{ containerType: 'size' }}
          >
            <div
              className={platformBooth
                ? 'relative h-full aspect-[9/16] max-w-full rounded-b-[1.6rem] sm:rounded-[1.4rem] overflow-hidden sm:ring-1 ring-gold-700/25 shadow-[0_10px_50px_rgba(0,0,0,0.6)] bg-noir-900 touch-pan-y'
                : 'relative h-full aspect-[9/16] max-w-full rounded-[1.4rem] overflow-hidden ring-1 ring-gold-700/25 shadow-[0_10px_50px_rgba(0,0,0,0.6)] bg-noir-900 touch-pan-y'}
              style={
                HAS_CONTAINER_UNITS || fallbackStage === null
                  ? { height: 'min(100cqh, calc(100cqw * 16 / 9))' }
                  : { width: fallbackStage.w, height: fallbackStage.h }
              }
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
              {stageMounted && (
                // role="img" on this wrapper (NOT the stage box, whose hint
                // pills must stay readable to AT; NOT StageCanvas internals):
                // gives the otherwise-silent live canvas an accessible name.
                <div
                  className="absolute inset-0"
                  role="img"
                  aria-label="Live camera preview with your selected frame and effects"
                >
                <StageCanvas
                  ref={stageRef}
                  videoRef={videoRef}
                  effectId={stageShaderId(effectId)}
                  sparkles={sparkles}
                  mirror={isFront}
                  overlayUrl={worldMode || stageOverlays ? null : (is2DOverlay ? frameArt : null)}
                  overlayTransform={overlayTransform}
                  overlayOpacity={frameExp?.config?.opacity}
                  overlays={worldMode ? null : stageOverlays}
                  introKey={introKey}
                  // powerFxActive (db-only): a frame/filter-only scene's beam
                  // renders in that same canvas, so it must reach photos too.
                  threeCanvasId={worldMode ? 'booth-world-layer' : (is3D || powerFxActive ? 'booth-3d-layer' : null)}
                  // Draw the frame the pose came from (resolver decides: never
                  // legacy; on for 8th Wall poses). Photos use it too. A clip
                  // keeps it when its sound is delayed to match (clipLocked):
                  // the locked frame trails the camera by ~2 tracker samples,
                  // so with live sound the lips would move after the words.
                  // Otherwise a clip shows the live camera and props ride the
                  // filtered pose.
                  frameLock={!worldMode && is3D && source === 'db' && (!recording || clipLocked)}
                  pictureClock={source === 'db'}
                  maxFps={boothFpsCap}
                  active={true}
                  watermark={entitlements.watermark}
                  effectsCanvas={triggerFxCanvas}
                  lettering={worldMode ? null : stageLettering}
                  frameSource={arStage && worldSession ? worldFrameSource : null}
                  // The recorded clip IS this canvas (captureStream below), and
                  // the preview pass skips the signature — so every video used
                  // to ship unsigned while every photo shipped signed. On only
                  // while recording, so the viewfinder stays clean otherwise.
                  burnSignature={recording}
                />
                </div>
              )}
              <div ref={feedContainerRef} className="absolute inset-0">
                {/* Mounted for a 3D attach scene AND for any scene whose
                    triggers carry a beam action (a frame-only scene can still
                    blast) — the beam renders in this canvas so StageCanvas
                    composites it into the photo and the recording for free. */}
                {!worldMode && ((is3D && anchorConfig) || powerFxActive) && (
                  <HeadScaleOverlay3D
                    base={studioCfg.headScale}
                    subRef={headScaleSubRef}
                    assetUrl={is3D && anchorConfig ? pieceExp!.asset_url : null}
                    proceduralId={is3D && anchorConfig ? pieceExp!.config?.procedural : null}
                    anchor={anchorConfig ?? POWERFX_ONLY_ANCHOR}
                    videoId="booth-video"
                    mirror={isFront}
                    occlude={is3D && source === 'db' && attachExp?.config?.occlusion === true}
                    onFaceVisible={is3D && anchorConfig ? setFaceVisible : undefined}
                    onHandVisible={is3D && anchorConfig ? setHandVisible : undefined}
                    pieces={is3D && anchorConfig ? overlayPieces : null}
                    reveal={reveal}
                    lightingPreset={boothLighting}
                    onAssetReady={markAssetLoaded}
                    onAssetError={handleAssetError}
                    powerFx={powerFxActive}
                    // StageCanvas composites this canvas exactly when is3D
                    // (threeCanvasId above): hide the live copy so 3D is drawn once.
                    // PLATFORM only: legacy surfaces (the engine resolver's own
                    // isLegacyFaceSurface) keep the live copy on screen, as shipped.
                    composited={(is3D || powerFxActive) && !isLegacyFaceSurface(source !== 'db')}
                    // Group selfies: head pieces on every face 8th Wall tracks.
                    // PLATFORM only, like `composited` (and a no-op outside 8th Wall).
                    multiFace={is3D && !isLegacyFaceSurface(source !== 'db')}
                    maxFps={boothFpsCap}
                    // A prop switch shows nothing until the new prop is
                    // loaded, never the old one at the new spot. PLATFORM only.
                    hideStaleModels={!isLegacyFaceSurface(source !== 'db')}
                  />
                )}
              </div>
              {worldFrameUrl !== null && phase === 'camera' && (
                <WorldStage
                  frameUrl={worldFrameUrl}
                  cover={worldCover}
                  frameName={attachExp?.name.replace(/ 3D$/, '') ?? 'This frame'}
                  accent={eventConfig.accentHexes?.[0] ?? '#d4af37'}
                  videoRef={videoRef}
                  maxFps={boothFpsCap}
                  recording={recording}
                  onExit={leaveWorld}
                  engine={worldSession}
                  resumePlacing={arTapped}
                  onStartTap={() => {
                    // Synchronous, inside the tap: 8th Wall opens the camera
                    // and asks for motion access now (iOS needs the gesture).
                    // The camera hook then picks up the same stream.
                    if (worldSession && arHostRef.current) {
                      worldSession.start(arHostRef.current).catch(() => { /* acquire handles it */ });
                    }
                    setArTapped(true);
                  }}
                />
              )}
              {skyOn && !worldMode && worldSession !== null && phase === 'camera' && skyEffect(skyIdOfShader(effectId)) !== null && (
                <SkyStage
                  effect={skyEffect(skyIdOfShader(effectId))!}
                  engine={worldSession}
                  started={arTapped}
                  recording={recording}
                  onExit={leaveWorld}
                  onStartTap={() => {
                    // Synchronous, inside the tap (the same start as a standing Frame's).
                    if (arHostRef.current) worldSession.start(arHostRef.current).catch(() => { /* acquire handles it */ });
                    setArTapped(true);
                  }}
                />
              )}
              {/* 8th Wall's run canvas and its 1 px video live here, unseen. */}
              {arFrameId !== null && (
                <div ref={arHostRef} className="absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 pointer-events-none" aria-hidden />
              )}
              {/* Face-trigger particles. This canvas is the SOURCE: it is passed
                  to StageCanvas.effectsCanvas (:1081) and composited into the
                  same canvas that produces the preview, the JPEG and the recorded
                  video. It must stay MOUNTED and rendering, but it must not also
                  be drawn on top — it was, so every burst was drawn twice on
                  screen and the live preview came out brighter than the photo the
                  guest keeps. `opacity-0` rather than `hidden` because the
                  component hardcodes `display: block`. */}
              {hasTriggers && <TriggerEffects ref={triggerFxRef} className="absolute inset-0 w-full h-full pointer-events-none opacity-0" />}
              <div
                className="absolute top-4 inset-x-0 z-30 flex flex-col items-center gap-2 pointer-events-none"
                // The platform stage now starts at the top of the screen, so
                // the hints clear the floating top bar (safe area + 44px row).
                style={platformBooth ? { top: 'calc(env(safe-area-inset-top, 0px) + 4.25rem)' } : undefined}
              >
                {/* A name-wearing prop is on: say whose name it shows, and let
                    the guest set or change it at any time (the one-time prompt
                    is easy to miss, and skipping it used to be final). */}
                {coverWantsNames && phase === 'camera' && !askCoverNames && (
                  <button
                    type="button"
                    onClick={() => setAskCoverNames(true)}
                    className="pressable liquid-glass-raised pointer-events-auto flex min-h-11 items-center gap-2 px-4 py-2 rounded-full"
                  >
                    <Pencil className="w-4 h-4 text-gold-300" aria-hidden />
                    <span className="font-sans text-[13px] text-ivory">
                      {coverNames.length > 0 ? `On the cover: ${joinNames(coverNames)}` : 'Tap to put your names on the cover'}
                    </span>
                  </button>
                )}
                {propWantsName && phase === 'camera' && !askName && (
                  <button
                    type="button"
                    onClick={() => { setNameDraft(propWantsInitials ? crestInitials : guestName); setAskName(true); }}
                    className="pressable liquid-glass-raised pointer-events-auto flex min-h-11 items-center gap-2 px-4 py-2 rounded-full"
                  >
                    <Pencil className="w-4 h-4 text-gold-300" aria-hidden />
                    <span className="font-sans text-[13px] text-ivory">
                      {propWantsInitials
                        ? (crestInitials ? `Initials on your mask: ${crestInitials}` : 'Tap to add your initials')
                        : guestName.trim() ? `Name on your cap: ${guestName.trim()}` : 'Tap to put your name on it'}
                    </span>
                  </button>
                )}
                {/* First-run hint (platform only — replaces the five-slide intro). */}
                <AnimatePresence>
                  {cameraHintShown && (
                    <motion.div
                      key="camera-hint"
                      role="status"
                      initial={{ opacity: 0, y: reducedMotionPref ? 0 : -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: reducedMotionPref ? 0 : -8 }}
                      transition={{ duration: 0.25 }}
                      className="pointer-events-auto mx-3 flex max-w-[22rem] items-center gap-1 rounded-2xl glass-strong border border-gold-400/25 py-1 pl-4 pr-1"
                    >
                      <span className="font-sans text-[13px] leading-snug text-ivory">{CAMERA_HINT_COPY}</span>
                      <button
                        type="button"
                        onClick={dismissCameraHint}
                        aria-label="Dismiss tip"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-champagne/80 hover:text-ivory"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
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
                      {handOnly3D ? (
                        <Hand className="w-4 h-4 text-gold-300 animate-pulse" />
                      ) : (
                        <ScanFace className="w-4 h-4 text-gold-300 animate-pulse" />
                      )}
                      <span className="font-label text-[10px] uppercase tracking-wide text-champagne/80">
                        {handOnly3D ? 'Show your hand to the camera' : 'Center your face in the frame'}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(120% 90% at 50% 38%, transparent 58%, rgba(0,0,0,0.4) 100%)' }}
              />
              {/* Animated Looks: the "Try this" card for gesture Looks, and a
                  side rail with Replay (restarts the Frame's entrance — tap it
                  as you start a clip and the clip opens on it) and a chip that
                  brings the card back. DOM only, never in a capture. */}
              {phase === 'camera' && ready && (
                <GestureCoach coach={coach} open={coachOpen} onClose={closeCoach} />
              )}
              {phase === 'camera' && ready && !uiHidden && (frameHasIntro || (coach && !coachOpen)) && (
                <div
                  className="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2.5"
                  // Taps here are not stage taps (a double tap on the stage flips the camera).
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                >
                  {frameHasIntro && (
                    <button
                      type="button"
                      onClick={() => { haptic('toggle'); setIntroRun((n) => n + 1); }}
                      aria-label="Replay the Frame's animation"
                      className="pressable liquid-glass-raised flex h-11 w-11 items-center justify-center rounded-full"
                    >
                      <RotateCcw className="h-[18px] w-[18px] text-brand-fg/85" aria-hidden />
                    </button>
                  )}
                  {coach && !coachOpen && <GestureCoachChip coach={coach} onOpen={() => setCoachOpen(true)} />}
                </div>
              )}
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
          {phase === 'camera' && ready && !uiHidden && lookDeckUi && (
            <div className="absolute inset-x-0 bottom-0 z-20">
              <BoothLookDeck
                sections={deckSections}
                selection={deckSelection}
                sparkles={sparkles}
                onToggleSparkles={setSparkles}
                onSelectEffect={selectEffect}
                onSelectFrame={handleSelectFrame}
                onSelectAttachment={handleSelectAttachment}
                onSelectPaint={handleSelectPaint}
                onOpenAll={() => setMoreOpen(true)}
                sheetOpen={moreOpen}
                mediaMode={mediaMode}
                onMediaMode={setMediaMode}
                videoAllowed={videoAllowed}
                recording={recording}
                shutter={shutterNode}
                pendingIds={pendingExperienceIds}
                stripMode={stripMode}
                onStripMode={setStripMode}
                stripShots={stripCount}
                onOpenStripPicker={() => setStripPickerOpen(true)}
                colorSlot={colorSlot}
                guestHex={guestHex}
                onGuestHex={setGuestHex}
                hintEnabled={!onboardingVisible && !cameraHintShown && !moreOpen}
              />
            </div>
          )}
          {phase === 'camera' && ready && !uiHidden && !lookDeckUi && (
            <div className="absolute inset-x-0 bottom-0 z-20">
              <BoothControlDeck
                sections={deckSections}
                selection={deckSelection}
                category={deckCategory}
                onCategory={chooseDeckCategory}
                sparkles={sparkles}
                onToggleSparkles={setSparkles}
                onSelectEffect={selectEffect}
                onSelectFrame={handleSelectFrame}
                onSelectAttachment={handleSelectAttachment}
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
                colorSlot={colorSlot}
                guestHex={guestHex}
                onGuestHex={setGuestHex}
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
            aria-hidden
            // DOM only: capturePhoto renders to its own offscreen 1080x1920
            // canvas (StageCanvas), so the flash can never reach the photo.
            // Platform: a camera-style pop that eases out, and a gentle wash
            // instead of a full white strobe for guests who ask for less motion.
            className={platformBooth ? 'pointer-events-none absolute inset-0 z-50 bg-white' : 'absolute inset-0 z-50 bg-white'}
            initial={{ opacity: platformBooth && reducedMotionPref ? 0.4 : 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={platformBooth
              ? { duration: reducedMotionPref ? 0.25 : 0.5, ease: [0.22, 1, 0.36, 1] }
              : { duration: 0.35 }}
          />
        )}
      </AnimatePresence>

      {/* ── Photo-strip format picker ─────────────────────────────────── */}
      {stripPickerOpen && (
        <StripPicker
          stripMode={stripMode}
          current={stripFormatId}
          onPick={(id) => {
            setStripFormatId(id);
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
      {lookDeckUi && phase === 'camera' && ready && (
        <LooksSheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          sections={deckSections}
          selection={deckSelection}
          sparkles={sparkles}
          onToggleSparkles={setSparkles}
          onSelectEffect={selectEffect}
          onSelectFrame={handleSelectFrame}
          onSelectAttachment={handleSelectAttachment}
          onSelectPaint={handleSelectPaint}
          onClearAll={clearAllLooks}
          pendingIds={pendingExperienceIds}
        />
      )}
      {!lookDeckUi && moreOpen && phase === 'camera' && (
        <div
          className="absolute inset-0 z-30 bg-noir-900/55 backdrop-blur-sm"
          onClick={() => setMoreOpen(false)}
        />
      )}
      {!lookDeckUi && phase === 'camera' && ready && (
        <div className="absolute bottom-0 left-0 right-0 z-40 pb-safe-bottom pointer-events-none">
          <div className="pointer-events-auto">
            <PickerDrawer
              catalog={catalog}
              effectId={effectId}
              sparkles={sparkles}
              frameId={frameExp?.id ?? null}
              attachmentId={attachExp?.id ?? null}
              onSelectEffect={selectEffect}
              onToggleSparkles={setSparkles}
              onSelectFrame={handleSelectFrame}
              onSelectAttachment={handleSelectAttachment}
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
          blob={capturedMediaTypeRef.current === 'video' ? capturedBlobRef : null}
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
      {/* A crest prop (masquerade mask) asks for INITIALS instead, unless the
          frame also writes the whole name — then the name covers both. */}
      {askName && (() => {
        const initialsMode = propWantsInitials && letteringSpec?.token !== 'guestName';
        const draftOk = initialsMode ? normalizeInitials(nameDraft).length >= 1 : nameDraft.trim().length >= 2;
        const save = () => {
          if (initialsMode) setGuestInitials(eventId, normalizeInitials(nameDraft));
          else setGuestName(eventId, nameDraft);
          setGuestNameTick((t) => t + 1);
          setAskName(false);
        };
        return (
        <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-noir-900/70 backdrop-blur-sm px-4 pb-safe-bottom [--safe-bottom:1.5rem]">
          <div className="w-full max-w-sm liquid-glass rounded-3xl px-6 py-6 text-center">
            <h3 className="font-serif text-2xl text-ivory mb-1">
              {initialsMode ? 'Add your initials' : 'Put your name on it'}
            </h3>
            <p className="font-sans text-[13px] text-champagne/60 leading-relaxed mb-5">
              {initialsMode
                ? `Up to ${MAX_INITIALS} letters, engraved in gold on your mask. Skip it and the crest stays plain.`
                : propWantsName && letteringSpec?.token !== 'guestName'
                  ? 'This piece wears your name. Skip it and it stays plain.'
                  : 'This frame writes your name across every shot you take. Skip it and the frame stays as it is.'}
            </p>
            <input
              type="text"
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(initialsMode ? normalizeInitials(e.target.value) : e.target.value.slice(0, 60))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !draftOk) return;
                save();
              }}
              placeholder={initialsMode ? 'e.g. AB' : 'Your name'}
              autoCapitalize={initialsMode ? 'characters' : undefined}
              autoComplete={initialsMode ? 'off' : undefined}
              aria-label={initialsMode ? 'Your initials' : 'Your name'}
              className={`w-full text-center bg-noir-800/70 border border-gold-400/25 rounded-xl px-4 py-3 font-sans text-base text-ivory placeholder-champagne/30 outline-none focus:border-gold-400/60 transition-colors mb-4${initialsMode ? ' tracking-[0.3em] uppercase' : ''}`}
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
                {initialsMode ? 'Skip' : 'Continue without a name'}
              </button>
              <button
                onClick={save}
                disabled={!draftOk}
                className="flex-1 bg-foil glow-accent text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] rounded-xl px-4 py-3 hover:brightness-110 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
              >
                Use it
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Names for a magazine cover ─────────────────────────────────── */}
      {askCoverNames && activeCover && (
        <CoverNamesSheet
          initial={coverNames.length > 0 ? coverNames : (guestName.trim() ? [guestName.trim()] : [])}
          coverName={catalog.find((e) => coverTemplateOfId(e.id) === activeCover.template)?.name ?? 'Magazine cover'}
          onSave={(names) => {
            setCoverNames(eventId, names);
            setCoverNamesTick((t) => t + 1);
            setAskCoverNames(false);
          }}
          onSkip={() => {
            markCoverNamesAsked(eventId);
            setAskCoverNames(false);
          }}
        />
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
          blob={capturedMediaTypeRef.current === 'video' ? capturedBlobRef : null}
          postId={sentPostId}
          completedChallenge={sentChallenge}
          nextChallenge={source === 'db' && wallSettings.showChallenges !== false
            ? nextChallenge(challenges, getCompletedChallenges(eventId), sentChallenge?.id ?? null)
            : null}
          onNextChallenge={(c) => {
            handleTakeAnother();
            setSelectedChallenge(c);
          }}
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

      {/* ── Between the normal booth and AR mode (two page loads) ──── */}
      <AnimatePresence>
        {(switching ?? arrival?.dir ?? null) !== null && (
          <ArSwitchScreen key="ar-switch" dir={(switching ?? arrival!.dir)} accent={switching !== null ? switchAccent : arrival!.accent} />
        )}
      </AnimatePresence>

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
