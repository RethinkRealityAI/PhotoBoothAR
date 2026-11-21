/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which face-tracking engine a surface should run — PURE (no DOM, no engine
 * import), so the whole policy is unit-tested in node.
 *
 * Resolution, highest wins:
 *   1. LEGACY (a VITE_EVENT build, or a coded `source !== 'db'` event) →
 *      'mediapipe', ALWAYS. Those frozen sites must render byte-identically and
 *      never download 8th Wall, so nothing below can override them.
 *   2. URL `?faceEngine=mediapipe|xr8|hybrid` (remembered for the tab in
 *      sessionStorage). This is a phone-testing switch, NOT an entitlement —
 *      every mode is free and available to every event, so a guest typing it
 *      grants them nothing. That is why it is acceptable here when CLAUDE.md
 *      records flag-overriding URL params as refused elsewhere (FeaturePreview:
 *      a URL that overrides a PAID flag is a privilege escalation; this is not).
 *   3. The selected experience's `config.tracking`.
 *   4. Build-time `VITE_FACE_ENGINE`.
 *   5. Built-in default: 'xr8' on the platform (owner, 2026-11-16: "make
 *      EighthWall the platform default"), auto-upgraded to 'hybrid' when the
 *      active filter has a FACE-expression trigger so smile/wink/… keep
 *      MediaPipe's real blendshape scores. An EXPLICIT 'xr8' (URL/config/env)
 *      is honoured as-is.
 *
 * FACE PAINT (requiresFaceMesh): the paint lives on 8th Wall's face MESH, which
 * MediaPipe mode does not produce. So a scene with face paint lifts any
 * config/env/default result that would not run 8th Wall to 'xr8' ('hybrid'
 * when it also has face-expression triggers). It never overrides LEGACY (those
 * sites never load 8th Wall) or the URL (the tester's switch — that is how the
 * honest no-paint fallback gets checked).
 */
import type { FaceTrackingMode } from './types';
import { FACE_TRIGGER_SOURCES } from '../studio/triggers';

export const FACE_TRACKING_MODES: readonly FaceTrackingMode[] = ['mediapipe', 'xr8', 'hybrid'];

/** sessionStorage key that remembers a URL override for the tab. */
export const FACE_ENGINE_SESSION_KEY = 'pbar.faceEngine';
export const FACE_ENGINE_URL_PARAM = 'faceEngine';
export const TRACK_DEBUG_URL_PARAM = 'trackdebug';

/** Untrusted input (jsonb, URL, env) → a mode, or null when it is not one. */
export function parseFaceTrackingMode(input: unknown): FaceTrackingMode | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  return (FACE_TRACKING_MODES as readonly string[]).includes(v) ? (v as FaceTrackingMode) : null;
}

/** Does this trigger set listen to a face expression (smile/mouthOpen/wink/browRaise)? */
export function hasFaceExpressionTrigger(triggers: readonly { source: string }[] | null | undefined): boolean {
  if (!triggers) return false;
  return triggers.some((t) => (FACE_TRIGGER_SOURCES as readonly string[]).includes(t.source));
}

/**
 * Expression sources 8th Wall's own mesh scores well enough to drive a trigger
 * (xr8Expressions.ts: smile and jawOpen are FITTED against MediaPipe on real
 * clips). `wink` and `browRaise` are extrapolated there (no closed-eye or
 * raised-brow footage existed), so they still bring MediaPipe along.
 */
export const XR8_CALIBRATED_SOURCES: readonly string[] = ['smile', 'mouthOpen'];

/**
 * Does this trigger set need MediaPipe's blendshapes beside 8th Wall (= hybrid)?
 * Only for a face expression 8th Wall is not calibrated for. Running both
 * engines costs tracking rate (measured headless: 9.7 -> 6.5-7 poses/s), so a
 * smile / open-mouth filter stays on plain 8th Wall.
 */
export function needsMediapipeExpressions(triggers: readonly { source: string }[] | null | undefined): boolean {
  if (!triggers) return false;
  return triggers.some(
    (t) => (FACE_TRIGGER_SOURCES as readonly string[]).includes(t.source) && !XR8_CALIBRATED_SOURCES.includes(t.source),
  );
}

