/// <reference lib="webworker" />
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Beamwall service worker: keeps what a visit downloaded on the device so
 * the next visit does not download it again. Platform builds only — emitted
 * as /sw.js by scripts/vitePwa.ts, registered by src/lib/pwa/client.ts; the
 * frozen legacy sites never get one.
 *
 * It decides nothing itself: src/lib/pwa/cachePolicy.ts (pure, tested) says
 * what may be kept and how. This file only executes those verdicts, and every
 * path through it ends in "the browser's own answer" when anything goes wrong
 * — a cache that cannot be read must cost a visitor nothing but the speed-up.
 *
 * How nobody gets stuck on an old build:
 *  - page loads always ask the network first, so new HTML (and with it the new
 *    hashed file names) arrives on the very next load after a deploy;
 *  - this file changes on every deploy (it carries the build's file list), so
 *    the browser installs the new worker on that same load, and it takes over
 *    at once (skipWaiting + claim) without reloading anyone's page;
 *  - the tracking engines are cached under a hash of their bytes, and a page
 *    from a newer build tells an older worker to stop serving them ('hello').
 */
import {
  CACHE_LIMITS,
  REFRESH_EVERY_MS,
  SHELL_TIMEOUT_MS,
  cacheNames,
  isStorable,
  staleAssetUrls,
  staleCacheNames,
  strategyFor,
} from '../lib/pwa/cachePolicy';

const sw = self as unknown as ServiceWorkerGlobalScope;

interface SwConfig {
  /** Hash of the self-hosted engines' bytes (public/mediapipe, xr8, three). */
  vendorTag: string;
  /** Every /assets/* path this build ships. */
  assets: string[];
  supabaseOrigin: string;
  /** Build time, for the tester readout. */
  builtAt: string;
}

/** Replaced with the real values when the build writes sw.js. */
const CONFIG = JSON.parse('__BW_SW_CONFIG__') as SwConfig;

const NAMES = cacheNames(CONFIG.vendorTag);
const ENV = { origin: sw.location.origin, supabaseOrigin: CONFIG.supabaseOrigin };
const SHELL_KEY = '/index.html';
/** The previous build's file list, kept one deploy so a page still open on
 *  that build keeps finding its chunks. */
const ASSET_LIST_KEY = '/__bw-asset-list.json';

/** A page from a build with different engines is being served: stop answering
 *  engine requests from this worker's (now wrong) cache. */
let vendorBypassed = false;

/** Last background refresh per URL (in memory: a restart refreshes once more). */
const refreshedAt = new Map<string, number>();

/* ── tester readout counters (per page) ───────────────────────────────── */

interface Counters { hitFiles: number; hitBytes: number; netFiles: number; netBytes: number }
const counters = new Map<string, Counters>();

function count(clientId: string, fromDevice: boolean, res: Response): void {
  if (!clientId) return;
  let c = counters.get(clientId);
  if (!c) {
    if (counters.size > 40) counters.clear();
    c = { hitFiles: 0, hitBytes: 0, netFiles: 0, netBytes: 0 };
    counters.set(clientId, c);
  }
  const bytes = Number(res.headers.get('content-length') ?? '0') || 0;
  if (fromDevice) { c.hitFiles++; c.hitBytes += bytes; } else { c.netFiles++; c.netBytes += bytes; }
}

/* ── storing ──────────────────────────────────────────────────────────── */

function storable(res: Response): boolean {
  return isStorable({ status: res.status, type: res.type, contentType: res.headers.get('content-type') });
}

async function put(cacheName: string, url: string, res: Response): Promise<void> {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(url, res);
    const limit = cacheName === NAMES.static ? CACHE_LIMITS.static : cacheName === NAMES.media ? CACHE_LIMITS.media : 0;
    if (limit > 0) {
      const keys = await cache.keys();
      for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
    }
  } catch {
    // Out of space (or a response the cache refuses): make room by dropping
    // the least important cache, and carry on uncached.
    try { await caches.delete(NAMES.media); } catch { /* nothing to do */ }
  }
}

async function lookup(cacheName: string, url: string): Promise<Response | undefined> {
  try {
    const cache = await caches.open(cacheName);
    return await cache.match(url, { ignoreVary: true });
  } catch {
    return undefined;
  }
}

