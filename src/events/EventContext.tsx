/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EventProvider / useEvent — runtime tenancy context.
 *
 * Mounted under /e/:slug (runtime mode) or at the root with an explicit slug
 * (legacy VITE_EVENT builds). Resolves the slug via loadEventConfig, applies
 * the event's theme (data-event attribute + themeVars + font), keys the store
 * to the event, and keeps admin branding overrides live-synced — everything
 * that used to be hard-wired to the build-time active event.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { EventConfig } from './types';
import { getRegisteredEvent } from './registry';
import { codeRuntimeEvent, loadEventConfig, type RuntimeEvent } from './runtime';
import { subscribeToBranding } from '../lib/db';
import { useStore } from '../store';

export interface EventContextValue {
  eventId: string;
  eventUuid: string | null;
  config: EventConfig;
  status: string;
  planTier: string;
  source: 'code' | 'db';
  /** Router prefix for guest links: '' on legacy builds, `/e/<slug>` at runtime. */
  basePath: string;
}

const EventContext = createContext<EventContextValue | null>(null);

export function useEvent(): EventContextValue {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error('useEvent must be used inside <EventProvider>');
  return ctx;
}

/* ── Theme application ──────────────────────────────────────────────── */

const THEME_STYLE_ID = 'pbar-event-theme';

/**
 * Applies the event theme. themeVars are injected as a stylesheet rule scoped
 * to :root[data-event=…] (rather than inline styles) so the branding system's
 * inline overrides (store.applyBranding) still win, and clearing them restores
 * these values — exactly like the legacy per-event theme.css files behave.
 */
function applyEventTheme(event: RuntimeEvent) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.event = event.eventId;

  const vars = event.config.themeVars ?? {};
  let style = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = THEME_STYLE_ID;
    document.head.appendChild(style);
  }
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  style.textContent = body ? `:root[data-event="${event.eventId}"] {\n${body}\n}` : '';

  const fontHref = event.config.fontHref;
  if (fontHref && !document.querySelector(`link[rel="stylesheet"][href="${fontHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontHref;
    document.head.appendChild(link);
  }

  document.title = `${event.config.copy.fullName} · Photo Booth`;
}

/** Point the store (and DOM theme) at this event before children render. */
function bootstrapEvent(event: RuntimeEvent) {
  applyEventTheme(event);
  useStore.getState().setActiveEvent(event.eventId, event.config);
}

/* ── Status screens ─────────────────────────────────────────────────── */

function CenterScreen({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-noir-900 p-6">
      <div className="flex flex-col items-center gap-4 text-center animate-rise-in max-w-sm">
        <div className="w-12 h-12 rounded-full border border-gold-400/30 animate-pulse-glow" />
        <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/40">{eyebrow}</p>
        <h1 className="font-serif italic text-3xl text-foil-static">{title}</h1>
        {body && <p className="font-sans text-sm text-champagne/55 leading-relaxed">{body}</p>}
      </div>
    </div>
  );
}

/* ── Provider ───────────────────────────────────────────────────────── */

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'ready'; event: RuntimeEvent };

interface Props {
  /** Explicit slug for legacy builds; omitted under /e/:slug (read from params). */
  slug?: string;
  /** Router prefix override; defaults to `/e/<slug>` when slug comes from params. */
  basePath?: string;
  children: ReactNode;
}

export default function EventProvider({ slug: slugProp, basePath, children }: Props) {
  const params = useParams<{ slug?: string }>();
  const slug = (slugProp ?? params.slug ?? '').trim();

  // Coded events resolve synchronously on first mount so legacy builds render
  // with zero flash — identical to the old build-time behavior.
  const [state, setState] = useState<LoadState>(() => {
    const code = getRegisteredEvent(slug);
    if (code) {
      const event = codeRuntimeEvent(slug, code);
      bootstrapEvent(event);
      return { phase: 'ready', event };
    }
    return { phase: 'loading' };
  });
  const loadedSlugRef = useRef<string | null>(state.phase === 'ready' ? slug : null);

  useEffect(() => {
    if (loadedSlugRef.current === slug) return;
    let alive = true;
    setState({ phase: 'loading' });
    loadEventConfig(slug).then((event) => {
      if (!alive) return;
      loadedSlugRef.current = slug;
      if (!event) {
        setState({ phase: 'missing' });
        return;
      }
      bootstrapEvent(event);
      setState({ phase: 'ready', event });
    });
    return () => { alive = false; };
  }, [slug]);

  // Load admin-editable branding overrides once per event, then keep them
  // live-synced (moved here from App so it's keyed by the resolved event).
  const readyEventId = state.phase === 'ready' ? state.event.eventId : null;
  useEffect(() => {
    if (!readyEventId) return;
    const { fetchBranding, applyBranding } = useStore.getState();
    fetchBranding();
    return subscribeToBranding(readyEventId, applyBranding);
  }, [readyEventId]);

  if (state.phase === 'loading') {
    return <CenterScreen eyebrow="Photo Booth" title="Setting the stage…" />;
  }
  if (state.phase === 'missing') {
    return (
      <CenterScreen
        eyebrow="Photo Booth"
        title="Event not found"
        body="We couldn't find an event at this address. Double-check the link or QR code you were given."
      />
    );
  }
  const { event } = state;
  if (event.status === 'archived') {
    return (
      <CenterScreen
        eyebrow={event.config.copy.eyebrow}
        title="This event has ended"
        body={event.config.copy.thankYou}
      />
    );
  }

  const value: EventContextValue = {
    eventId: event.eventId,
    eventUuid: event.eventUuid,
    config: event.config,
    status: event.status,
    planTier: event.planTier,
    source: event.source,
    basePath: basePath ?? (slugProp ? '' : `/e/${slug}`),
  };

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
}
