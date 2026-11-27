/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What the service worker (src/sw/sw.ts) may keep on the device, and how.
 * Pure: no DOM, no worker globals, so vitest pins it and the worker only
 * executes its verdicts.
 *
 * The rule the whole file enforces: a response is kept ONLY when a stale copy
 * of it cannot break or mislead anyone.
 *
 *  - HTML is never served from the cache while the network answers, so a
 *    deploy reaches every visitor on their next page load.
 *  - /assets/* is content-hashed by Vite: a name is its content, for ever.
 *  - The tracking engines (/mediapipe, /xr8, /three) are NOT hashed and are
 *    coupled to the JS that drives them, so their cache is keyed by a hash of
 *    their bytes (VENDOR_TAG, built by scripts/vitePwa.ts): a dependency bump
 *    is a different cache, never old wasm under new JS.
 *  - Standalone art (models, fonts, event art, a host's uploads in the public
 *    `assets` bucket) is served from the device and refreshed in the
 *    background: a stale copy is only old art.
 *  - Everything else is not touched at all: Supabase REST/Auth/Realtime/Edge
 *    Functions, guest photos (`posts`), signed URLs, analytics, anything that
 *    is not a GET, and media seeks (Range).
 */

export type CacheKind = 'assets' | 'vendor' | 'static' | 'media';

export type Strategy =
  /** Leave the request to the browser: the worker does not answer it. */
  | { type: 'pass' }
  /** Page loads: network, falling back to the last good shell if it is down. */
  | { type: 'shell' }
  /** Serve from the device; fetch (and keep) only on a miss. */
  | { type: 'cacheFirst'; cache: 'assets' | 'vendor' }
  /** Serve from the device and refresh the copy in the background. */
  | { type: 'refresh'; cache: 'static' | 'media' };

export interface RequestFacts {
  method: string;
  url: string;
  /** Request.mode — 'navigate' for a page load. */
  mode: string;
  /** True when the request carries a Range header (video/audio seeking). */
  hasRange: boolean;
}

export interface PolicyEnv {
  /** The page's own origin, e.g. https://beamwall.app */
  origin: string;
  /** Origin of the Supabase project ('' when the build has none). */
  supabaseOrigin: string;
}

const PASS: Strategy = { type: 'pass' };

/** Self-hosted runtimes whose files must match the JS bundle that loads them. */
const VENDOR_PREFIXES = ['/mediapipe/', '/xr8/', '/three/'] as const;

/** Same-origin paths the worker never answers, whatever their extension. */
const NEVER_PREFIXES = ['/ingest/', '/.netlify/', '/sw.js', '/app.webmanifest', '/manifest.webmanifest'] as const;

/** Standalone files worth keeping. Video is absent on purpose: it is fetched
 *  in ranges, and a partial response must never be stored as the whole file. */
const STATIC_EXT = /\.(?:glb|gltf|bin|task|ktx2|hdr|png|jpe?g|webp|avif|gif|svg|ico|woff2?|css|mp3|m4a|wav|json)$/i;

/** A host's uploaded Looks and event art. Guest photos live in `posts` and are
 *  deliberately not matched: a removed photo must not linger on a device. */
const SUPABASE_PUBLIC_ASSETS = '/storage/v1/object/public/assets/';

/** The pinned world-tracking engine (src/lib/world/xr8World.ts loads it from
 *  jsDelivr unmodified, as its licence requires). A versioned npm URL never
 *  changes, so it is as safe to keep as a hashed asset. */
const PINNED_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@8thwall\/engine-binary@\d+\.\d+\.\d+\//;