/** The network copy. A cross-origin image tag asks without CORS, which gives
 *  an unreadable (unstorable) answer: ask with CORS first, so it can be kept. */
async function fromNetwork(req: Request): Promise<Response> {
  if (req.mode === 'no-cors' && new URL(req.url).origin !== ENV.origin) {
    try {
      const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) return res;
    } catch { /* the host does not allow CORS: ask the plain way */ }
  }
  return fetch(req);
}

/**
 * An engine file, checked against the server instead of taken from the
 * browser's own HTTP cache. Those files keep their names across dependency
 * bumps and are served with a one-hour max-age, so for an hour after a deploy
 * the HTTP cache would still hand over the PREVIOUS bytes — and this worker
 * would then store them under the NEW engine tag, for good. 'no-cache' is a
 * conditional request: unchanged files cost a 304, not a download.
 */
function engineFromNetwork(url: string): Promise<Response> {
  return fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
}

/* ── strategies ───────────────────────────────────────────────────────── */

async function cacheFirst(event: FetchEvent, cacheName: string): Promise<Response> {
  const req = event.request;
  const hit = await lookup(cacheName, req.url);
  if (hit) { count(event.clientId, true, hit); return hit; }
  const res = cacheName === NAMES.vendor ? await engineFromNetwork(req.url) : await fromNetwork(req);
  count(event.clientId, false, res);
  if (storable(res)) event.waitUntil(put(cacheName, req.url, res.clone()));
  return res;
}

async function refresh(event: FetchEvent, cacheName: string): Promise<Response> {
  const req = event.request;
  const hit = await lookup(cacheName, req.url);
  if (!hit) {
    const res = await fromNetwork(req);
    count(event.clientId, false, res);
    if (storable(res)) {
      refreshedAt.set(req.url, Date.now());
      event.waitUntil(put(cacheName, req.url, res.clone()));
    }
    return res;
  }
  count(event.clientId, true, hit);
  const now = Date.now();
  if (now - (refreshedAt.get(req.url) ?? 0) > REFRESH_EVERY_MS) {
    refreshedAt.set(req.url, now);
    event.waitUntil(
      fromNetwork(req).then(
        (res) => (storable(res) ? put(cacheName, req.url, res) : undefined),
        () => undefined, // offline: the saved copy stands
      ),
    );
  }
  return hit;
}

/** Page loads: the network's HTML, always — the saved shell only when the
 *  network fails or stalls (venue wifi), so the app can show its own honest
 *  "can't reach" screens instead of the browser's error page. */
