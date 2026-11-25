/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI access — may the signed-in user see host-facing AI tools?
 *
 * The owner's platform switch (migration 054, `platform_settings.ai_for_hosts`)
 * decides: OFF = platform admins only, ON = every host (still subject to their
 * plan's `aiStudio` flag and credits). The DATABASE is the authority —
 * `ai_allowed_for` is called by ai-generate-image, ai-generate-3d and
 * ai-event-designer, which refuse with `403 ai_disabled`. What lives here is
 * only the browser's copy of the answer so the buttons, pages and links that
 * lead to those tools are HIDDEN instead of failing when pressed.
 *
 * Fails CLOSED: until the answer arrives, and whenever the read fails, the
 * value is not `true`, so AI entry points stay hidden. (Opposite of the
 * Studio's fail-open sales gate on purpose: showing a host a tool that the
 * server then refuses is the worse experience.)
 */
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase';

/** `null` = not known yet. Only `true` shows AI. */
export type AiAccess = boolean | null;

/** The RPC's answer → access. Anything but a literal `true` (an error, a
 *  null, a string) is "no". Exported for the test. */
export function aiAccessFromRpc(data: unknown, error: unknown): boolean {
  if (error !== null && error !== undefined) return false;
  return data === true;
}

let value: AiAccess = null;
let inflight: Promise<void> | null = null;
let authHooked = false;
const listeners = new Set<() => void>();

function set(next: AiAccess) {
  if (next === value) return;
  value = next;
  listeners.forEach((l) => l());
}

async function load(): Promise<void> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) { set(false); return; }
    const { data, error } = await supabase.rpc('my_ai_access');
    if (error) console.error('[aiAccess] my_ai_access', error);
    set(aiAccessFromRpc(data, error));
  } catch (e) {
    console.error('[aiAccess] my_ai_access threw', e);
    set(false);
  }
}

/** Re-read the switch (after sign-in/out, or after an admin flips it). */
export function refreshAiAccess(): Promise<void> {
  inflight = load().finally(() => { inflight = null; });
  return inflight;
}

function ensureLoaded() {
  if (!authHooked) {
    authHooked = true;
    // A different user may sign in on the same tab: never carry the previous
    // user's answer over.
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        set(null);
        void refreshAiAccess();
      }
    });
  }
  if (value === null && inflight === null) void refreshAiAccess();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The current answer; re-renders when it changes. */
export function useAiAccess(): AiAccess {
  useEffect(ensureLoaded, []);
  return useSyncExternalStore(subscribe, () => value, () => null);
}

/** One-shot read for non-React code. */
export async function getAiAccess(): Promise<boolean> {
  ensureLoaded();
  if (inflight) await inflight;
  return value === true;
}
