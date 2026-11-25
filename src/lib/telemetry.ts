/**
 * Product telemetry: PostHog (session replay, error tracking, per-user /
 * per-event / per-device timelines) with the Supabase `client_errors` table as
 * the always-on fallback that needs no account and no key.
 *
 *   track(name, props)          → a breadcrumb (rides every later client_errors
 *                                 row) + a PostHog event when PostHog is on.
 *   reportIncident(name, props) → track() + a client_errors row, for the things
 *                                 we must be able to find even with PostHog off
 *                                 or blocked (camera stuck dark, flapping…).
 *
 * PostHog only loads when VITE_POSTHOG_KEY is set, never on the frozen legacy
 * single-event builds (VITE_EVENT), and only via a dynamic import, so the
 * entry bundle does not grow and a blocked/failed load changes nothing.
 *
 * PRIVACY (guests are at someone else's party and never signed up):
 *   - replays BLOCK every <video> and <canvas> (the camera, the AR stage) and
 *     every guest photo (blob:/data: images and anything from storage), and
 *     mask every input; the live wall (a projector, hours long, all guest
 *     photos) never records at all;
 *   - guests stay anonymous (person_profiles: 'identified_only'); only signed-in
 *     hosts/admins are identified, by their account id + email;
 *   - URLs are redacted (Supabase puts session tokens in the #fragment) and
 *     PostHog does not start while a token is still in the address bar.
 */
import type { PostHog } from 'posthog-js';
import { redactUrl } from './supportModel';
import {
  addBreadcrumb, routeContext, setExceptionForwarder, setTelemetryContext,
  deviceFacts, type RouteContext,
} from './telemetryCore';
import { reportError, telemetrySessionId } from './errorReport';

const KEY = ((import.meta.env.VITE_POSTHOG_KEY as string | undefined) ?? '').trim();
/** Same-origin reverse proxy (netlify.toml /ingest) so ad blockers don't eat
 *  the events; override for local dev against PostHog directly. */
const HOST = ((import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? '').trim() || '/ingest';
const UI_HOST = ((import.meta.env.VITE_POSTHOG_UI_HOST as string | undefined) ?? '').trim() || 'https://us.posthog.com';
const REPLAY_OFF = ((import.meta.env.VITE_POSTHOG_REPLAY as string | undefined) ?? '').trim() === 'off';
const LEGACY = Boolean(((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim());
const APP_VERSION = ((import.meta.env.VITE_APP_VERSION as string | undefined) ?? '').trim() || null;

/** Every guest photo/video and the live camera, kept out of replays. */
export const REPLAY_BLOCK_SELECTOR = [
  'video', 'canvas',
  'img[src^="blob:"]', 'img[src^="data:"]',
  'img[src*="/storage/v1/object/"]',
  '[data-ph-block]',
].join(', ');

/** Surfaces whose replays are never recorded. */
const NO_REPLAY_SURFACES = new Set(['wall']);

let ph: PostHog | null = null;
let started = false;
const queue: Array<[string, Record<string, unknown> | undefined]> = [];
const MAX_QUEUE = 100;
let lastRoute: RouteContext | null = null;
/** The user to identify once PostHog is up (setUser can run before it loads). */
let pendingUser: { id: string; email?: string | null } | null = null;
let identifiedAs: string | null = null;
/** We paused recording for a no-replay surface (so leaving it resumes). */
let pausedForSurface = false;

export function telemetryEnabled(): boolean {
  return !LEGACY && KEY !== '';
}

/** Record something that happened. Never throws. */
export function track(name: string, props?: Record<string, unknown>): void {
  try {
    addBreadcrumb(name, props);
    if (!telemetryEnabled()) return;
    if (ph) ph.capture(name, props ?? {});
    else if (queue.length < MAX_QUEUE) queue.push([name, props]);
  } catch { /* telemetry must never break the app */ }
}

/** track() + a client_errors row, so the incident is findable without PostHog. */
export function reportIncident(name: string, props?: Record<string, unknown>): void {
  track(name, props);
  try {
    const err = new Error(name);
    err.name = 'BoothIncident';
    err.stack = undefined;
    reportError(err, { kind: 'incident', ...props });
  } catch { /* never */ }
}

/** Route changes: surface + event slug ride every later event and error row. */
export function setRoute(pathname: string): void {
  try {
    const ctx = routeContext(pathname);
    if (lastRoute && lastRoute.surface === ctx.surface && lastRoute.eventSlug === ctx.eventSlug) return;
    lastRoute = ctx;
    setTelemetryContext({ surface: ctx.surface, event_slug: ctx.eventSlug ?? undefined });
    addBreadcrumb('route', { surface: ctx.surface, event: ctx.eventSlug });
    if (!ph) return;
    ph.register({ surface: ctx.surface, event_slug: ctx.eventSlug });
    applyReplayForSurface(ph, ctx.surface);
  } catch { /* never */ }
}

function applyReplayForSurface(inst: PostHog, surface: string): void {
  if (REPLAY_OFF) return;
  if (NO_REPLAY_SURFACES.has(surface)) {
    if (!pausedForSurface) { inst.stopSessionRecording(); pausedForSurface = true; }
  } else if (pausedForSurface) {
    // Only resume what WE paused: an unconditional start would override a
    // replay switch-off in PostHog's own project settings.
    inst.startSessionRecording();
    pausedForSurface = false;
  }
}

/** Signed-in host/admin → identified person; signed out → anonymous again. */
export function setUser(user: { id: string; email?: string | null } | null): void {
  try {
    setTelemetryContext({ user_id: user?.id ?? undefined });
    pendingUser = user;
    if (ph) applyUser(ph);
  } catch { /* never */ }
}

function applyUser(inst: PostHog): void {
  const user = pendingUser;
  if (user && identifiedAs !== user.id) {
    inst.identify(user.id, user.email ? { email: user.email } : undefined);
    identifiedAs = user.id;
  } else if (!user && identifiedAs !== null) {
    inst.reset(); // signed out: the next person on this device is someone else
    identifiedAs = null;
  }
}

function tokenInUrl(): boolean {
  try {
    return /access_token|refresh_token|type=recovery/.test(window.location.hash) ||
      /[?&](code|token|token_hash)=/.test(window.location.search);
  } catch { return false; }
}

/**
 * Start PostHog once the page has loaded and the address bar holds no auth
 * token (supabase-js clears it after reading it). Safe to call more than once.
 */
export function initTelemetry(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  try {
    const d = deviceFacts(navigator.userAgent);
    setTelemetryContext({ os: d.os, browser: d.browser, mobile: d.mobile, in_app: d.inApp ?? undefined });
  } catch { /* never */ }
  setRoute(window.location.pathname);
  if (!telemetryEnabled()) return;

  let waited = 0;
  const go = () => {
    if (tokenInUrl() && waited < 30) { waited += 1; window.setTimeout(go, 1000); return; }
    if (tokenInUrl()) return; // a token that never cleared: stay off for this page
    void load();
  };
  const idle = (cb: () => void) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 4000 });
    else globalThis.setTimeout(cb, 1500); // Safari < 18 has no requestIdleCallback
  };
  if (document.readyState === 'complete') idle(go);
  else window.addEventListener('load', () => idle(go), { once: true });
}

