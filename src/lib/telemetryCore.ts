/**
 * The pure half of telemetry: no supabase, no posthog, no React — so both
 * errorReport.ts and telemetry.ts can import it without a cycle, and it runs
 * in vitest's node env.
 *
 *   - a BREADCRUMB ring buffer (the last things that happened on this page),
 *     attached to every client_errors row so an error or camera incident
 *     arrives with its own story;
 *   - ROUTE context (surface + event slug) from a pathname;
 *   - an exception FORWARDER slot that telemetry.ts fills once PostHog loads,
 *     so errorReport never imports PostHog itself.
 */

export type Surface =
  | 'booth' | 'wall' | 'guest' | 'recap' | 'card'
  | 'host' | 'admin' | 'auth' | 'marketing' | 'other';

export interface RouteContext {
  surface: Surface;
  /** The event the page belongs to, when the URL names one. */
  eventSlug: string | null;
}

/** Route → surface. Order matters: the most specific prefixes first. */
export function routeContext(pathname: string): RouteContext {
  const p = (pathname || '/').toLowerCase();
  const ev = /^\/e\/([^/?#]+)(?:\/([^/?#]*))?/.exec(p);
  if (ev) {
    const sub = ev[2] ?? '';
    const surface: Surface =
      sub === 'booth' ? 'booth'
      : sub === 'wall' ? 'wall'
      : sub === 'admin' ? 'host' // the per-event manager console
      : 'guest';
    return { surface, eventSlug: decodeSafe(ev[1]) };
  }
  const recap = /^\/r\/([^/?#]+)/.exec(p);
  if (recap) return { surface: 'recap', eventSlug: decodeSafe(recap[1]) };
  if (p.startsWith('/card') || p.startsWith('/c/')) return { surface: 'card', eventSlug: null };
  if (p.startsWith('/host')) return { surface: 'host', eventSlug: null };
  if (p.startsWith('/admin')) return { surface: 'admin', eventSlug: null };
  if (p.startsWith('/login') || p.startsWith('/signup') || p.startsWith('/reset-password') || p.startsWith('/forgot-password')) {
    return { surface: 'auth', eventSlug: null };
  }
  if (p === '/' || p.startsWith('/guides') || p.startsWith('/pricing') || p.startsWith('/beamy')) {
    return { surface: 'marketing', eventSlug: null };
  }
  return { surface: 'other', eventSlug: null };
}

function decodeSafe(s: string): string {
  try { return decodeURIComponent(s).slice(0, 120); } catch { return s.slice(0, 120); }
}

// ── Breadcrumbs ─────────────────────────────────────────────────────────────

export type CrumbValue = string | number | boolean | null;
export interface Breadcrumb {
  /** ms since this page loaded (performance.now at record time, rounded). */
  t: number;
  name: string;
  props?: Record<string, CrumbValue>;
}

export const MAX_BREADCRUMBS = 40;
/** client_errors.context is capped at 8000 chars by migration 021; the trail
 *  gets at most this much of it so the rest of the context always fits. */
export const MAX_BREADCRUMB_CHARS = 4500;
const MAX_STRING = 120;
const MAX_PROPS = 12;

/** Primitives only, strings clipped, at most MAX_PROPS keys. Never throws. */
export function sanitizeProps(props: Record<string, unknown> | undefined): Record<string, CrumbValue> | undefined {
  if (!props) return undefined;
  const out: Record<string, CrumbValue> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (n >= MAX_PROPS) break;
    if (v === undefined) continue;
    if (v === null) out[k] = null;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number') out[k] = Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    else if (typeof v === 'string') out[k] = v.slice(0, MAX_STRING);
    else continue; // objects/functions are dropped, not stringified
    n += 1;
  }
  return n > 0 ? out : undefined;
}

export class BreadcrumbTrail {
  private crumbs: Breadcrumb[] = [];
  constructor(private readonly max = MAX_BREADCRUMBS) {}

  add(name: string, props: Record<string, unknown> | undefined, t: number): void {
    const crumb: Breadcrumb = { t: Math.round(t), name: name.slice(0, 60) };
    const clean = sanitizeProps(props);
    if (clean) crumb.props = clean;
    this.crumbs.push(crumb);
    if (this.crumbs.length > this.max) this.crumbs.splice(0, this.crumbs.length - this.max);
  }

  /** Newest-last copy, trimmed from the OLDEST end until it fits maxChars. */
  snapshot(maxChars = MAX_BREADCRUMB_CHARS): Breadcrumb[] {
    const out = this.crumbs.slice();
    while (out.length > 0 && JSON.stringify(out).length > maxChars) out.shift();
    return out;
  }

  clear(): void { this.crumbs = []; }
}

export const trail = new BreadcrumbTrail();

function nowMs(): number {
  try { return performance.now(); } catch { return 0; }
}

export function addBreadcrumb(name: string, props?: Record<string, unknown>): void {
  try { trail.add(name, props, nowMs()); } catch { /* never break the app */ }
}

export function getBreadcrumbs(): Breadcrumb[] {
  try { return trail.snapshot(); } catch { return []; }
}

// ── Context shared by every report ──────────────────────────────────────────

let extraContext: Record<string, CrumbValue> = {};

/** Merge identity/route facts that every error row should carry. */
export function setTelemetryContext(ctx: Record<string, unknown>): void {
  extraContext = { ...extraContext, ...(sanitizeProps(ctx) ?? {}) };
  for (const [k, v] of Object.entries(ctx)) if (v === undefined) delete extraContext[k];
}

export function getTelemetryContext(): Record<string, CrumbValue> {
  return { ...extraContext };
}

// ── Exception forwarding (PostHog, once loaded) ─────────────────────────────

type Forwarder = (err: unknown, props: Record<string, unknown>) => void;
let forwarder: Forwarder | null = null;

export function setExceptionForwarder(fn: Forwarder | null): void {
  forwarder = fn;
}

export function forwardException(err: unknown, props: Record<string, unknown>): void {
  if (!forwarder) return;
  try { forwarder(err, props); } catch { /* never break the app */ }
}

// ── Device facts (plain, no fingerprinting beyond what the UA already says) ──

export interface DeviceFacts {
  os: string;
  browser: string;
  mobile: boolean;
  inApp: string | null;
}

/** Coarse OS/browser/in-app-webview from a user agent. Pure. */
export function deviceFacts(ua: string): DeviceFacts {
  const s = ua || '';
  const os =
    /iPhone|iPad|iPod/.test(s) ? 'iOS'
    : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS'
    : /Linux/.test(s) ? 'Linux'
    : 'other';
  const inApp =
    /Instagram/.test(s) ? 'instagram'
    : /FBAN|FBAV|FB_IAB/.test(s) ? 'facebook'
    : /TikTok|BytedanceWebview|musical_ly/.test(s) ? 'tiktok'
    : /Snapchat/.test(s) ? 'snapchat'
    : /LinkedInApp/.test(s) ? 'linkedin'
    : /; wv\)/.test(s) ? 'android-webview'
    : null;
  const browser =
    /EdgA?\//.test(s) ? 'Edge'
    : /SamsungBrowser/.test(s) ? 'Samsung'
    : /CriOS|Chrome\//.test(s) ? 'Chrome'
    : /FxiOS|Firefox\//.test(s) ? 'Firefox'
    : /Safari\//.test(s) ? 'Safari'
    : 'other';
  const mobile = /Mobi|Android|iPhone|iPad|iPod/.test(s);
  return { os, browser, mobile, inApp };
}
