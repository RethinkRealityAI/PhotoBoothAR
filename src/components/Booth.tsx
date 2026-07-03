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
  SlidersHorizontal, Eye, EyeOff, ChevronUp,
} from 'lucide-react';

import EventBackground from './ui/EventBackground';
import { Emblem } from './ui/EventLogo';
import { GalleryIcon, MediaStackIcon } from './ui/MediaIcons';
import ShareButton from './ui/ShareButton';

// Booth sub-components
import { useCameraStream } from './booth/useCameraStream';
import Welcome from './booth/Welcome';
import CameraErrorScreen from './booth/CameraError';
import StageCanvas, { StageCanvasHandle } from './booth/StageCanvas';
import Overlay3D from './booth/Overlay3D';
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
import { submitPost } from '../lib/db';
import { savePhoto, addCompletedChallenge, setGuestName } from '../lib/session';
import { StreamRecorder, buildRecordStream, recordingSupported } from '../lib/recorder';
import { dataUrlToBlob } from './booth/capture';
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

// ─────────────────────────────────────────────────────────────────────────────

export default function Booth() {
  const { id: routeExperienceId } = useParams<{ id?: string }>();
  const { eventId, config: eventConfig, basePath } = useEvent();

  // ── Store ─────────────────────────────────────────────────────────────
  const {
    experiences, experiencesLoaded, fetchExperiences,
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
    () => buildCatalog(eventConfig.arContent, experiencesLoaded ? experiences : [], presetOverrides),
    [eventConfig, experiences, experiencesLoaded, presetOverrides],
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
      } else if (exp.kind === '3d_attachment') {
        setAttachExp(exp);
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
    } else if (exp.kind === '3d_attachment') {
      setAttachExp(exp);
    }
    appliedDefaultRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiencesLoaded, wallSettings.defaultExperienceId, catalog, routeExperienceId]);

  // Reset transform when frame changes
  const handleSelectFrame = useCallback((exp: Experience | null) => {
    setFrameExp(exp);
    setOverlayTransform(exp?.config?.transform ?? DEFAULT_TRANSFORM);
  }, []);

  // ── Derived flags ─────────────────────────────────────────────────────
  const isFront = facingMode === 'user';
  const is2DOverlay = frameExp !== null && !!frameExp.asset_url &&
    (frameExp.kind === 'border' || frameExp.kind === '2d_filter');
  const is3D = attachExp !== null && attachExp.kind === '3d_attachment' &&
    (!!attachExp.asset_url || !!attachExp.config?.procedural);
  const anchorConfig: AnchorConfig | null =
    is3D && attachExp?.config?.anchor ? (attachExp.config.anchor as AnchorConfig) : null;

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
                  overlayUrl={is2DOverlay ? frameExp!.asset_url : null}
                  overlayTransform={overlayTransform}
                  overlayOpacity={frameExp?.config?.opacity}
                  threeCanvasId={is3D ? 'booth-3d-layer' : null}
                  active={true}
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
                  />
                )}
              </div>
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(120% 90% at 50% 38%, transparent 58%, rgba(0,0,0,0.4) 100%)' }}
              />
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
                      <button onClick={() => { if (!recording) setMediaMode('video'); }} disabled={recording} aria-label="Video mode" className={`flex items-center justify-center px-2.5 py-1.5 rounded-full transition-all ${mediaMode === 'video' ? 'bg-foil text-noir-900' : 'text-champagne/50 hover:text-ivory'}`}>
                        <Video className="w-3.5 h-3.5" />
                      </button>
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
