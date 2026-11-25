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
// Route components additionally reload on guest pages (lib/lazyRoute.ts); both
// paths share one sessionStorage cooldown, so they cannot loop each other.
import { shouldReloadForStaleChunk } from './lib/staleChunk';
import { markStaleReload, readLastStaleReload } from './lib/lazyRoute';

if (!((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim()) {
  window.addEventListener('vite:preloadError', (event) => {
    const now = Date.now();
    if (!shouldReloadForStaleChunk(window.location.pathname, readLastStaleReload(), now)) return; // the import throws as before
    markStaleReload(now);
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

// ── Session telemetry (lib/telemetry.ts). PostHog loads after the page, only
// with VITE_POSTHOG_KEY set and never on legacy single-event builds; without
// it this still fills the breadcrumb trail every client_errors row carries.
// Signed-in hosts/admins are identified by account id; guests stay anonymous.
import { initTelemetry, setUser } from './lib/telemetry';
import { onAuthStateChange } from './lib/auth';

try {
  initTelemetry();
  if (!((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim()) onAuthStateChange((_event, session) => {
    setUser(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null);
  });
} catch {
  /* telemetry must never break the app */
}
