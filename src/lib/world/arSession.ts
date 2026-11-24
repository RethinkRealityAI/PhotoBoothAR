/**
 * World mode as its own booth page load (see xr8World.ts for why), plus the
 * guide's settle gate. Pure, so it is unit-tested in node.
 */

/** The query key that opens the booth in world mode: `?ar=<frameId>`. */
export const AR_PARAM = 'ar';
/** Set when coming back from world mode, so the "Step inside" splash is skipped. */
export const CAMERA_ON_PARAM = 'cam';

/** The frame id to stand up, or null for the normal booth. */
export function arFrameIdFrom(search: string): string | null {
  const v = new URLSearchParams(search).get(AR_PARAM);
  return v && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : null;
}

/** `?wtrack=sensors|xr8` (tester override), else the build default. */
export function worldTrackerFrom(search: string, buildDefault: string | undefined): 'xr8' | 'sensors' {
  const q = new URLSearchParams(search).get('wtrack');
  if (q === 'xr8' || q === 'sensors') return q;
  return buildDefault === 'sensors' ? 'sensors' : 'xr8';
}

/** The booth URL that opens world mode for this frame (keeps tester params). */
export function enterArUrl(basePath: string, search: string, frameId: string): string {
  const p = new URLSearchParams(search);
  p.set(AR_PARAM, frameId);
  p.delete(CAMERA_ON_PARAM);
  return `${basePath}/booth?${p.toString()}`;
}

/** The normal booth URL after leaving world mode, with `lookId` applied (or none). */
export function leaveArUrl(basePath: string, search: string, lookId: string | null): string {
  const p = new URLSearchParams(search);
  p.delete(AR_PARAM);
  p.set(CAMERA_ON_PARAM, '1');
  const path = lookId ? `${basePath}/experience/${encodeURIComponent(lookId)}` : `${basePath}/booth`;
  return `${path}?${p.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Settle gate (the guide, section 5)                                   */
/* ------------------------------------------------------------------ */
// Never allow Place until SLAM has settled: tracking NORMAL for 1.2 s, no frame
// stall (> 250 ms) in the last second, and 1.5 s since this run started. It
// LATCHES once per run, so a small later stall never flicks Place off.

export const SETTLE_NORMAL_MS = 1200;
export const SETTLE_STALL_MS = 250;
export const SETTLE_STALL_WINDOW_MS = 1000;
export const SETTLE_MIN_RUN_MS = 1500;

export interface SettleGate {
  startedMs: number;
  normalSinceMs: number | null;
  lastStallMs: number | null;
  latched: boolean;
}

export function createSettleGate(): SettleGate {
  return { startedMs: Number.NaN, normalSinceMs: null, lastStallMs: null, latched: false };
}

/** A new run (camera up, recenter, restart): settle again from scratch. */
export function settleRestart(_g: SettleGate, now: number): SettleGate {
  return { startedMs: now, normalSinceMs: null, lastStallMs: null, latched: false };
}

export function settleStep(g: SettleGate, now: number, normal: boolean, frameGapMs: number): SettleGate {
  if (g.latched || !Number.isFinite(g.startedMs)) return g;
  const lastStallMs = frameGapMs > SETTLE_STALL_MS ? now : g.lastStallMs;
  const normalSinceMs = normal ? (g.normalSinceMs ?? now) : null;
  const latched = normalSinceMs !== null
    && now - normalSinceMs >= SETTLE_NORMAL_MS
    && (lastStallMs === null || now - lastStallMs >= SETTLE_STALL_WINDOW_MS)
    && now - g.startedMs >= SETTLE_MIN_RUN_MS;
  return { startedMs: g.startedMs, normalSinceMs, lastStallMs, latched };
}

export function isSettled(g: SettleGate): boolean {
  return g.latched;
}

/* ------------------------------------------------------------------ */
/* The switch screen between the two booths                            */
/* ------------------------------------------------------------------ */
// Going in or out of world mode is a page load (two 8th Wall engines can't
// share a page). The leaving page writes a note to sessionStorage; index.html
// paints a plain switch screen from it before any JS loads, and the arriving
// booth shows the full one until it is ready, so the guest never sees a blank.

export const AR_SWITCH_KEY = 'bw.arSwitch';
/** A note older than this is stale (a reload much later): ignore it. */
export const AR_SWITCH_FRESH_MS = 15000;

export type ArSwitchDir = 'enter' | 'leave';
export interface ArSwitchNote { dir: ArSwitchDir; accent: string; t: number }

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** The note to store; the accent falls back when it is not a plain hex colour. */
export function arSwitchNote(dir: ArSwitchDir, accent: string, now: number): string {
  return JSON.stringify({ dir, accent: HEX.test(accent) ? accent : '#8f8cf5', t: now });
}

/** The stored note, or null when missing, malformed or stale. */
export function readArSwitchNote(raw: string | null, now: number): ArSwitchNote | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<ArSwitchNote>;
    if ((o.dir !== 'enter' && o.dir !== 'leave') || typeof o.t !== 'number') return null;
    if (now - o.t < 0 || now - o.t > AR_SWITCH_FRESH_MS) return null;
    return { dir: o.dir, accent: typeof o.accent === 'string' && HEX.test(o.accent) ? o.accent : '#8f8cf5', t: o.t };
  } catch {
    return null;
  }
}

/** Which way a booth URL goes: into world mode or out of it. */
export function arSwitchDirFor(url: string): ArSwitchDir {
  const q = url.indexOf('?');
  return arFrameIdFrom(q >= 0 ? url.slice(q) : '') !== null ? 'enter' : 'leave';
}

export function arSwitchCopy(dir: ArSwitchDir): { title: string; sub: string } {
  return dir === 'enter'
    ? { title: 'Switching to AR mode', sub: 'Getting your space ready' }
    : { title: 'Back to the booth', sub: 'Turning the selfie camera on' };
}
