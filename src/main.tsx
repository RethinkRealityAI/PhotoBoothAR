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
