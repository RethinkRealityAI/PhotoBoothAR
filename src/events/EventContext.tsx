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
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { EventConfig } from './types';
import { getRegisteredEvent } from './registry';
import { codeRuntimeEvent, loadEventConfig, type EventLoad, type RuntimeEvent } from './runtime';
import { subscribeToBranding } from '../lib/db';
import { isEventMember } from '../lib/host';
import { MANAGED_CSS_VARS } from '../lib/branding';
import { useStore } from '../store';
import { accessAllowsBooth, guestAccess, needsMemberCheck, type GuestAccess } from '../lib/eventAccess';

export interface EventContextValue {
  eventId: string;
  eventUuid: string | null;
  config: EventConfig;
  status: string;
  planTier: string;
  source: 'code' | 'db';
  /** Router prefix for guest links: '' on legacy builds, `/e/<slug>` at runtime. */
  basePath: string;
  /**
   * Re-fetch the event's config (events.config for DB events) and swap it into
   * this context in place — no remount, no loading flash. Used by admin
   * screens after patching events.config (e.g. the background-template picker)
   * so the studio reflects the change immediately.
   */
  refreshConfig: () => Promise<void>;
}

const EventContext = createContext<EventContextValue | null>(null);

export function useEvent(): EventContextValue {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error('useEvent must be used inside <EventProvider>');
  return ctx;
}

/**
 * Like useEvent, but returns null outside <EventProvider> instead of throwing.
 * For components that can render on platform surfaces (e.g. the Landing demo
 * booth reusing StageCanvas) where no event is active.
 */
export function useOptionalEvent(): EventContextValue | null {
  return useContext(EventContext);
}

/** Upper bound on "Setting the stage…" before the honest unreachable/fallback
 *  state renders. The fast-reject network path settles itself in ~9s; this
 *  exists for blackhole venue wifi, where nothing else bounds the wait. */
const EVENT_LOAD_DEADLINE_MS = 10_000;

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

  if (event.config.faviconHref) setFavicon(event.config.faviconHref);
  document.title = `${event.config.copy.fullName} · Photo Booth`;
}

/** The platform favicon from index.html, captured before any event overrides it. */
const platformFaviconHref: string | null =
  typeof document !== 'undefined'
    ? (document.querySelector('link[rel="icon"]') as HTMLLinkElement | null)?.href ?? null
    : null;

function setFavicon(href: string) {
  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}

/** Must match index.html's <title> so reset === the pre-event state. */
const PLATFORM_TITLE = 'Beamwall · AR photo booth & live wall for events';

/**
 * Restore the platform-default look when leaving an event context: remove the
 * data-event scope, empty the injected theme rule, clear any inline branding
 * overrides applyBrandingVars set on :root, and reset the document title.
 * Without this, an event's theme lingers over /host and /admin after leaving
 * the studio — the platform chrome must never wear a customer's branding.
 */
function resetPlatformTheme() {
  if (typeof document === 'undefined') return;
  delete document.documentElement.dataset.event;
  const style = document.getElementById(THEME_STYLE_ID);
  if (style) style.textContent = '';
  for (const v of MANAGED_CSS_VARS) document.documentElement.style.removeProperty(v);
  if (platformFaviconHref) setFavicon(platformFaviconHref);
  document.title = PLATFORM_TITLE;
}

/** Point the store (and DOM theme) at this event before children render. */
function bootstrapEvent(event: RuntimeEvent) {
  applyEventTheme(event);
  useStore.getState().setActiveEvent(event.eventId, event.config);
}

/* ── Status screens ─────────────────────────────────────────────────── */

