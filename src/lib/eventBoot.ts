/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Event boot: what a guest sees between tapping an event link and the event's
 * own page, and how much sooner that page can arrive.
 *
 * Before this, /e/<slug>/* painted a white page, then the Beamwall platform
 * screen ("Photo Booth · Setting the stage…" on periwinkle), then the event.
 * Now a tiny script inlined into index.html (platform builds only — the
 * `eventBoot` plugin in vite.config.ts; legacy builds never get it):
 *
 *  1. paints the event's remembered background (or a neutral near-black on a
 *     first visit) before any CSS or JS loads, and keeps the Beamwall
 *     background off the page until the event's theme is applied;
 *  2. starts the events-row request straight from the HTML, so it runs while
 *     the app bundle downloads instead of after it (loadEventConfig takes the
 *     answer, once);
 *  3. modulepreloads the route's own chunk (welcome page or booth), which used
 *     to start only after the event had resolved.
 *
 * Everything here is pure or guarded: no storage, network or DOM access can
 * throw out of it.
 */

/** The columns loadEventConfig reads. The boot request must ask for exactly these. */
export const EVENT_ROW_SELECT = 'id, slug, name, event_type, status, config, plan_tier, starts_at';

/** localStorage key prefix for an event's remembered boot look. */
export const BOOT_LOOK_PREFIX = 'bw.boot.';

/** Set on <html> while an event route is booting (removed by endEventBoot). */
export const BOOT_ATTR = 'data-event-boot';

/** First-visit background: neutral, not the Beamwall periwinkle. */
export const BOOT_FALLBACK_BG = '#0b0a10';

/** Only plain colours go into CSS from storage. */
const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\))$/;

export function isSafeColor(v: unknown): v is string {
  return typeof v === 'string' && SAFE_COLOR_RE.test(v.trim());
}

/** Opaque colours only for a page background (a transparent one shows white). */
export function isOpaqueColor(v: unknown): v is string {
  if (!isSafeColor(v)) return false;
  const s = v.trim();
  if (s.startsWith('#')) return s.length === 4 || s.length === 7 || (s.length === 9 && /ff$/i.test(s)) || (s.length === 5 && /f$/i.test(s));
  const m = /^rgba\(.*,\s*([\d.]+%?)\s*\)$/.exec(s);
  return !m || m[1] === '1' || m[1] === '100%';
}

export interface BootLook {
  bg: string;
  accent: string | null;
}

/** Parse a stored boot look; anything unexpected is null. */
export function parseBootLook(raw: string | null): BootLook | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { bg?: unknown; accent?: unknown };
    if (!isOpaqueColor(v?.bg)) return null;
    return { bg: v.bg.trim(), accent: isSafeColor(v.accent) ? v.accent.trim() : null };
  } catch {
    return null;
  }
}

/** /e/<slug>/<route>… → which preloaded chunk set applies. */
export type BootRoute = 'welcome' | 'booth';

