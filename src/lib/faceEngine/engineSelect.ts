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

export type ModeSource = 'legacy' | 'url' | 'config' | 'env' | 'default' | 'default-hybrid';

export interface ModeInputs {
  /** Frozen single-event build or a coded (non-db) event. */
  legacy: boolean;
  /** The URL/session override, raw (validated here). */
  url?: unknown;
  /** The selected experience's `config.tracking`, raw (validated here). */
  config?: unknown;
  /** `import.meta.env.VITE_FACE_ENGINE`, raw (validated here). */
  env?: unknown;
  /** The active filter carries a face-expression trigger. */
  hasFaceTriggers?: boolean;
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
 *  or a faceEngine override remembered for this tab (which only a URL can set). */
export function trackingReadoutEnabled(search: string, store: SessionStore | null): boolean {
  try {
    const p = new URLSearchParams(search);
    if (p.has(TRACK_DEBUG_URL_PARAM) || p.has(FACE_ENGINE_URL_PARAM)) return true;
  } catch {
    /* fall through */
  }
  try {
    return parseFaceTrackingMode(store?.getItem(FACE_ENGINE_SESSION_KEY) ?? null) !== null;
  } catch {
    return false;
  }
}
