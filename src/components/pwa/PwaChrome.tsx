/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App-level PWA plumbing, mounted once inside the router (platform builds):
 *
 *  1. Event pages get the EVENT's install manifest (its name, its colours,
 *     reopening that event or its wall) and every other page the platform's.
 *  2. The tester readout: add `?cachedebug` to any page to see how much of
 *     this visit came from the device and how much was downloaded. It is a
 *     DOM chip — photos and clips are drawn from the booth's canvas, so it
 *     can never appear in one.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, X } from 'lucide-react';
import { useStore } from '../../store';
import { applyEventManifest, installRequested, parseInstallPath, restorePlatformManifest } from '../../lib/pwa/install';
import { useInstallApp } from './InstallApp';
import { clearSavedFiles, readCacheStats, type CacheStats } from '../../lib/pwa/client';

const DEBUG_KEY = 'bw.cachedebug';

/** Was a worker already in charge when this page started? (Read as the app
 *  boots: on a first visit the worker only takes over a moment later.) */
const RETURN_VISIT = (() => {
  try { return navigator.serviceWorker?.controller != null; } catch { return false; }
})();

function debugEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('cachedebug')) sessionStorage.setItem(DEBUG_KEY, '1');
    return sessionStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

function CacheReadout() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      void readCacheStats().then((s) => { if (alive) setStats(s); });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const btn = 'pointer-events-auto min-h-[32px] rounded-md bg-white/15 px-2.5 text-[11px] font-semibold text-white';
  const title = RETURN_VISIT ? 'Return visit' : 'First visit: saving as it loads';
  if (!open) {
    return (
      <button
        type="button"
        data-testid="cache-readout"
        onClick={() => setOpen(true)}
        className="fixed left-2 z-[2147483000] min-h-[32px] rounded-lg bg-black/80 px-2.5 font-mono text-[11px] text-white"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      >
        Saved {stats?.hitFiles ?? 0} · new {stats?.netFiles ?? 0}
      </button>
    );
  }
  return (
    <div
      data-testid="cache-readout"
      className="pointer-events-none fixed left-2 z-[2147483000] max-w-[260px] rounded-lg bg-black/80 px-3 py-2 font-mono text-[11px] leading-[16px] text-white"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
    >
      <div className="font-semibold">{title}</div>
      <div>From this device: {stats ? `${stats.hitFiles} files · ${mb(stats.hitBytes)}` : '0 files'}</div>
      <div>Downloaded: {stats ? `${stats.netFiles} files · ${mb(stats.netBytes)}` : 'everything so far'}</div>
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" className={btn} onClick={() => setOpen(false)}>Hide</button>
        <button type="button" className={btn} onClick={() => window.location.reload()}>Reload</button>
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => { setBusy(true); void clearSavedFiles().then(() => window.location.reload()); }}
        >
          Forget saved files
        </button>
      </div>
    </div>
  );
}

/** `?install`: one button that installs this page as an app. Sits at the top
 *  so it never covers the booth's shutter. */
function InstallChip() {
  const { offer, install, dialog } = useInstallApp();
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <>
      {offer && (
        <div
          data-testid="install-chip"
          className="fixed right-2 z-[2147483000] flex items-center gap-1 rounded-full bg-black/85 p-1 text-white shadow-lg"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
        >
          <button type="button" onClick={install} className="flex min-h-[44px] items-center gap-2 rounded-full bg-white px-4 text-[14px] font-semibold text-black">
            <Download className="h-4 w-4" aria-hidden /> Install app
          </button>
          <button type="button" aria-label="Hide" onClick={() => setShown(false)} className="flex h-11 w-11 items-center justify-center rounded-full">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {dialog}
    </>
  );
}

export default function PwaChrome() {
  const { pathname } = useLocation();
  const eventId = useStore((s) => s.eventId);
  const eventName = useStore((s) => s.eventConfig.copy.fullName);
  const [debug] = useState(debugEnabled);
  const [wantInstall] = useState(() => installRequested(window.location.search));

  useEffect(() => {
    const at = parseInstallPath(pathname);
    if (!at || at.slug !== eventId) { restorePlatformManifest(); return; }
    // After a frame: the event's theme has been applied by then, so the
    // page background read here is the event's, not the platform's.
    const raf = requestAnimationFrame(() => {
      let background: string | null = null;
      try { background = getComputedStyle(document.body).backgroundColor; } catch { /* platform colour */ }
      applyEventManifest({ origin: window.location.origin, slug: at.slug, wall: at.wall, name: eventName, background });
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname, eventId, eventName]);

  return (
    <>
      {debug && <CacheReadout />}
      {wantInstall && <InstallChip />}
    </>
  );
}