export type ModeSource = 'legacy' | 'url' | 'config' | 'env' | 'default' | 'default-hybrid' | 'face-paint';

export interface ModeInputs {
  /** Frozen single-event build or a coded (non-db) event. */
  legacy: boolean;
  /** The URL/session override, raw (validated here). */
  url?: unknown;
  /** The selected experience's `config.tracking`, raw (validated here). */
  config?: unknown;
  /** `import.meta.env.VITE_FACE_ENGINE`, raw (validated here). */
  env?: unknown;
  /** The active filter carries a face-expression trigger 8th Wall cannot score
   *  itself (needsMediapipeExpressions). */
  hasFaceTriggers?: boolean;
  /** The active scene paints on the face mesh (Living Face Paint). */
  requiresFaceMesh?: boolean;
}

export interface ResolvedMode {
  mode: FaceTrackingMode;
  source: ModeSource;
}

export function builtinDefaultMode(legacy: boolean): FaceTrackingMode {
  return legacy ? 'mediapipe' : 'xr8';
}

export function resolveFaceTrackingMode(inp: ModeInputs): ResolvedMode {
  if (inp.legacy) return { mode: 'mediapipe', source: 'legacy' };
  const url = parseFaceTrackingMode(inp.url);
  if (url !== null) return { mode: url, source: 'url' };
  const r = resolveBelowUrl(inp);
  if (inp.requiresFaceMesh === true && !modeNeedsXr8(r.mode)) {
    return { mode: inp.hasFaceTriggers === true ? 'hybrid' : 'xr8', source: 'face-paint' };
  }
  return r;
}

/** Steps 3-5 (config → env → built-in default), before the face-mesh lift. */
function resolveBelowUrl(inp: ModeInputs): ResolvedMode {
  const cfg = parseFaceTrackingMode(inp.config);
  if (cfg !== null) return { mode: cfg, source: 'config' };
  const env = parseFaceTrackingMode(inp.env);
  if (env !== null) return { mode: env, source: 'env' };
  const def = builtinDefaultMode(false);
  if (def === 'xr8' && inp.hasFaceTriggers === true) return { mode: 'hybrid', source: 'default-hybrid' };
  return { mode: def, source: 'default' };
}

/**
 * What runs when `mode` cannot start. Both 8th Wall modes fall back to plain
 * MediaPipe (pose AND blendshapes from one engine — today's path); MediaPipe
 * itself has nothing below it (null = the tracker is genuinely unavailable).
 */
export function fallbackModeFor(mode: FaceTrackingMode): FaceTrackingMode | null {
  return mode === 'mediapipe' ? null : 'mediapipe';
}

/** Does `mode` need the 8th Wall engine / the MediaPipe landmarker? */
export function modeNeedsXr8(mode: FaceTrackingMode): boolean {
  return mode === 'xr8' || mode === 'hybrid';
}
export function modeNeedsMediapipe(mode: FaceTrackingMode): boolean {
  return mode === 'mediapipe' || mode === 'hybrid';
}

/** The slice of Storage this module touches (sessionStorage in the app). */
export type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Read the URL override from a `location.search` string, remembering a VALID
 * one for the tab so an in-app navigation that drops the query keeps it. An
 * invalid value is ignored (and never stored). Absent from the URL → the
 * remembered value, if any. Every storage access is guarded: private mode /
 * blocked storage must never break the booth.
 */