export function strategyFor(req: RequestFacts, env: PolicyEnv): Strategy {
  if (req.method !== 'GET' || req.hasRange) return PASS;
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return PASS;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return PASS;

  if (url.origin === env.origin) {
    const path = url.pathname;
    if (NEVER_PREFIXES.some((p) => path === p || path.startsWith(p))) return PASS;
    if (req.mode === 'navigate') return { type: 'shell' };
    if (path.startsWith('/assets/')) return { type: 'cacheFirst', cache: 'assets' };
    if (VENDOR_PREFIXES.some((p) => path.startsWith(p))) return { type: 'cacheFirst', cache: 'vendor' };
    // A query string means someone asked for a specific variant (a cache
    // buster, a signed link): never answer that from an older copy.
    if (url.search === '' && STATIC_EXT.test(path)) return { type: 'refresh', cache: 'static' };
    return PASS;
  }

  if (env.supabaseOrigin !== '' && url.origin === env.supabaseOrigin) {
    if (url.search === '' && url.pathname.startsWith(SUPABASE_PUBLIC_ASSETS) && !/\.(?:mp4|webm|mov)$/i.test(url.pathname)) {
      return { type: 'refresh', cache: 'media' };
    }
    return PASS; // REST, Auth, Realtime, Functions, signed + private storage
  }

  if (url.search === '' && PINNED_CDN.test(url.href)) return { type: 'cacheFirst', cache: 'assets' };
  return PASS;
}

export interface ResponseFacts {
  status: number;
  /** Response.type — 'basic' (same origin), 'cors', 'opaque', … */
  type: string;
  contentType: string | null;
}

/**
 * May this response be stored? Only a complete, readable success — and never
 * HTML for a file request: Netlify (and vite preview) answer a MISSING file
 * with index.html at 200, which stored under a .js/.wasm name would poison
 * that name until the cache is dropped.
 */
export function isStorable(res: ResponseFacts): boolean {
  if (res.status !== 200) return false;
  if (res.type !== 'basic' && res.type !== 'cors') return false;
  if (res.contentType !== null && /^text\/html\b/i.test(res.contentType.trim())) return false;
  return true;
}

/* ── cache names ──────────────────────────────────────────────────────── */

export const CACHE_PREFIX = 'bw-';
/** Bump to throw every cache away on the next deploy (a format change). */
export const CACHE_FORMAT = 'v1';

export function cacheNames(vendorTag: string): Record<CacheKind | 'shell', string> {
  return {
    shell: `${CACHE_PREFIX}shell-${CACHE_FORMAT}`,
    assets: `${CACHE_PREFIX}assets-${CACHE_FORMAT}`,
    vendor: `${CACHE_PREFIX}vendor-${CACHE_FORMAT}-${vendorTag}`,
    static: `${CACHE_PREFIX}static-${CACHE_FORMAT}`,
    media: `${CACHE_PREFIX}media-${CACHE_FORMAT}`,
  };
}

/** Caches of ours that this build no longer uses (an older format, or the
 *  engines of a previous dependency set). Other origins' caches are not ours. */
export function staleCacheNames(existing: readonly string[], vendorTag: string): string[] {
  const keep = new Set(Object.values(cacheNames(vendorTag)));
  return existing.filter((n) => n.startsWith(CACHE_PREFIX) && !keep.has(n));
}

/**
 * Hashed files in the assets cache that the current build no longer ships.
 * Without this the cache would grow by a build's worth on every deploy.
 * Cross-origin entries (the pinned CDN engine) are kept: they are versioned
 * by URL and not part of the build's file list.
 */
export function staleAssetUrls(cachedUrls: readonly string[], currentPaths: ReadonlySet<string>, origin: string): string[] {
  return cachedUrls.filter((u) => {
    try {
      const url = new URL(u);
      return url.origin === origin && !currentPaths.has(url.pathname);
    } catch {
      return true;
    }
  });
}

/** Most entries a refreshed cache may hold; the oldest are dropped past it. */
export const CACHE_LIMITS: Record<'static' | 'media', number> = { static: 300, media: 200 };

/** A background refresh of the same URL is skipped inside this window. */
export const REFRESH_EVERY_MS = 60 * 60 * 1000;

/** How long a page load waits on the network before the saved shell is used. */
export const SHELL_TIMEOUT_MS = 6000;