export function parseEventPath(pathname: string): { slug: string; route: BootRoute | null } | null {
  const m = /^\/e\/([^/?#]+)(?:\/([^/?#]+))?/.exec(pathname);
  if (!m) return null;
  let slug: string;
  try { slug = decodeURIComponent(m[1]); } catch { return null; }
  const seg = m[2];
  const route: BootRoute | null = seg === 'welcome' ? 'welcome' : seg === 'booth' || seg === 'experience' ? 'booth' : null;
  return { slug, route };
}

/* ── index.html half (built by the vite plugin) ───────────────────────── */

export interface BootScriptOptions {
  supabaseUrl: string;
  anonKey: string;
  /** Absolute URLs of each route's chunk + its not-yet-loaded imports. */
  chunks: Partial<Record<BootRoute, string[]>>;
}

/** CSS that keeps the platform background off an event route while it boots. */
export function bootStyle(): string {
  return (
    `html[${BOOT_ATTR}]{background:var(--bw-boot-bg,${BOOT_FALLBACK_BG});color-scheme:dark}` +
    `html[${BOOT_ATTR}] body,html[${BOOT_ATTR}] #root>div{background:transparent!important}`
  );
}

/**
 * The inline script. ES5, self-contained, wrapped in try/catch: a failure
 * here must only ever mean "no head start", never a broken page. Mirrors
 * parseEventPath / parseBootLook / isOpaqueColor (eventBoot.test.ts runs it
 * against those to keep the two halves in step).
 */
export function bootScript(o: BootScriptOptions): string {
  const cfg = JSON.stringify({
    u: o.supabaseUrl.replace(/\/+$/, ''),
    k: o.anonKey,
    s: EVENT_ROW_SELECT,
    p: BOOT_LOOK_PREFIX,
    a: BOOT_ATTR,
    f: BOOT_FALLBACK_BG,
    c: o.chunks,
  }).replace(/</g, '\\u003c');
  return `(function(){try{var C=${cfg};
var m=/^\\/e\\/([^\\/?#]+)(?:\\/([^\\/?#]+))?/.exec(location.pathname);if(!m)return;
var slug=decodeURIComponent(m[1]),r=document.documentElement;r.setAttribute(C.a,'');
var bg=C.f;try{var l=JSON.parse(localStorage.getItem(C.p+slug)||'null');var R=${SAFE_COLOR_RE.toString()};
if(l&&R.test(l.bg)&&!/^rgba\\(.*,\\s*0?\\.\\d+\\s*\\)$/.test(l.bg)){bg=l.bg;r.style.setProperty('--bw-boot-bg',bg)}
if(l&&R.test(l.accent))r.style.setProperty('--bw-boot-accent',l.accent)}catch(e){}
var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute('content',bg);
var k=m[2]==='welcome'?'welcome':(m[2]==='booth'||m[2]==='experience')?'booth':'',L=k&&C.c[k]||[];
for(var i=0;i<L.length;i++){var n=document.createElement('link');n.rel='modulepreload';n.crossOrigin='';n.href=L[i];document.head.appendChild(n)}
if(C.u&&C.k&&window.fetch&&window.Promise){var w={slug:slug};
w.p=fetch(C.u+'/rest/v1/events?select='+encodeURIComponent(C.s)+'&slug=eq.'+encodeURIComponent(slug),{headers:{apikey:C.k,Authorization:'Bearer '+C.k}})
.then(function(x){return x.ok?x.json():null}).then(function(j){w.rows=Array.isArray(j)?j:null;return w.rows},function(){w.rows=null;return null});
window.__bwEventBoot=w}}catch(e){}})();`;
}

/* ── app half ─────────────────────────────────────────────────────────── */

interface BootPrefetch {
  slug: string;
  /** undefined = still in flight; null = failed / unusable. */
  rows?: unknown[] | null;
  p?: Promise<unknown[] | null>;
}

function bootGlobal(): { __bwEventBoot?: BootPrefetch } {
  return globalThis as unknown as { __bwEventBoot?: BootPrefetch };
}

function usableRow(rows: unknown[] | null | undefined, slug: string): Record<string, unknown> | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0] as Record<string, unknown> | null;
  if (!row || typeof row !== 'object' || row.slug !== slug || typeof row.id !== 'string') return null;
  return row;
}

/**
 * The boot request's row for this slug if it has ALREADY arrived. NOT
 * consumed: React throws away the state of a first render that suspends (the
 * route chunk still loading), so the render that finally commits must be able
 * to read it again. EventProvider calls discardBootRow once it has committed.
 * A missing row is not an answer: a draft is invisible to the anon request
 * but visible to its signed-in host, so "no row" always falls back to the
 * app's own (session-carrying) query.
 */
export function peekBootRowSync(slug: string): Record<string, unknown> | null {
  const w = bootGlobal().__bwEventBoot;
  if (!w || w.slug !== slug || w.rows === undefined) return null;
  return usableRow(w.rows, slug);
}

/** Forget the boot answer, so a later retry / refreshConfig asks the network. */
export function discardBootRow(): void {
  delete bootGlobal().__bwEventBoot;
}

/** Same, waiting for the boot request if it is still in flight. Consumed once,
 *  so a retry or refreshConfig always asks the network again. */
export async function takeBootRow(slug: string): Promise<Record<string, unknown> | null> {
  const g = bootGlobal();
  const w = g.__bwEventBoot;
  if (!w || w.slug !== slug) return null;
  delete g.__bwEventBoot;
  try {
    const rows = w.rows !== undefined ? w.rows : await w.p;
    return usableRow(rows ?? null, slug);
  } catch {
    return null;
  }
}

/** The event's theme is on the page (or an error screen is): hand the
 *  background back to the app's own CSS. */
export function endEventBoot(): void {
  try {
    const r = document.documentElement;
    r.removeAttribute(BOOT_ATTR);
    r.style.removeProperty('--bw-boot-bg');
    r.style.removeProperty('--bw-boot-accent');
  } catch { /* no DOM */ }
}

/** Remember how this event looks, so the next visit boots in its colours. */
export function rememberBootLook(slug: string): void {
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    if (!isOpaqueColor(bg)) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    const look: BootLook = { bg, accent: isSafeColor(accent) ? accent : null };
    localStorage.setItem(BOOT_LOOK_PREFIX + slug, JSON.stringify(look));
  } catch { /* private mode / no DOM: next visit boots neutral */ }
}