async function shell(event: FetchEvent): Promise<Response> {
  const net = fetch(event.request).then((res) => {
    const html = /^text\/html\b/i.test(res.headers.get('content-type') ?? '');
    if (res.status === 200 && res.type === 'basic' && !res.redirected && html) {
      event.waitUntil(put(NAMES.shell, SHELL_KEY, res.clone()));
    }
    return res;
  });
  let timer = 0;
  const stalled = new Promise<'stalled'>((resolve) => { timer = sw.setTimeout(() => resolve('stalled'), SHELL_TIMEOUT_MS); });
  try {
    const first = await Promise.race([net, stalled]);
    if (first !== 'stalled') return first;
    const saved = await lookup(NAMES.shell, SHELL_KEY);
    if (saved) {
      net.catch(() => undefined); // still finishing in the background; never unhandled
      return saved;
    }
    return await net;
  } catch (err) {
    const saved = await lookup(NAMES.shell, SHELL_KEY);
    if (saved) return saved;
    throw err;
  } finally {
    sw.clearTimeout(timer);
  }
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

sw.addEventListener('install', () => {
  // Nothing is downloaded ahead of time: a guest only ever needs the parts of
  // the app they actually open, and those are kept as they load.
  void sw.skipWaiting();
});

async function tidy(): Promise<void> {
  try {
    const names = await caches.keys();
    await Promise.all(staleCacheNames(names, CONFIG.vendorTag).map((n) => caches.delete(n)));

    // Hashed files: keep this build's and the previous build's, drop the rest.
    const shellCache = await caches.open(NAMES.shell);
    const prevRes = await shellCache.match(ASSET_LIST_KEY);
    let previous: string[] = [];
    try { previous = prevRes ? ((await prevRes.json()) as string[]) : []; } catch { previous = []; }
    const same = previous.length === CONFIG.assets.length && previous.every((p, i) => p === CONFIG.assets[i]);
    const keep = new Set<string>([...CONFIG.assets, ...(Array.isArray(previous) ? previous : [])]);
    const assets = await caches.open(NAMES.assets);
    const cached = (await assets.keys()).map((r) => r.url);
    await Promise.all(staleAssetUrls(cached, keep, ENV.origin).map((u) => assets.delete(u)));
    if (!same) {
      await shellCache.put(ASSET_LIST_KEY, new Response(JSON.stringify(CONFIG.assets), { headers: { 'content-type': 'application/json' } }));
    }
  } catch { /* upkeep is best-effort: a failure only means a larger cache */ }
}

sw.addEventListener('activate', (event) => {
  event.waitUntil(tidy().then(() => sw.clients.claim()));
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  let strategy;
  try {
    strategy = strategyFor({ method: req.method, url: req.url, mode: req.mode, hasRange: req.headers.has('range') }, ENV);
  } catch {
    return;
  }
  if (strategy.type === 'pass') return;
  if (strategy.type === 'shell') { event.respondWith(shell(event)); return; }
  if (strategy.type === 'cacheFirst') {
    if (strategy.cache === 'vendor' && vendorBypassed) {
      // This worker's engine cache belongs to another build: answer with the
      // server's current bytes and keep nothing.
      event.respondWith(engineFromNetwork(req.url).catch(() => fetch(req)));
      return;
    }
    event.respondWith(cacheFirst(event, NAMES[strategy.cache]).catch(() => fetch(req)));
    return;
  }
  event.respondWith(refresh(event, NAMES[strategy.cache]).catch(() => fetch(req)));
});

/* ── messages from pages (src/lib/pwa/client.ts) ──────────────────────── */

/** Most files one page may hand over to be kept. A booth's first visit loads
 *  ~150 before the worker takes over; a cap of 80 left the second visit
 *  fetching the rest again. */
const WARM_LIMIT = 500;

/** Files a page loaded before this worker controlled it (the very first
 *  visit): keep them too, so the second visit is already complete. They come
 *  straight from the browser's own cache, so this costs no real download. */
async function warm(urls: string[]): Promise<void> {
  for (const url of urls.slice(0, WARM_LIMIT)) {
    try {
      const s = strategyFor({ method: 'GET', url, mode: 'cors', hasRange: false }, ENV);
      if (s.type !== 'cacheFirst' && s.type !== 'refresh') continue;
      if (s.type === 'cacheFirst' && s.cache === 'vendor' && vendorBypassed) continue;
      const name = NAMES[s.cache];
      if (await lookup(name, url)) continue;
      const sameOrigin = new URL(url).origin === ENV.origin;
      const res = name === NAMES.vendor
        ? await engineFromNetwork(url)
        : await fetch(url, sameOrigin ? {} : { mode: 'cors', credentials: 'omit' });
      if (storable(res)) await put(name, url, res);
    } catch { /* one file failing must not stop the rest */ }
  }
}

sw.addEventListener('message', (event) => {
  const data = (event.data ?? {}) as { type?: string; vendorTag?: string; urls?: unknown };
  if (data.type === 'hello') {
    // A page built against other engine files than this worker cached.
    if (typeof data.vendorTag === 'string' && data.vendorTag !== CONFIG.vendorTag && !vendorBypassed) {
      vendorBypassed = true;
      event.waitUntil(caches.delete(NAMES.vendor).then(() => sw.registration.update()).catch(() => undefined));
    }
    return;
  }
  if (data.type === 'warm' && Array.isArray(data.urls)) {
    event.waitUntil(warm(data.urls.filter((u): u is string => typeof u === 'string')));
    return;
  }
  if (data.type === 'stats') {
    const id = (event.source as Client | null)?.id ?? '';
    const c = counters.get(id) ?? { hitFiles: 0, hitBytes: 0, netFiles: 0, netBytes: 0 };
    event.ports[0]?.postMessage({ ...c, builtAt: CONFIG.builtAt, vendorTag: CONFIG.vendorTag });
  }
});