async function load(): Promise<void> {
  try {
    const mod = await import('posthog-js');
    const posthog = mod.default;
    const surface = lastRoute?.surface ?? 'other';
    // Opened straight onto the live wall: start with replay off (not on-then-
    // stopped), and remember that we paused it so leaving the wall resumes.
    pausedForSurface = !REPLAY_OFF && NO_REPLAY_SURFACES.has(surface);
    posthog.init(KEY, {
      api_host: HOST,
      ui_host: UI_HOST,
      person_profiles: 'identified_only',
      persistence: 'localStorage+cookie',
      capture_pageview: 'history_change',
      capture_pageleave: true,
      capture_exceptions: true,
      autocapture: true,
      disable_surveys: true,
      disable_session_recording: REPLAY_OFF || pausedForSurface,
      mask_all_element_attributes: false,
      session_recording: {
        maskAllInputs: true,
        blockSelector: REPLAY_BLOCK_SELECTOR,
        maskTextSelector: '[data-ph-mask]',
        recordHeaders: false,
        recordBody: false,
      },
      before_send: (event) => {
        if (!event) return event;
        const p = event.properties as Record<string, unknown> | undefined;
        if (p) {
          for (const k of ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer']) {
            if (typeof p[k] === 'string') p[k] = redactUrl(p[k] as string, 2000);
          }
        }
        return event;
      },
      loaded: (inst) => {
        inst.register({
          app_version: APP_VERSION,
          telemetry_session: telemetrySessionId,
          surface,
          event_slug: lastRoute?.eventSlug ?? null,
        });
      },
    });
    ph = posthog;
    applyReplayForSurface(posthog, surface);
    applyUser(posthog);
    // Errors that go to client_errors also go to PostHog's error tracking,
    // carrying the same telemetry_session id so the two can be joined.
    setExceptionForwarder((err, props) => { posthog.captureException(err, props); });
    for (const [name, props] of queue.splice(0)) posthog.capture(name, props ?? {});
  } catch (err) {
    addBreadcrumb('posthog_load_failed', { message: err instanceof Error ? err.message : String(err) });
  }
}
