/**
 * World mode: the selected Frame stands up in the room, life-size.
 *
 * Shown when a platform guest flips to the BACK camera with a Frame selected.
 * Only the camera and the tracking change: the booth's tabs, shutter, timer,
 * recording and review are untouched. This renders into its own transparent
 * R3F canvas, which StageCanvas composites exactly like the face props'
 * canvas (threeCanvasId), so photos and clips get the standing frame for free.
 *
 * Tracking: 8th Wall's floor tracking (SLAM) when `engine` is given
 * (lib/world/xr8World.ts): the camera pose and lens come from the engine, for
 * the very picture the booth draws, so the frame stays on its spot while the
 * phone turns AND moves. Without an engine (fallback: no phone, engine failed,
 * `?wtrack=sensors`), the phone's motion sensors plus the floor lock.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AnimatePresence, motion } from 'motion/react';
import { Move, Hand } from 'lucide-react';
import * as THREE from 'three';
import SceneLighting from '../ar/SceneLighting';
import { CompositeDriver } from './Overlay3D';
import { OrientationHistory, orientationToQuaternion, stageVerticalFov } from '../../lib/world/orientation';
import {
  CAMERA_HEIGHT_M, createGesture, placementSpot, gestureDown, gestureMove, gestureUp, standeeSize, yawToFace,
  type GestureState,
} from '../../lib/world/placement';
import { buildStandeeWalls, gridFromImageData } from '../../lib/world/standeeMesh';
import { haptic } from '../../lib/haptics';
import { goodMatch, grabPatch, matchPatch, median, MIN_PATCH_STD, toGray, type Patch } from '../../lib/world/patchTrack';
import type { WorldSession } from '../../lib/world/xr8World';
import type { ResolvedCover } from '../../lib/cover/spec';
import type { CoverObject } from '../../lib/cover/build3d';

/* ------------------------------------------------------------------ */
/* Tunables (URL knobs for phone A/B tests)                            */
/* ------------------------------------------------------------------ */

const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const num = (k: string, d: number, lo: number, hi: number) => {
  const v = Number(qs.get(k));
  return Number.isFinite(v) && qs.has(k) && v >= lo && v <= hi ? v : d;
};
/** Back camera's view across the long side of its picture (degrees). `?wfov=`. */
const LONG_SIDE_FOV = num('wfov', 66, 40, 100);
/** Phone height above the floor (m). `?camh=`. */
const CAM_H = num('camh', CAMERA_HEIGHT_M, 0.8, 2.2);
/** How old the camera picture on screen is (ms): rotations are drawn this late. `?wlag=`. */
const PICTURE_LAG_MS = num('wlag', 70, 0, 250);
/** Where the reticle aims, in NDC (a little below the middle: you look at the floor in front). */
const AIM_NDC = new THREE.Vector2(0, -0.3);
/** Lock the placed frame to the floor with the camera picture (`?wlock=0` = sensors only). */
const FLOOR_LOCK = qs.get('wlock') !== '0';
/** Board thickness (m) and the art's grid resolution for its silhouette. */
const BOARD_DEPTH = 0.045;
const GRID_FACTOR = 4;
/** Orientation samples needed before Place unlocks (sensors settle). */
const SETTLE_SAMPLES = 12;
/** No sensor event within this long after asking → the phone has none (or refused). */
const NO_SENSOR_MS = 1500;
/** With no sensors, a fixed view: 12° below the horizon. */
const STATIC_BETA = 78;

type Phase = 'intro' | 'placing' | 'placed';

/** Shared between the DOM half (buttons, gestures) and the 3D half (per frame). */
interface WorldStore {
  phase: Phase;
  gesture: GestureState;
  history: OrientationHistory;
  samples: number;
  /** null = waiting for sensors, true = live sensors, false = none (fixed view). */
  sensors: boolean | null;
  /** Last floor hit while placing (null = aiming above the floor / too far). */
  aim: THREE.Vector3 | null;
  /** The placed spot and its "faces you" yaw. */
  spot: THREE.Vector3;
  spotYaw: number;
  /** Bumped from the 3D half when what the DOM shows must change. */
  onAimChange: ((hasAim: boolean) => void) | null;
  /** Floor-lock points matched on the last step (tester readout). */
  lockMatched: number;
  /** Where the camera is in the world (SLAM moves it; sensors keep it at CAM_H). */
  camPos: THREE.Vector3;
}

/* ------------------------------------------------------------------ */
/* Motion sensors                                                      */
/* ------------------------------------------------------------------ */

type IOSPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** MUST run synchronously inside a tap (iOS only shows its prompt from a gesture). */
function askMotionPermission(): Promise<boolean> {
  const DOE = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as unknown as IOSPermission | undefined;
  if (!DOE?.requestPermission) return Promise.resolve(true);
  try {
    return DOE.requestPermission().then((r) => r === 'granted').catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

function screenAngle(): number {
  const a = typeof screen !== 'undefined' ? screen.orientation?.angle : undefined;
  if (typeof a === 'number') return a;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

function useMotionSensors(store: WorldStore, enabled: boolean, onSensorState: (s: boolean) => void) {
  useEffect(() => {
    if (!enabled) return;
    const q = new THREE.Quaternion();
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      orientationToQuaternion(e.alpha, e.beta, e.gamma, screenAngle(), q);
      store.history.push(performance.now(), q);
      store.samples++;
      if (store.sensors !== true) { store.sensors = true; onSensorState(true); }
    };
    window.addEventListener('deviceorientation', onOrient);
    const t = window.setTimeout(() => {
      if (store.sensors === null) {
        store.sensors = false;
        // A fixed view so the frame can still be placed and shot.
        store.history.push(performance.now(), orientationToQuaternion(0, STATIC_BETA, 0, 0));
        onSensorState(false);
      }
    }, NO_SENSOR_MS);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      window.clearTimeout(t);
    };
  }, [store, enabled, onSensorState]);
}

/* ------------------------------------------------------------------ */
/* The board: art on the front, its own silhouette as solid sides      */
/* ------------------------------------------------------------------ */

interface BoardParts {
  texture: THREE.Texture;
  walls: THREE.BufferGeometry;
  w: number;
  h: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`frame art failed to load: ${url}`));
    img.src = url;
  });
}

async function buildBoard(url: string, maxAniso: number): Promise<BoardParts> {
  const img = await loadImage(url);
  if (img.decode) await img.decode().catch(() => { /* already decoded */ });
  const { w, h } = standeeSize(img.naturalWidth, img.naturalHeight);
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data; // throws if the art is cross-origin without CORS
  const grid = gridFromImageData(data, cv.width, cv.height, GRID_FACTOR);
  const wall = buildStandeeWalls(grid, { width: w, height: h, depth: BOARD_DEPTH });
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.BufferAttribute(wall.positions, 3));
  walls.setAttribute('normal', new THREE.BufferAttribute(wall.normals, 3));
  walls.setAttribute('color', new THREE.BufferAttribute(wall.colors, 3));
  walls.computeBoundingSphere();
  const texture = new THREE.Texture(img);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAniso;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return { texture, walls, w, h };
}

