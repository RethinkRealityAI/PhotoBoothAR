/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Page half of the service worker (src/sw/sw.ts) and of installing the app.
 * Platform production builds only: never a legacy single-event build, never
 * the dev server (a worker caching dev modules is a debugging trap).
 *
 * Nothing here can throw into the app or reload a page: a visitor mid-booth
 * is never interrupted because a new build went out.
 *
 * Kill switch: build with VITE_SW=off and every visitor's worker and caches
 * are removed on their next page load.
 */
import { installOffer, isAndroid, isIos, type InstallOffer } from './install';

const LEGACY = ((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim() !== '';
const SWITCHED_OFF = ((import.meta.env.VITE_SW as string | undefined) ?? '').trim().toLowerCase() === 'off';

/** Hash of the engine files this page was built against (scripts/vitePwa.ts). */
function pageVendorTag(): string {
  return document.querySelector('meta[name="bw-vendor"]')?.getAttribute('content') ?? '';
}

async function removeWorker(): Promise<void> {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith('bw-')).map((n) => caches.delete(n)));
}

function hello(): void {
  navigator.serviceWorker.controller?.postMessage({ type: 'hello', vendorTag: pageVendorTag() });
}

/** Files this page loaded before a worker controlled it (first visit only). */
function warmFromThisVisit(): void {
  const urls = performance.getEntriesByType('resource').map((e) => e.name);
  if (urls.length > 0) navigator.serviceWorker.controller?.postMessage({ type: 'warm', urls });
}

export function initPwa(): void {
  try {
    if (typeof window === 'undefined' || LEGACY) return;
    watchInstallPrompt();
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    if (SWITCHED_OFF) { void removeWorker().catch(() => undefined); return; }

    const firstVisit = navigator.serviceWorker.controller === null;
    // The browser keeps only the last 250 resource entries by default; a first
    // booth visit can pass that before the list is handed to the worker.
    if (firstVisit) { try { performance.setResourceTimingBufferSize(1000); } catch { /* the default stands */ } }
    hello();
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      hello();
      // First visit: the worker took over after the page had already loaded
      // its files. Hand it that list once things are quiet.
      // Twice: a large file that was still downloading when the worker took
      // over is only listed once it has finished. The worker skips whatever
      // it already holds, so the second pass costs nothing when all is kept.
      if (firstVisit) { window.setTimeout(warmFromThisVisit, 4000); window.setTimeout(warmFromThisVisit, 20000); }
    });
    // updateViaCache 'none': the browser never answers /sw.js (or anything it
    // would import) from its HTTP cache, so a deploy is seen on the next load.
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  } catch { /* no worker: the app works exactly as before */ }
}

/* ── tester readout (?cachedebug) ─────────────────────────────────────── */

export interface CacheStats {
  hitFiles: number;
  hitBytes: number;
  netFiles: number;
  netBytes: number;
  builtAt: string;
  vendorTag: string;
}

/** This page's counts from the worker, or null when no worker controls it. */
export function readCacheStats(): Promise<CacheStats | null> {
  return new Promise((resolve) => {
    try {
      const sw = navigator.serviceWorker?.controller;
      if (!sw) { resolve(null); return; }
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => resolve(null), 1500);
      channel.port1.onmessage = (e) => { window.clearTimeout(timer); resolve(e.data as CacheStats); };
      sw.postMessage({ type: 'stats' }, [channel.port2]);
    } catch {
      resolve(null);
    }
  });
}

/** Forget everything saved on this device (the readout's "Clear" button). */
export async function clearSavedFiles(): Promise<void> {
  try { await removeWorker(); } catch { /* best effort */ }
}

/* ── install prompt ───────────────────────────────────────────────────── */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let offer: InstallOffer = null;
const listeners = new Set<() => void>();

function standalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

function recompute(): void {
  const next = installOffer({ canPrompt: deferred !== null, standalone: standalone(), ios: isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0), android: isAndroid(navigator.userAgent) });
  if (next === offer) return;
  offer = next;
  listeners.forEach((l) => l());
}

function watchInstallPrompt(): void {
  // Cancelling the event is what keeps the browser's own install banner off
  // every page — guests are never asked to install anything. The prompt is
  // kept for the host-side controls (InstallApp.tsx).
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    recompute();
  });
  window.addEventListener('appinstalled', () => { deferred = null; recompute(); });
  recompute();
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getInstallOffer(): InstallOffer {
  return offer;
}

/** Show the browser's install dialog. Resolves true when the app was installed. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null; // a prompt can be used once
    recompute();
    return outcome === 'accepted';
  } catch {
    return false;
  }
}
