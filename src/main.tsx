import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './events/hope-gala/theme.css';
import './events/jenna-jake/theme.css';
import './events/detola-wuyi/theme.css';
import { activeEvent } from './events/active';

// Legacy single-event builds bootstrap the event chrome at startup, exactly as
// before. In runtime mode (no VITE_EVENT) the EventProvider does this per
// event once the /e/:slug route resolves.
if (((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim()) {
  if (activeEvent.fontHref) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = activeEvent.fontHref;
    document.head.appendChild(link);
  }
  document.documentElement.dataset.event = activeEvent.id;
  document.title = `${activeEvent.copy.fullName} · Photo Booth`;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ── Stale deploy: a tab opened before a deploy asks for chunks that are gone
// (Netlify answers with index.html). Vite raises vite:preloadError; on host,
// admin and marketing pages reload once to pick up the new build. Guest event
// pages are left to their own fallbacks (see shouldReloadForStaleChunk).
// Platform builds only — the frozen legacy-event builds are untouched.
import { shouldReloadForStaleChunk } from './lib/staleChunk';

if (!((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim()) {
  const KEY = 'pbar.staleReloadAt';
  window.addEventListener('vite:preloadError', (event) => {
    let last: number | null = null;
    try { const v = sessionStorage.getItem(KEY); last = v === null ? null : Number(v); } catch { /* private mode */ }
    if (!shouldReloadForStaleChunk(window.location.pathname, last, Date.now())) return; // the import throws as before
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* private mode: cooldown is per load */ }
    event.preventDefault();
    window.location.reload();
  });
}

// ── Global error telemetry (keep this block isolated at the end of the file).
// reportError never throws, rate-limits itself, and its insert promise handles
// both outcomes, so these handlers can't feed errors back into themselves.
import { reportError } from './lib/errorReport';

window.addEventListener('error', (e) => {
  try {
    reportError(e.error ?? e.message, { source: 'window.onerror' });
  } catch {
    /* telemetry must never break the app */
  }
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    reportError(e.reason, { source: 'unhandledrejection' });
  } catch {
    /* telemetry must never break the app */
  }
});