/** Soft contact shadow: one dark colour fading to clear. */
function makeShadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 4, 128, 128, 126);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/** The reticle: a thin accent ring of four arcs, a soft halo and a centre dot. */
function makeReticleTexture(accent: string): THREE.Texture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const m = S / 2;
  const halo = g.createRadialGradient(m, m, S * 0.18, m, m, S * 0.5);
  halo.addColorStop(0, 'rgba(255,255,255,0)');
  halo.addColorStop(0.7, hexA(accent, 0.18));
  halo.addColorStop(1, hexA(accent, 0));
  g.fillStyle = halo;
  g.fillRect(0, 0, S, S);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = S * 0.028;
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 + 0.22;
    g.beginPath(); g.arc(m, m, S * 0.4, a0, a0 + Math.PI / 2 - 0.44); g.stroke();
  }
  g.strokeStyle = accent;
  g.lineWidth = S * 0.016;
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 + 0.22;
    g.beginPath(); g.arc(m, m, S * 0.4, a0, a0 + Math.PI / 2 - 0.44); g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = S * 0.008;
  g.beginPath(); g.arc(m, m, S * 0.27, 0, Math.PI * 2); g.stroke();
  g.fillStyle = accent;
  g.beginPath(); g.arc(m, m, S * 0.045, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(m, m, S * 0.022, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ------------------------------------------------------------------ */
/* Floor lock: the camera picture keeps the frame on its patch of floor */
/* ------------------------------------------------------------------ */

const TRACK_H = 256;
const PATCH = 15;
const SEARCH = 10;
const TRACK_EVERY_MS = 30;
/** How much of each measured gap is corrected per step (smooths jitter). */
const LOCK_GAIN = 0.6;
/** The correction never grows past this (radians): a wrong lock cannot fling the frame. */
const LOCK_MAX = 0.35;
/** Re-grab a patch's picture after this many good matches (the view of it slowly changes). */
const REFRESH_AFTER = 20;
/**
 * Steps in a row with no trustworthy match before the lock lets go (~0.5 s).
 * It then eases its correction back to the sensors' view and re-anchors, so a
 * lost lock is never worse than no lock.
 */
const LOST_AFTER = 15;
/** Patches that must agree (within AGREE_PX on the tracking image) for a step to count. */
const MIN_AGREE = 2;
const AGREE_PX = 2.5;
const RELEASE_EASE = 0.8;

interface LockPoint { world: THREE.Vector3; patch: Patch; good: number }

class FloorLock {
  private cv = document.createElement('canvas');
  private ctx = this.cv.getContext('2d', { willReadFrequently: true });
  private gray: Float32Array | null = null;
  private w = 0;
  private h = TRACK_H;
  private last = 0;
  private points: LockPoint[] = [];
  private v = new THREE.Vector3();
  /** Camera-local correction: pitch (x) and yaw (y), radians. */
  readonly corr = { x: 0, y: 0 };
  /** Points matched on the last step (for ?wdiag). */
  matched = 0;
  active = false;
  private misses = 0;

  reset(): void { this.points = []; this.corr.x = 0; this.corr.y = 0; this.active = false; this.matched = 0; this.misses = 0; }

  /** Small greyscale copy of exactly what the stage shows (same cover fit as StageCanvas). */
  private grab(video: HTMLVideoElement, aspect: number): boolean {
    const ctx = this.ctx;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!ctx || vw === 0 || vh === 0 || video.readyState < 2) return false;
    const w = Math.max(32, Math.round(TRACK_H * aspect));
    if (this.cv.width !== w || this.cv.height !== TRACK_H) { this.cv.width = w; this.cv.height = TRACK_H; }
    this.w = w;
    const srcA = vw / vh, dstA = w / TRACK_H;
    let sw = vw, sh = vh, sx = 0, sy = 0;
    if (srcA > dstA) { sw = vh * dstA; sx = (vw - sw) / 2; } else { sh = vw / dstA; sy = (vh - sh) / 2; }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, TRACK_H);
    this.gray = toGray(ctx.getImageData(0, 0, w, TRACK_H).data, w, TRACK_H, this.gray ?? undefined);
    return true;
  }

  private toPx(p: THREE.Vector3, camera: THREE.Camera): { x: number; y: number } | null {
    this.v.copy(p).project(camera);
    if (this.v.z > 1 || this.v.z < -1) return null;
    return { x: ((this.v.x + 1) / 2) * this.w, y: ((1 - this.v.y) / 2) * this.h };
  }

  /**
   * One tracking step. `anchors` = world points on the floor next to the
   * frame (used only to start a lock). Updates `corr`; returns nothing.
   */
  step(now: number, video: HTMLVideoElement | null, aspect: number, camera: THREE.PerspectiveCamera, anchors: () => THREE.Vector3[]): void {
    if (!video || now - this.last < TRACK_EVERY_MS) return;
    this.last = now;
    if (!this.grab(video, aspect) || !this.gray) return;
    const gray = this.gray, w = this.w, h = this.h;
    if (this.points.length === 0) {
      // Letting go: ease back to the sensors before taking new patches, so
      // the frame glides rather than jumps.
      if (Math.abs(this.corr.x) > 0.002 || Math.abs(this.corr.y) > 0.002) {
        this.corr.x *= RELEASE_EASE;
        this.corr.y *= RELEASE_EASE;
        return;
      }
      this.corr.x = 0; this.corr.y = 0; this.misses = 0;
      for (const a of anchors()) {
        const px = this.toPx(a, camera);
        if (!px) continue;
        const patch = grabPatch(gray, w, h, px.x, px.y, PATCH);
        if (patch && patch.std >= MIN_PATCH_STD) this.points.push({ world: a.clone(), patch, good: 0 });
      }
      this.active = this.points.length > 0;
      return;
    }
    const hits: { pt: LockPoint; dx: number; dy: number; x: number; y: number }[] = [];
    for (const pt of this.points) {
      const pred = this.toPx(pt.world, camera);
      if (!pred) continue;
      const m = matchPatch(gray, w, h, pt.patch, pred.x, pred.y, SEARCH);
      if (!goodMatch(m)) continue;
      hits.push({ pt, dx: m.x - pred.x, dy: m.y - pred.y, x: m.x, y: m.y });
    }
    // Trust a step only when at least two patches agree on how far the floor
    // moved. One patch alone can lock onto the wrong plank or tile of a
    // repeating floor and hold the frame off its spot forever.
    const mx = median(hits.map((k) => k.dx)), my = median(hits.map((k) => k.dy));
    const agree = hits.filter((k) => Math.abs(k.dx - mx) <= AGREE_PX && Math.abs(k.dy - my) <= AGREE_PX);
    this.matched = agree.length;
    if (agree.length < MIN_AGREE) {
      if (++this.misses >= LOST_AFTER) { this.points = []; this.active = false; }
      return;
    }
    this.misses = 0;
    for (const k of agree) {
      if (++k.pt.good < REFRESH_AFTER) continue;
      const fresh = grabPatch(gray, w, h, k.x, k.y, PATCH);
      if (fresh && fresh.std >= MIN_PATCH_STD) k.pt.patch = fresh;
      k.pt.good = 0;
    }
    const dxs = agree.map((k) => k.dx), dys = agree.map((k) => k.dy);
    // Pixels → angle at this field of view. The floor patch sits right/below
    // where the sensors put it: turn the virtual camera left/up so the frame
    // is drawn right/below too, back on its patch.
    const f = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const clamp = (x: number) => Math.max(-LOCK_MAX, Math.min(LOCK_MAX, x));
    this.corr.y = clamp(this.corr.y + LOCK_GAIN * Math.atan(median(dxs) / f));
    this.corr.x = clamp(this.corr.x + LOCK_GAIN * Math.atan(median(dys) / f));
  }
}

