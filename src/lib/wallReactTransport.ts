/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallReactTransport: the wire for Live wall emoji reactions.
 *
 * The anonymous, ephemeral pattern from lib/demoBeamTransport: a Supabase
 * Realtime BROADCAST channel `wall-react:<eventSlug>`, with no auth, no table
 * and no storage. A reaction travels through the socket and evaporates. The
 * payload is only {postId, emoji}, and EVERY incoming message goes through
 * parseReactionPayload, because anyone who knows the slug can broadcast here.
 *
 * `self: false`: the sender draws its own burst locally the moment it taps,
 * so it must not get its own message back.
 *
 * Dev and tests only (`?reactlocal=1` on a dev build): a same-browser
 * BroadcastChannel, so two tabs can prove the round trip with no network.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { REACTION_EVENT, parseReactionPayload, type ReactionPayload } from './wallReactions';

export interface ReactTransport {
  /** Fire-and-forget; resolves false when the wire is not usable. */
  send(r: ReactionPayload): Promise<boolean>;
  close(): void;
}

function useLocalWire(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('reactlocal') === '1';
  } catch {
    return false;
  }
}

export function createReactTransport(eventSlug: string, onReact: (r: ReactionPayload) => void): ReactTransport {
  if (useLocalWire() && typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel(`beamwall-wall-react:${eventSlug}`);
    bc.onmessage = (e: MessageEvent) => {
      const r = parseReactionPayload(e.data);
      if (r !== null) onReact(r);
    };
    return {
      async send(r) {
        try { bc.postMessage({ postId: r.postId, emoji: r.emoji }); return true; } catch { return false; }
      },
      close() { bc.close(); },
    };
  }

  let channel: RealtimeChannel | null = null;
  let ready = false;
  try {
    channel = supabase
      .channel(`wall-react:${eventSlug}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: REACTION_EVENT }, (msg) => {
        const r = parseReactionPayload(msg.payload);
        if (r !== null) onReact(r);
      })
      .subscribe((status) => {
        ready = status === 'SUBSCRIBED';
      });
  } catch {
    // Client not configured or socket refused: reactions stay local-only.
    channel = null;
  }
  return {
    async send(r) {
      // Realtime drops anything sent before the channel subscribes. A dropped
      // reaction is harmless (the tapper still sees their burst), so do not
      // queue it; a backlog would replay late and out of context.
      if (channel === null || !ready) return false;
      try {
        const res = await channel.send({
          type: 'broadcast',
          event: REACTION_EVENT,
          payload: { postId: r.postId, emoji: r.emoji },
        });
        return res === 'ok';
      } catch {
        return false;
      }
    },
    close() {
      if (channel !== null) void supabase.removeChannel(channel); // fire-and-forget
    },
  };
}