function CenterScreen({
  eyebrow,
  title,
  body,
  onRetry,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  /** Renders a retry control. Only passed for recoverable states — a genuine
   *  "no such event" has nothing to retry. */
  onRetry?: () => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center app-bg p-6">
      <div className="flex flex-col items-center gap-4 text-center animate-rise-in max-w-sm">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 rounded-full border border-gold-400/30 animate-pulse-glow" />
          <div className="absolute inset-1 animate-spin rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)]" />
        </div>
        <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/40">{eyebrow}</p>
        <h1 className="font-serif italic text-3xl text-foil-static">{title}</h1>
        {body && <p className="font-sans text-sm text-champagne/55 leading-relaxed">{body}</p>}
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 min-h-11 rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[11px] text-[color:var(--on-accent)]"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Provider ───────────────────────────────────────────────────────── */

type LoadState =
  | { phase: 'loading' }
  /** The lookup answered, and there is no event at this slug. */
  | { phase: 'missing' }
  /** The lookup never answered — offline, RLS, 5xx. Recoverable, so it gets a
   *  retry instead of accusing the guest's QR code of being wrong. */
  | { phase: 'unreachable' }
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

  // De-theme on unmount so platform chrome (/host, /admin, /) never keeps an
  // event's branding after leaving. The mount half re-asserts the theme for
  // coded events, whose render-phase bootstrap runs BEFORE a replaced sibling
  // provider's unmount cleanup would otherwise wipe it.
  const mountedEventRef = useRef<RuntimeEvent | null>(state.phase === 'ready' ? state.event : null);
  useEffect(() => {
    if (mountedEventRef.current) applyEventTheme(mountedEventRef.current);
    return resetPlatformTheme;
  }, []);

  // Bumping this re-runs the resolve effect, which is how "Try again" works.
  const [attempt, setAttempt] = useState(0);
  // Guest access for a members-only status (draft / ended). null = still
  // deciding: rendering the booth then would flash the guest surface of an
  // event the viewer may not be allowed into, so the provider waits.
  const [access, setAccess] = useState<GuestAccess | null>(
    state.phase === 'ready' && !needsMemberCheck(state.event.status) ? 'open' : null,
  );

  useEffect(() => {
    if (loadedSlugRef.current === slug) return;
    let alive = true;
    setState({ phase: 'loading' });
    // Venue-wifi deadline: a blackhole network (packets swallowed, no fast
    // rejection) holds the fetch far past its retry backoff, so the guest
    // would sit on "Setting the stage…" indefinitely — the fast-reject path
    // settles in ~9s, but nothing bounded the hang. After 10s show the honest
    // unreachable state (which has Try again); this is provisional — a late
    // success still lands below and upgrades it to ready. Coded (legacy)
    // events resolve from the registry before any network, so the timer
    // always clears immediately for them.
    let settled = false;
    const deadline = setTimeout(() => {
      if (alive && !settled) setState({ phase: 'unreachable' });
    }, EVENT_LOAD_DEADLINE_MS);
    loadEventConfig(slug)
      // A rejected promise (total network drop) used to leave the provider in
      // 'loading' forever — "Setting the stage…" with no cancel and no retry.
      .catch((e): EventLoad => {
        console.error('[events] loadEventConfig threw', e);
        return { event: null, error: 'unreachable' };
      })
      .then(({ event, error }) => {
        settled = true;
        clearTimeout(deadline);
        if (!alive) return;
        if (error === 'unreachable') {
          // Not cached as "loaded": a retry must be able to re-resolve it.
          setState({ phase: 'unreachable' });
          return;
        }
        loadedSlugRef.current = slug;
        if (!event) {
          setState({ phase: 'missing' });
          return;
        }
        bootstrapEvent(event);
        setState({ phase: 'ready', event });
        // Draft / ended events are members-only. A live event skips this
        // round-trip entirely, so the common path — a guest scanning a QR at
        // the party — is exactly as fast as it was.
        if (!needsMemberCheck(event.status)) {
          setAccess('open');
          return;
        }
        setAccess(null); // deciding
        // Same deadline class as the load above: if the membership probe
        // hangs, fall back to the non-member decision — for draft/ended/
        // archived that is the correct guest-facing screen, and a late true
        // answer still upgrades it.
        const memberDeadline = setTimeout(() => {
          if (alive) setAccess((cur) => cur ?? guestAccess(event.status, false));
        }, EVENT_LOAD_DEADLINE_MS);
        void isEventMember(event.eventId).then((member) => {
          clearTimeout(memberDeadline);
          if (alive) setAccess(guestAccess(event.status, member));
        });
      });
    return () => { alive = false; clearTimeout(deadline); };
  }, [slug, attempt]);

  // Refresh mechanism for admin config patches (least-invasive correct path):
  // re-run loadEventConfig and replace the ready state's event, keeping the
  // provider mounted so per-event store data (posts, branding, wall settings)
  // survives. setActiveEvent is deliberately NOT re-run — it would wipe that
  // data — but the store's eventConfig reference is synced so future
  // applyBranding copy merges use the fresh config. Everything that renders
  // config.Background does so via useEvent().config (see EventBackground), so
  // updating the context state is sufficient for the change to appear live.
  const refreshConfig = useCallback(async () => {
    const { event } = await loadEventConfig(slug);
    if (!event || loadedSlugRef.current !== slug) return;
    applyEventTheme(event);
    useStore.setState({ eventConfig: event.config });
    setState({ phase: 'ready', event });
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
  if (state.phase === 'unreachable') {
    return (
      <CenterScreen
        eyebrow="Photo Booth"
        title="Can't reach this event"
        body="Your link is fine — we just couldn't load the event. This is usually the venue's wifi. Check your connection and try again."
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }
  if (state.phase === 'missing') {
    return (
      <CenterScreen
        eyebrow="Photo Booth"
        title="Event not found"
        body="We couldn't find an event at this address. Double-check the link or QR code you were given, or the event may not have gone live yet — ask your host."
      />
    );
  }
  const { event } = state;
  // Members-only statuses: decide before rendering anything guest-facing.
  if (access === null) {
    return <CenterScreen eyebrow="Photo Booth" title="Setting the stage…" body="" />;
  }
  if (!accessAllowsBooth(access)) {
    return access === 'ended' ? (
      <CenterScreen
        eyebrow={event.config.copy.eyebrow}
        title="This event has ended"
        body={event.config.copy.thankYou}
      />
    ) : (
      <CenterScreen
        eyebrow={event.config.copy.eyebrow}
        title="Not open just yet"
        body="Your host is still putting the finishing touches to this one. Check the link again closer to the event — nothing is wrong with your QR code."
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
    refreshConfig,
  };

  return (
    <EventContext.Provider value={value}>
      {/* A member looking at an event guests cannot reach yet (or any more).
          Without this a host testing a draft sees a working booth and can
          reasonably conclude their guests do too. */}
      {access === 'preview' && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-3 pt-safe-top [--safe-top:0.5rem]"
        >
          <p className="liquid-glass-raised rounded-full px-4 py-1.5 font-label uppercase tracking-luxe text-[9px] text-amber-300">
            {event.status === 'draft' ? 'Preview — guests can’t open this yet' : 'Preview — this event has ended'}
          </p>
        </div>
      )}
      {children}
    </EventContext.Provider>
  );
}