/* ------------------------------------------------------------------ */
/* The 3D half                                                          */
/* ------------------------------------------------------------------ */

function WorldScene({
  store, frameUrl, cover, accent, videoRef, onBoardReady, onBoardError, engine,
}: {
  store: WorldStore;
  engine: WorldSession | null;
  frameUrl: string;
  cover: ResolvedCover | null;
  accent: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onBoardReady: () => void;
  onBoardError: () => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const [board, setBoard] = useState<BoardParts | null>(null);
  const [coverObj, setCoverObj] = useState<CoverObject | null>(null);
  /** What stands up: the flat board, or a magazine cover. */
  const stand: { w: number } | null = board ?? coverObj;

  // A magazine cover Frame stands up as the 3D cover (lib/cover/build3d.ts),
  // built on demand so no other booth downloads it.
  useEffect(() => {
    if (!cover) { setCoverObj(null); return; }
    let alive = true;
    let built: CoverObject | null = null;
    import('../../lib/cover/build3d')
      .then(({ buildCover3D }) => buildCover3D(cover, gl.capabilities.getMaxAnisotropy()))
      .then((c) => {
        if (!alive) { c.dispose(); return; }
        built = c;
        setBoard(null);
        setCoverObj(c);
        onBoardReady();
      })
      .catch((e) => { console.warn('[WorldStage] cover', e); if (alive) onBoardError(); });
    return () => {
      alive = false;
      built?.dispose();
    };
  }, [cover, gl, onBoardReady, onBoardError]);

  // Build the board for the selected Frame. Switching Frames swaps the board
  // in place: size, turn and placement are kept.
  useEffect(() => {
    if (cover) return;
    let alive = true;
    let built: BoardParts | null = null;
    buildBoard(frameUrl, gl.capabilities.getMaxAnisotropy())
      .then((b) => {
        if (!alive) { b.texture.dispose(); b.walls.dispose(); return; }
        built = b;
        setBoard(b);
        onBoardReady();
      })
      .catch((e) => { console.warn('[WorldStage]', e); if (alive) onBoardError(); });
    return () => {
      alive = false;
      if (built) { built.texture.dispose(); built.walls.dispose(); }
    };
  }, [frameUrl, cover, gl, onBoardReady, onBoardError]);

  const shadowTex = useMemo(makeShadowTexture, []);
  const reticleTex = useMemo(() => makeReticleTexture(accent), [accent]);
  useEffect(() => () => { shadowTex.dispose(); reticleTex.dispose(); }, [shadowTex, reticleTex]);

  const stage = useRef<THREE.Group>(null);
  const holder = useRef<THREE.Group>(null);
  const reticle = useRef<THREE.Mesh>(null);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const upTmp = useMemo(() => new THREE.Vector3(), []);
  const hadAim = useRef(false);
  const lock = useMemo(() => new FloorLock(), []);
  const lockStarted = useRef(false);
  const corrQ = useMemo(() => new THREE.Quaternion(), []);
  const corrE = useMemo(() => new THREE.Euler(), []);

  useFrame((_, dt) => {
    const now = performance.now();
    coverObj?.tick(now);
    if (engine) {
      // 8th Wall: the pose and lens of the picture the booth is drawing.
      const p = engine.pose();
      if (p) {
        camera.position.set(p.position.x, p.position.y, p.position.z);
        camera.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
        camera.projectionMatrix.fromArray(p.intrinsics);
        // The engine's projection replaces fov/aspect: refresh the inverse every
        // frame or rays (the reticle's aim) land off to one side.
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }
      camera.updateMatrixWorld();
      store.camPos.copy(camera.position);
      stepScene(dt, now, p !== null && engine.settled());
      return;
    }
    // Camera: phone height, rotated as the phone was when this picture was taken.
    camera.position.set(0, CAM_H, 0);
    if (store.history.at(now - PICTURE_LAG_MS, q)) camera.quaternion.copy(q);
    if (store.phase === 'placed' && (lock.corr.x !== 0 || lock.corr.y !== 0)) {
      corrQ.setFromEuler(corrE.set(lock.corr.x, lock.corr.y, 0, 'YXZ'));
      camera.quaternion.multiply(corrQ);
    }
    const v = videoRef.current;
    const fov = stageVerticalFov(LONG_SIDE_FOV, v?.videoWidth ?? 0, v?.videoHeight ?? 0, size.width, size.height);
    if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== 0.05) {
      camera.fov = fov; camera.near = 0.05; camera.far = 60;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    store.camPos.copy(camera.position);
    stepScene(dt, now, store.sensors === false || store.samples >= SETTLE_SAMPLES);
  });

  /** Reticle, placement and floor lock, once the camera is set for this frame. */
  function stepScene(dt: number, now: number, ready: boolean): void {
    const st = stage.current, hd = holder.current, rt = reticle.current;
    if (!st || !hd || !rt) return;
    const g = store.gesture;
    hd.rotation.y = g.yaw;
    hd.scale.setScalar(g.scale);

    if (store.phase === 'placing') {
      tmp.set(AIM_NDC.x, AIM_NDC.y, 0.5).unproject(camera).sub(camera.position);
      // The phone's top edge says which way is ahead when it points straight down.
      upTmp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const hit = ready ? placementSpot(camera.position, tmp, upTmp) : null;
      if (hit) {
        const first = store.aim === null;
        store.aim = (store.aim ?? new THREE.Vector3()).set(hit.x, 0, hit.z);
        const k = first ? 1 : 1 - Math.exp(-16 * dt);
        rt.position.lerp(store.aim, k);
        rt.position.y = 0.004;
        st.position.lerp(store.aim, first ? 1 : 1 - Math.exp(-14 * dt));
        st.rotation.y = yawToFace(camera.position, st.position);
      } else {
        store.aim = null;
      }
      rt.visible = hit !== null;
      st.visible = hit !== null && stand !== null;
      rt.rotation.z += dt * 0.6;
      const pulse = 1 + Math.sin(now / 380) * 0.04;
      rt.scale.setScalar(pulse * Math.max(0.6, stand ? stand.w * g.scale * 0.55 : 0.6));
      if (hadAim.current !== (hit !== null)) {
        hadAim.current = hit !== null;
        store.onAimChange?.(hit !== null);
      }
      if (lockStarted.current) { lock.reset(); lockStarted.current = false; }
    } else if (store.phase === 'placed') {
      rt.visible = false;
      st.visible = stand !== null;
      st.position.copy(store.spot);
      st.rotation.y = store.spotYaw;
      if (!engine && FLOOR_LOCK && store.sensors === true) {
        lockStarted.current = true;
        lock.step(now, videoRef.current, size.width / Math.max(1, size.height), camera, () => {
          // Floor just outside the board's feet and in front of it: the spots
          // least likely to be covered by the people standing inside it.
          st.updateMatrixWorld(true);
          const half = stand ? (stand.w / 2) : 0.56;
          return [
            new THREE.Vector3(-half - 0.3, 0, 0.2), new THREE.Vector3(half + 0.3, 0, 0.2),
            new THREE.Vector3(-half * 0.5, 0, 0.55), new THREE.Vector3(half * 0.5, 0, 0.55),
          ].map((p) => hd.localToWorld(p));
        });
        store.lockMatched = lock.matched;
      }
    } else {
      rt.visible = false;
      st.visible = false;
    }
  }

  return (
    <>
      <SceneLighting preset="studio" />
      <mesh ref={reticle} rotation-x={-Math.PI / 2} renderOrder={2} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={reticleTex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={stage} visible={false}>
        <group ref={holder}>
          {board && <Board board={board} shadowTex={shadowTex} />}
          {coverObj && <CoverStand cover={coverObj} shadowTex={shadowTex} />}
        </group>
      </group>
    </>
  );
}

function Board({ board, shadowTex }: { board: BoardParts; shadowTex: THREE.Texture }) {
  const { w, h, texture, walls } = board;
  const lift = 0.018; // stands on its feet, just off the floor
  const footX = Math.max(0.12, w / 2 - 0.16);
  return (
    <group>
      {/* Contact shadow: what makes it look grounded. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0.02]} renderOrder={1}>
        <planeGeometry args={[w * 1.5, 0.9]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <group position={[0, lift, 0]}>
        {/* Front: the art itself, unlit so the event's colours print exactly. */}
        <mesh position={[0, h / 2, BOARD_DEPTH / 2 + 0.0005]} renderOrder={3}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={texture} transparent alphaTest={0.02} toneMapped={false} />
        </mesh>
        {/* Back: the board's reverse, dark, cut to the same silhouette. */}
        <mesh position={[0, h / 2, -BOARD_DEPTH / 2 - 0.0005]} rotation-y={Math.PI}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial map={texture} color="#2b2b30" alphaTest={0.5} roughness={0.7} metalness={0.05} />
        </mesh>
        {/* Sides: the silhouette swept back through the board's thickness. */}
        <mesh geometry={walls}>
          <meshStandardMaterial vertexColors roughness={0.5} metalness={0.15} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* Two brushed-metal feet. */}
      {[-footX, footX].map((x) => (
        <mesh key={x} position={[x, lift / 2, 0]}>
          <boxGeometry args={[0.07, lift, 0.42]} />
          <meshStandardMaterial color="#1c1c22" roughness={0.32} metalness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** A magazine cover standing on the floor, with the same contact shadow as a board. */
function CoverStand({ cover, shadowTex }: { cover: CoverObject; shadowTex: THREE.Texture }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0.05]} renderOrder={1}>
        <planeGeometry args={[cover.w * 1.6, 1.1]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <primitive object={cover.group} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The DOM half                                                         */
/* ------------------------------------------------------------------ */

export interface WorldStageProps {
  frameUrl: string;
  /** A magazine cover Frame: stands up as the 3D cover instead of the flat board. */
  cover?: ResolvedCover | null;
  frameName: string;
  /** Event accent colour (reticle). */
  accent: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Booth composite fps cap (0 = uncapped), same as Overlay3D. */
  maxFps: number;
  recording: boolean;
  /** Leave world mode (flip back to the selfie camera). */
  onExit: () => void;
  /** DOM id StageCanvas composites (`#id canvas`). */
  layerId?: string;
  /**
   * 8th Wall world tracking for this run (null = motion sensors). Its camera
   * is started by `onStartTap`, which runs synchronously inside the Start
   * placing tap, as iOS requires.
   */
  engine?: WorldSession | null;
  onStartTap?: () => void;
  /**
   * Start already placing, on the motion sensors: the guest tapped Start
   * placing, 8th Wall could not run, and this stage was mounted again for the
   * fallback. Without it they would see the intro card a second time.
   */
  resumePlacing?: boolean;
}

/** Ask for motion access (iPhone). MUST be the first, synchronous thing in a tap. */
function askMotionAccess(): void {
  const DOE = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as unknown as IOSPermission | undefined;
  const DME = (typeof DeviceMotionEvent !== 'undefined' ? DeviceMotionEvent : undefined) as unknown as IOSPermission | undefined;
  try { DOE?.requestPermission?.().catch(() => {}); } catch { /* not iOS */ }
  try { DME?.requestPermission?.().catch(() => {}); } catch { /* not iOS */ }
}

/** Re-render when the engine's state changes, and poll its tracking status. */
function useEngineState(engine: WorldSession | null) {
  const [, bump] = useState(0);
  const [limitedSince, setLimitedSince] = useState<number | null>(null);
  useEffect(() => {
    if (!engine) return;
    engine.onChange = () => bump((n) => n + 1);
    const t = window.setInterval(() => {
      setLimitedSince((cur) => (engine.live && engine.tracking === 'LIMITED' ? (cur ?? performance.now()) : null));
      bump((n) => n + 1);
    }, 400);
    return () => { engine.onChange = null; window.clearInterval(t); };
  }, [engine]);
  return {
    loaded: engine?.loaded ?? false,
    live: engine?.live ?? false,
    settled: engine?.settled() ?? false,
    lostTracking: limitedSince !== null && performance.now() - limitedSince > 1500,
  };
}

export default function WorldStage({
  frameUrl, cover = null, frameName, accent, videoRef, maxFps, recording, onExit, layerId = 'booth-world-layer',
  engine = null, onStartTap, resumePlacing = false,
}: WorldStageProps) {
  const resumed = resumePlacing && engine === null;
  const store = useMemo<WorldStore>(() => ({
    phase: resumed ? 'placing' : 'intro',
    gesture: createGesture(),
    history: new OrientationHistory(),
    samples: 0,
    sensors: null,
    aim: null,
    spot: new THREE.Vector3(),
    spotYaw: 0,
    onAimChange: null,
    lockMatched: 0,
    camPos: new THREE.Vector3(0, CAM_H, 0),
  }), []);
  const eng = useEngineState(engine);
  const [phase, setPhase] = useState<Phase>(resumed ? 'placing' : 'intro');
  const [sensorsOn, setSensorsOn] = useState(resumed);
  const [sensorState, setSensorState] = useState<boolean | null>(null);
  const [hasAim, setHasAim] = useState(false);
  const [boardReady, setBoardReady] = useState(false);
  const [boardFailed, setBoardFailed] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => { store.onAimChange = setHasAim; return () => { store.onAimChange = null; }; }, [store]);
  useMotionSensors(store, sensorsOn, setSensorState);
  const onBoardReady = useCallback(() => { setBoardReady(true); setBoardFailed(false); }, []);
  const onBoardError = useCallback(() => setBoardFailed(true), []);
  useEffect(() => { setBoardReady(false); }, [frameUrl, cover]);

  const go = (p: Phase) => { store.phase = p; setPhase(p); };

  // 8th Wall could not run after Start placing (the booth drops the engine):
  // carry on with the motion sensors. Motion access was already asked in the tap.
  const hadEngine = useRef(engine !== null);
  useEffect(() => {
    if (engine !== null) { hadEngine.current = true; return; }
    if (hadEngine.current && store.phase !== 'intro') setSensorsOn(true);
  }, [engine, store]);

  const start = () => {
    if (engine) {
      // First lines, synchronous: iOS only asks for camera and motion access
      // inside the tap, so 8th Wall starts here too (the guide, section 2).
      askMotionAccess();
      onStartTap?.();
      haptic('select');
      go('placing');
      return;
    }
    // First line, synchronous: iOS only asks for motion access inside the tap.
    const asked = askMotionPermission();
    haptic('select');
    go('placing');
    void asked.then((ok) => { setSensorsOn(true); if (!ok) setSensorState(false); });
  };

  const place = useCallback(() => {
    if (store.phase !== 'placing' || store.aim === null) return;
    store.spot.copy(store.aim);
    store.spotYaw = yawToFace(store.camPos, store.aim);
    haptic('success');
    go('placed');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const move = () => { haptic('select'); store.aim = null; go('placing'); };

  // Gestures: pinch = size, twist or one-finger drag = turn, tap = place.
  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    surfaceRef.current?.setPointerCapture?.(e.pointerId);
    gestureDown(store.gesture, e.pointerId, { x: e.clientX, y: e.clientY }, performance.now());
  };
  const onMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    const w = surfaceRef.current?.clientWidth ?? 360;
    gestureMove(store.gesture, e.pointerId, { x: e.clientX, y: e.clientY }, w);
  };
  const onUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (gestureUp(store.gesture, e.pointerId, performance.now())) place();
  };

  const capped = maxFps > 0;
  const settling = sensorState === null || (sensorState === true && !hasAim && store.samples < SETTLE_SAMPLES);
  const hint = boardFailed
    ? 'This frame couldn’t load. Try another one.'
    : engine
      ? (phase === 'placing'
        ? (!eng.live ? 'Starting the camera…'
          : !eng.settled ? 'Hold still a moment, finding the floor…'
            : hasAim ? 'Tap to place it. Pinch to resize.' : 'Point at the floor and move slowly')
        : phase === 'placed' && eng.lostTracking ? 'Move your phone slowly so it can see the floor again' : null)
    : phase === 'placing'
      ? (sensorState === false
        ? 'Motion sensors are off. Tap to place it in front of you.'
        : settling ? 'Hold still a moment…'
          : hasAim ? 'Tap to place it. Pinch to resize.' : 'Aim a little further away')
      : null;

  return (
    <>
      {/* Composited by StageCanvas (never shown directly), like Overlay3D. */}
      <div id={layerId} className="absolute inset-0 pointer-events-none z-20" style={{ opacity: 0 }} aria-hidden>
        <Canvas
          dpr={[1, 1.75]}
          gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
          camera={{ fov: 60, near: 0.05, far: 60, position: [0, CAM_H, 0] }}
          // R3F turns pointer events back ON for its own wrapper, which put
          // this (unseen) canvas over the gesture surface and ate every pinch,
          // twist and tap. The surface below handles all touches.
          style={{ width: '100%', height: '100%', background: 'transparent', pointerEvents: 'none' }}
          frameloop={capped ? 'never' : 'always'}
        >
          {capped && <CompositeDriver fps={maxFps} />}
          <WorldScene
            store={store}
            frameUrl={frameUrl}
            cover={cover}
            accent={accent}
            videoRef={videoRef}
            onBoardReady={onBoardReady}
            onBoardError={onBoardError}
            engine={engine}
          />
        </Canvas>
      </div>

      {/* Gesture surface: above the picture, below the booth's own controls. */}
      {phase !== 'intro' && (
        <div
          ref={surfaceRef}
          className="absolute inset-0 z-10"
          style={{ touchAction: 'none' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          aria-label={phase === 'placing' ? `Tap to place ${frameName}` : `${frameName} placed. Pinch to resize, drag to turn.`}
        />
      )}

      {/* Hint pill: the booth's own pill style, top of the stage. */}
      <div
        className="absolute inset-x-0 z-30 flex justify-center pointer-events-none"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 4.25rem)' }}
        role="status"
        aria-live="polite"
      >
        <AnimatePresence mode="wait">
          {hint && !recording && (
            <motion.div
              key={hint}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="max-w-[min(340px,calc(100%-48px))] px-4 py-2 rounded-full glass-strong border border-gold-400/25 font-sans text-[13px] text-ivory text-center"
            >
              {hint}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Place / Move: small, above the booth's deck, never over the shutter. */}
      {phase === 'placing' && !recording && (
        <div className="absolute inset-x-0 bottom-[17%] z-30 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={place}
            disabled={!hasAim || !boardReady}
            className="pointer-events-auto pressable flex min-h-14 items-center gap-2 rounded-full bg-foil glow-accent px-9 font-label text-sm uppercase tracking-luxe text-[color:var(--on-accent)] transition-all active:scale-95 disabled:opacity-40 disabled:shadow-none"
          >
            Place here
          </button>
        </div>
      )}
      {phase === 'placed' && !recording && (
        <div className="absolute right-3 bottom-[17%] z-30">
          <button
            type="button"
            onClick={move}
            aria-label={`Move ${frameName}`}
            className="pressable flex min-h-12 items-center gap-2 rounded-full glass-strong border border-gold-400/30 px-4 font-sans text-[13px] text-ivory active:scale-95"
          >
            <Move className="w-4 h-4 text-gold-300" aria-hidden />
            Move
          </button>
        </div>
      )}

      {/* Brief intro: what is about to happen (and the tap iOS needs for motion access). */}
      <AnimatePresence>
        {phase === 'intro' && (
          <motion.div
            key="world-intro"
            className="absolute inset-0 z-40 flex items-end sm:items-center justify-center p-4 pointer-events-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" aria-hidden />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="world-intro-title"
              initial={{ y: 24, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 16, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="relative w-full max-w-sm rounded-3xl glass-strong border border-gold-400/25 p-5 pb-4 text-center mb-[22%] sm:mb-0"
            >
              <StandeeGlyph />
              <h2 id="world-intro-title" className="mt-3 font-display text-xl text-ivory">Place it in your space</h2>
              <p className="mt-1.5 font-sans text-sm text-ivory/75 leading-snug">
                {frameName} becomes a life-size frame you can step into. Point at the floor, tap to place, then pinch or drag to adjust.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={start}
                  autoFocus
                  disabled={engine !== null && !eng.loaded}
                  className="pressable flex min-h-12 items-center justify-center gap-2 rounded-xl bg-foil glow-accent px-6 font-label text-xs uppercase tracking-luxe text-[color:var(--on-accent)] transition-all active:scale-95 disabled:opacity-50"
                >
                  <Hand className="w-4 h-4" aria-hidden />
                  {engine !== null && !eng.loaded ? 'Loading…' : 'Start placing'}
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="min-h-11 rounded-xl font-sans text-[13px] text-ivory/70 hover:text-ivory"
                >
                  Back to the selfie camera
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** A small standing frame on a reticle, drawn in the event's colours. */
function StandeeGlyph() {
  return (
    <div className="mx-auto h-16 w-16 relative" aria-hidden>
      <svg viewBox="0 0 64 64" className="h-full w-full">
        <ellipse cx="32" cy="54" rx="22" ry="6" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold-300/70" strokeDasharray="6 4">
          <animateTransform attributeName="transform" type="rotate" from="0 32 54" to="360 32 54" dur="9s" repeatCount="indefinite" />
        </ellipse>
        <rect x="20" y="10" width="24" height="42" rx="2.5" fill="none" stroke="currentColor" strokeWidth="3.5" className="text-gold-300" />
        <circle cx="32" cy="54" r="2.2" className="fill-current text-gold-300" />
      </svg>
    </div>
  );
}
