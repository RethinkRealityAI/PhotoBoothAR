/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * demoBeam — pure helpers for the landing page's cross-device demo beam:
 * a visitor scans a QR code on the desktop landing page, their phone becomes
 * the booth (/beam/:channelId), and the captured shot is broadcast to the
 * desktop's live wall over an ephemeral channel (no DB writes, no storage).
 *
 * Everything here is DOM-free and node-testable. The transport itself
 * (Supabase Realtime broadcast, or a same-browser BroadcastChannel used by
 * tests/dev) lives in demoBeamTransport.ts.
 *
 * Channel ids starting with "L" select the LOCAL BroadcastChannel transport —
 * the landing page mints one when loaded with ?beamlocal=1 so the whole flow
 * can be end-to-end tested in one browser without touching Supabase.
 */

/** Payload version — bump if the shape ever changes. */
export const BEAM_PAYLOAD_V = 1;

/** Hard ceiling for a shot data URL travelling over broadcast (bytes of the
 *  string). Realtime messages should stay well under the service limits; the
 *  phone page downscales to ~540px JPEG which lands far below this. */
export const MAX_SHOT_CHARS = 400_000;

export interface BeamShotPayload {
  v: typeof BEAM_PAYLOAD_V;
  shot: string;
}

/** Mint a channel id. `local` selects the BroadcastChannel transport. */
export function makeBeamChannelId(local: boolean): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return `${local ? 'L' : 'r'}${rand}`;
}

export function isLocalChannel(channelId: string): boolean {
  return channelId.startsWith('L');
}

/** True for ids this app could have minted — everything else is rejected
 *  before a channel name is derived from URL input. */
export function isValidChannelId(channelId: string): boolean {
  return /^[Lr][0-9a-f]{10}$/.test(channelId);
}

/** Path of the phone booth page for a channel (origin-relative). */
export function beamPagePath(channelId: string): string {
  return `/beam/${channelId}`;
}

/** Fit w×h inside maxW×maxH preserving aspect; never upscales. */
export function fitWithin(
  w: number,
  h: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function makeShotPayload(shot: string): BeamShotPayload {
  return { v: BEAM_PAYLOAD_V, shot };
}

/**
 * Validate an incoming broadcast payload and return the shot data URL, or
 * null. Guards: shape, version, an actual image data URL, and a size cap —
 * the channel id is guessable in principle, so never trust the payload.
 */
export function parseShotPayload(x: unknown): string | null {
  if (typeof x !== 'object' || x === null) return null;
  const p = x as Record<string, unknown>;
  if (p.v !== BEAM_PAYLOAD_V) return null;
  const shot = p.shot;
  if (typeof shot !== 'string') return null;
  if (!shot.startsWith('data:image/')) return null;
  if (shot.length === 0 || shot.length > MAX_SHOT_CHARS) return null;
  return shot;
}

export type BeamTransportStatus = 'connecting' | 'ready' | 'error';

/**
 * Shared listener plumbing for both beam transports — DOM-free so the ready /
 * ack logic that decides whether a guest is told the truth about their beam is
 * unit-testable in node. (It cannot live in demoBeamTransport.ts and be tested:
 * that module imports the Supabase client, which throws without env vars, so a
 * colocated test would fail to even collect.)
 */
export function createBeamHub() {
  const shotCbs: Array<(shot: string) => void> = [];
  const helloCbs: Array<() => void> = [];
  const ackCbs: Array<() => void> = [];
  const statusCbs: Array<(s: BeamTransportStatus) => void> = [];
  let status: BeamTransportStatus = 'connecting';
  return {
    shotCbs,
    helloCbs,
    ackCbs,
    emitAck() {
      ackCbs.forEach((cb) => cb());
    },
    /** Resolve once the wire is usable; false on error or timeout. */
    whenReady(timeoutMs: number): Promise<boolean> {
      if (status === 'ready') return Promise.resolve(true);
      if (status === 'error') return Promise.resolve(false);
      return new Promise((resolve) => {
        let settled = false;
        const done = (v: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(v);
        };
        const timer = setTimeout(() => done(false), timeoutMs);
        statusCbs.push((s) => {
          if (s === 'ready') done(true);
          else if (s === 'error') done(false);
        });
      });
    },
    emitShot(payload: unknown) {
      const shot = parseShotPayload(payload);
      if (shot !== null) shotCbs.forEach((cb) => cb(shot));
    },
    emitHello() {
      helloCbs.forEach((cb) => cb());
    },
    setStatus(s: BeamTransportStatus) {
      status = s;
      statusCbs.forEach((cb) => cb(s));
    },
    onStatus(cb: (s: BeamTransportStatus) => void) {
      statusCbs.push(cb);
      cb(status);
    },
  };
}

