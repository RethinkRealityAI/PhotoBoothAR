/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimum-viable client error telemetry. reportError() fire-and-forgets a row
 * into the write-only `client_errors` table (migration 015: anon+authenticated
 * INSERT-only; platform admins read). Designed to be safe to call from global
 * error handlers:
 *   - never throws (all failures swallowed);
 *   - re-entrancy guard so an error thrown while reporting can't loop;
 *   - max MAX_REPORTS_PER_SESSION rows per page session;
 *   - identical messages deduped within DEDUPE_WINDOW_MS;
 *   - message/stack truncated client-side (the table has no server-side caps).
 */
import { supabase } from './supabase';

/** Support address actually in use (matches Legal.tsx CONTACT). */
export const SUPPORT_EMAIL = 'dapo@rethinkreality.ai';

const MAX_MESSAGE_CHARS = 2_000;
const MAX_STACK_CHARS = 8_000;
const MAX_REPORTS_PER_SESSION = 10;
const DEDUPE_WINDOW_MS = 5 * 60 * 1_000; // 5 min

/** Optional build tag; '' (unset) is treated as absent. */
const appVersion =
  ((import.meta.env.VITE_APP_VERSION as string | undefined) ?? '').trim() || null;

/** Random per-page-load session id (telemetry correlation only, no auth). */
const sessionId: string = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
})();

let sentCount = 0;
let reporting = false; // re-entrancy guard: errors raised while reporting are dropped
const lastSentAtMs = new Map<string, number>(); // message -> Date.now() ms

/**
 * Report an error to `client_errors`. Fire-and-forget: never throws, never
 * rejects, rate-limits itself. Safe from ErrorBoundary and window handlers.
 */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (reporting) return;
  reporting = true;
  try {
    if (sentCount >= MAX_REPORTS_PER_SESSION) return;

    const message = (
      err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    ).slice(0, MAX_MESSAGE_CHARS);
    const stack =
      err instanceof Error && err.stack ? err.stack.slice(0, MAX_STACK_CHARS) : null;

    // Dedupe: identical message within the window is dropped.
    const nowMs = Date.now();
    const lastMs = lastSentAtMs.get(message);
    if (lastMs !== undefined && nowMs - lastMs < DEDUPE_WINDOW_MS) return;
    lastSentAtMs.set(message, nowMs);
    sentCount += 1;

    // fire-and-forget: supabase-js builders are thenables; both callbacks are
    // no-ops so nothing can reject into unhandledrejection and loop back here.
    supabase
      .from('client_errors')
      .insert({
        session_id: sessionId,
        url: window.location.href.slice(0, 500),
        message,
        stack,
        user_agent: navigator.userAgent.slice(0, 400),
        context: {
          ...context,
          appVersion,
          mode: import.meta.env.MODE,
        },
      })
      .then(
        () => {},
        () => {},
      );
  } catch {
    // Telemetry must never break the app.
  } finally {
    reporting = false;
  }
}