export function readFaceEngineOverride(search: string, store: SessionStore | null): FaceTrackingMode | null {
  let fromUrl: FaceTrackingMode | null = null;
  try {
    fromUrl = parseFaceTrackingMode(new URLSearchParams(search).get(FACE_ENGINE_URL_PARAM));
  } catch {
    fromUrl = null;
  }
  if (fromUrl !== null) {
    try {
      store?.setItem(FACE_ENGINE_SESSION_KEY, fromUrl);
    } catch {
      /* storage blocked — the override still applies to this page load */
    }
    return fromUrl;
  }
  try {
    return parseFaceTrackingMode(store?.getItem(FACE_ENGINE_SESSION_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Show the tracking readout? Only for testers: `?trackdebug`, `?faceEngine=…`,
 *  `?framelock=…`, or an override remembered for this tab (only a URL sets one). */
export function trackingReadoutEnabled(search: string, store: SessionStore | null): boolean {
  try {
    const p = new URLSearchParams(search);
    if (p.has(TRACK_DEBUG_URL_PARAM) || p.has(FACE_ENGINE_URL_PARAM) || p.has(FRAME_LOCK_URL_PARAM)) return true;
  } catch {
    /* fall through */
  }
  try {
    if (parseFaceTrackingMode(store?.getItem(FACE_ENGINE_SESSION_KEY) ?? null) !== null) return true;
    return parseFrameLock(store?.getItem(FRAME_LOCK_SESSION_KEY) ?? null) !== null;
  } catch {
    return false;
  }
}

/* ── Frame-lock ──────────────────────────────────────────────────────────────
 * With frame-lock ON the compositor draws the camera frame the pose was computed
 * FROM (the engine's getAnalysedFrame()) instead of the newest <video> frame, so
 * the AR layer and the image are the same instant and tracker latency never
 * shows as the prop slipping off a moving face. The preview then updates at the
 * tracker rate — exactly how native 8th Wall behaves.
 *
 * Resolution, highest wins:
 *   1. LEGACY → OFF, always (their photos must stay byte-identical).
 *   2. URL `?framelock=0|1` (remembered per tab) — a phone A/B switch, grants
 *      nothing (every event gets the same pixels either way, just in step).
 *   3. 8th Wall pose ('xr8' / 'hybrid') → ON: its ~130ms pipeline lag is the
 *      reason this exists.
 *   4. MediaPipe pose → FRAME_LOCK_MEDIAPIPE_DEFAULT — one constant to flip once
 *      phone numbers say whether a tracker-rate preview is worth the steadier prop.
 */
export const FRAME_LOCK_SESSION_KEY = 'pbar.frameLock';
export const FRAME_LOCK_URL_PARAM = 'framelock';
export const FRAME_LOCK_MEDIAPIPE_DEFAULT = false;

/** Untrusted '1'/'0'/'true'/'false'/'on'/'off' → boolean, else null. */
export function parseFrameLock(input: unknown): boolean | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'off') return false;
  return null;
}

/** `?framelock=` override (remembered for the tab, like readFaceEngineOverride). */
export function readFrameLockOverride(search: string, store: SessionStore | null): boolean | null {
  let fromUrl: boolean | null = null;
  try {
    fromUrl = parseFrameLock(new URLSearchParams(search).get(FRAME_LOCK_URL_PARAM));
  } catch {
    fromUrl = null;
  }
  if (fromUrl !== null) {
    try {
      store?.setItem(FRAME_LOCK_SESSION_KEY, fromUrl ? '1' : '0');
    } catch {
      /* storage blocked — the override still applies to this page load */
    }
    return fromUrl;
  }
  try {
    return parseFrameLock(store?.getItem(FRAME_LOCK_SESSION_KEY) ?? null);
  } catch {
    return null;
  }
}

export type FrameLockSource = 'legacy' | 'url' | 'xr8' | 'mediapipe-default';

export interface ResolvedFrameLock {
  on: boolean;
  source: FrameLockSource;
}

/** `mode` = the mode producing poses NOW (after any fallback), not the one asked for. */
export function resolveFrameLock(inp: { legacy: boolean; mode: FaceTrackingMode; url?: boolean | null }): ResolvedFrameLock {
  if (inp.legacy) return { on: false, source: 'legacy' };
  if (inp.url === true || inp.url === false) return { on: inp.url, source: 'url' };
  if (modeNeedsXr8(inp.mode)) return { on: true, source: 'xr8' };
  return { on: FRAME_LOCK_MEDIAPIPE_DEFAULT, source: 'mediapipe-default' };
}
