/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * demoBeamTransport — the wire for the landing page's cross-device demo beam.
 *
 * One interface, two implementations chosen by the channel id (demoBeam.ts):
 *  • local ids ("L…")  → the browser BroadcastChannel API. Same-browser only —
 *    lets the whole QR → phone-booth → wall flow run end-to-end in tests and
 *    dev (?beamlocal=1) without any network.
 *  • remote ids ("r…") → a Supabase Realtime broadcast channel. Ephemeral by
 *    design: no auth, no DB writes, no storage — the one downscaled shot
 *    travels through the socket and evaporates.
 *
 * Every incoming shot goes through parseShotPayload — channel ids are short,
 * so payloads are treated as untrusted regardless of source.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { fitWithin, isLocalChannel, makeShotPayload, parseShotPayload } from './demoBeam';

export type BeamTransportStatus = 'connecting' | 'ready' | 'error';

export interface BeamTransport {
  /** Broadcast a captured shot (data URL). Resolves false on failure. */
  sendShot(shot: string): Promise<boolean>;
  /** Announce "a phone joined this channel" (drives the QR panel state). */
  sendHello(): void;
  onShot(cb: (shot: string) => void): void;
  onHello(cb: () => void): void;
  /** Fires immediately with the current status, then on every change. */
  onStatus(cb: (status: BeamTransportStatus) => void): void;
  close(): void;
}

/** Shared listener plumbing for both transports. */
function makeHub() {
  const shotCbs: Array<(shot: string) => void> = [];
  const helloCbs: Array<() => void> = [];
  const statusCbs: Array<(s: BeamTransportStatus) => void> = [];
  let status: BeamTransportStatus = 'connecting';
  return {
    shotCbs,
    helloCbs,
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

function createLocalTransport(channelId: string): BeamTransport {
  const hub = makeHub();
  const bc = new BroadcastChannel(`beamwall-demo:${channelId}`);
  bc.onmessage = (e: MessageEvent) => {
    const msg = e.data as { event?: string; payload?: unknown } | null;
    if (msg === null || typeof msg !== 'object') return;
    if (msg.event === 'shot') hub.emitShot(msg.payload);
    if (msg.event === 'hello') hub.emitHello();
  };
  // BroadcastChannel has no handshake — it is ready as soon as it exists.
  queueMicrotask(() => hub.setStatus('ready'));
  return {
    async sendShot(shot) {
      try {
        bc.postMessage({ event: 'shot', payload: makeShotPayload(shot) });
        return true;
      } catch {
        return false; // e.g. message too large for the structured clone
      }
    },
    sendHello() {
      try { bc.postMessage({ event: 'hello' }); } catch { /* non-fatal */ }
    },
    onShot(cb) { hub.shotCbs.push(cb); },
    onHello(cb) { hub.helloCbs.push(cb); },
    onStatus(cb) { hub.onStatus(cb); },
    close() { bc.close(); },
  };
}

function createSupabaseTransport(channelId: string): BeamTransport {
  const hub = makeHub();
  let channel: RealtimeChannel | null = null;
  try {
    channel = supabase
      .channel(`demo-beam:${channelId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'shot' }, (msg) => hub.emitShot(msg.payload))
      .on('broadcast', { event: 'hello' }, () => hub.emitHello())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') hub.setStatus('ready');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') hub.setStatus('error');
      });
  } catch {
    // Client not configured / socket refused — the demo degrades to local-only.
    queueMicrotask(() => hub.setStatus('error'));
  }
  return {
    async sendShot(shot) {
      if (channel === null) return false;
      try {
        const res = await channel.send({ type: 'broadcast', event: 'shot', payload: makeShotPayload(shot) });
        return res === 'ok';
      } catch {
        return false;
      }
    },
    sendHello() {
      void channel?.send({ type: 'broadcast', event: 'hello', payload: {} }).catch(() => { /* non-fatal */ });
    },
    onShot(cb) { hub.shotCbs.push(cb); },
    onHello(cb) { hub.helloCbs.push(cb); },
    onStatus(cb) { hub.onStatus(cb); },
    close() {
      if (channel !== null) void supabase.removeChannel(channel);
    },
  };
}

export function createBeamTransport(channelId: string): BeamTransport {
  return isLocalChannel(channelId) ? createLocalTransport(channelId) : createSupabaseTransport(channelId);
}

/**
 * Downscale a captured shot for the broadcast wire (~540px JPEG ≈ 40-80KB).
 * Returns the original data URL when it is already small enough or when
 * decoding/encoding fails (the payload size cap still applies at send time).
 */
export function downscaleShot(dataUrl: string, maxW = 540, maxH = 960): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxW, maxH);
        if (width === 0 || height === 0 || (width === img.naturalWidth && height === img.naturalHeight)) {
          resolve(dataUrl);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
