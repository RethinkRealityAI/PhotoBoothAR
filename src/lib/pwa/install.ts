/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Installing Beamwall as an app — for hosts and for staff running a wall or a
 * kiosk. Never for guests: their flow stays "open the link".
 *
 *  - The browser's own "Add to Home screen" banner is suppressed EVERYWHERE
 *    (client.ts cancels `beforeinstallprompt`); the stashed prompt is offered
 *    only where a host put it: the host rail and a wall's Display menu.
 *  - On an event page the manifest is swapped for one that names the EVENT,
 *    wears its colours and reopens that event (the wall, when installed from
 *    the wall), so an installed wall never opens on a Beamwall page.
 *
 * Pure except the two DOM helpers at the bottom.
 */

/* ── the install offer ────────────────────────────────────────────────── */

export interface InstallFacts {
  /** The browser handed us an install prompt (Chrome/Edge, Android + desktop). */
  canPrompt: boolean;
  /** Already running as an installed app. */
  standalone: boolean;
  /** iPhone/iPad: no prompt API — installing is Share → Add to Home Screen. */
  ios: boolean;
  /** Android: every browser there can add a page to the Home screen from its
   *  menu, but not all hand over a prompt (Samsung Internet often does not). */
  android?: boolean;
}

export type InstallOffer = 'prompt' | 'ios-steps' | 'android-steps' | null;

/** What an install control should do here — null means show no control. */
export function installOffer(f: InstallFacts): InstallOffer {
  if (f.standalone) return null;
  if (f.canPrompt) return 'prompt';
  if (f.ios) return 'ios-steps';
  if (f.android === true) return 'android-steps';
  return null; // a browser that cannot install: never show a dead button
}

/** iPhone, iPod, iPad (incl. iPadOS, which reports itself as a Mac). */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function isAndroid(userAgent: string): boolean {
  return /Android/i.test(userAgent);
}

/** `?install` on a page: a host's link for staff setting up a kiosk phone or
 *  tablet (and for testers). Guests never get that link, so never the chip. */
export function installRequested(search: string): boolean {
  try { return new URLSearchParams(search).has('install'); } catch { return false; }
}

/* ── per-event manifest ───────────────────────────────────────────────── */

/** The platform's installable manifest (public/app.webmanifest). The older
 *  /manifest.webmanifest is the frozen legacy sites' and is left as it was. */
export const STATIC_MANIFEST_HREF = '/app.webmanifest';

/** /e/<slug>… → the slug and whether this is the event's wall. */
export function parseInstallPath(pathname: string): { slug: string; wall: boolean } | null {
  const m = /^\/e\/([^/?#]+)(?:\/([^/?#]+))?/.exec(pathname);
  if (!m) return null;
  try {
    return { slug: decodeURIComponent(m[1]), wall: m[2] === 'wall' };
  } catch {
    return null;
  }
}

/** Opaque #rgb/#rrggbb or rgb()/rgba(…, 1) only — a manifest colour must be
 *  one the OS can paint a splash with. */
export function manifestColor(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (!m || (m[4] !== undefined && Number(m[4]) !== 1)) return fallback;
  const hex = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  return `#${hex}`;
}

export interface EventManifestInput {
  origin: string;
  slug: string;
  wall: boolean;
  /** The event's display name (copy.fullName). */
  name: string;
  background: string | null;
}

/** The platform's own dusk blue (index.html theme-color). */
export const PLATFORM_COLOR = '#262566';

/**
 * A manifest for one event. Every URL is absolute, so it reads the same
 * wherever it is served from.
 */
export function eventManifest(i: EventManifestInput): Record<string, unknown> {
  const name = (i.name.trim() || 'Photo Booth').slice(0, 60);
  const base = `${i.origin}/e/${encodeURIComponent(i.slug)}`;
  const start = i.wall ? `${base}/wall` : base;
  const color = manifestColor(i.background, PLATFORM_COLOR);
  return {
    id: start,
    name: i.wall ? `${name} · Live wall` : name,
    short_name: (i.wall ? 'Live wall' : name).slice(0, 12),
    start_url: start,
    // No trailing slash: start_url (the event's own address) must sit inside it.
    scope: base,
    display: 'standalone',
    background_color: color,
    theme_color: color,
    icons: [
      { src: `${i.origin}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${i.origin}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${i.origin}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** Where an event's manifest is served (netlify/edge-functions/event-manifest.ts). */
export const EVENT_MANIFEST_PATH = '/event.webmanifest';

/** The https address of one event's manifest. Android only installs a web
 *  app whose manifest has one; a blob: manifest is refused there. */
export function eventManifestHref(i: EventManifestInput): string {
  const q = new URLSearchParams({ slug: i.slug, name: i.name.trim().slice(0, 60), bg: manifestColor(i.background, PLATFORM_COLOR) });
  if (i.wall) q.set('wall', '1');
  return `${i.origin}${EVENT_MANIFEST_PATH}?${q.toString()}`;
}

/** The serving half: the query back into a manifest, or null when the slug
 *  is not one an event can have. */
export function eventManifestFromQuery(origin: string, q: URLSearchParams): Record<string, unknown> | null {
  const slug = q.get('slug') ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(slug)) return null;
  return eventManifest({ origin, slug, wall: q.get('wall') === '1', name: q.get('name') ?? '', background: q.get('bg') });
}

/** May the browser show its OWN install button here? Everywhere except a
 *  guest's plain event link: guests are never asked to install anything. A
 *  host's `?install` link for staff lifts that. */
export function browserInstallAllowed(pathname: string, requested: boolean): boolean {
  return requested || !/^\/e\//.test(pathname);
}

/* ── DOM ──────────────────────────────────────────────────────────────── */

let eventManifestLive = false;

/** The page's manifest link. One real phone (Samsung Internet 31) reported a
 *  page with none, though index.html ships it, so a missing link is put back. */
function manifestLink(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null;
  const found = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
  if (found) return found;
  const made = document.createElement('link');
  made.rel = 'manifest';
  made.href = STATIC_MANIFEST_HREF;
  made.setAttribute('data-bw-restored', '1');
  document.head.appendChild(made);
  return made;
}

/** Point the page at an event's manifest. Never throws. */
export function applyEventManifest(input: EventManifestInput): void {
  try {
    const link = manifestLink();
    if (!link) return;
    const url = eventManifestHref(input);
    if (link.href !== url) link.href = url;
    eventManifestLive = true;
  } catch { /* the static manifest stands */ }
}

/** Back to the platform manifest (leaving an event). Never throws. */
export function restorePlatformManifest(): void {
  try {
    const link = manifestLink();
    if (!link || !eventManifestLive) return;
    link.href = STATIC_MANIFEST_HREF;
    eventManifestLive = false;
  } catch { /* nothing to restore */ }
}
