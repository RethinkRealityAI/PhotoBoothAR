/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The three doors into the QR card generator:
 *
 *   /host/events/:id/qr-cards   the host, for one event; the design saves to
 *                               events.config.qrCard (member RLS, no migration)
 *   /admin/qr-cards             platform admins, for any event (by its web
 *                               address) or any link; a local draft
 *   /qr-cards/try/:slug?        a public, sign-in-free preview of the
 *                               generator (noindex); nothing is saved
 *
 * Codes always encode the production address (beamwall.app): a card printed
 * from a preview build must still work at the venue.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import QrCardEditor, { type QrEditorEvent } from './QrCardEditor';
import type { EditorSaveState } from '../../components/editor/SaveChip';
import { useSession } from '../../lib/auth';
import { checkIsPlatformAdmin } from '../../lib/admin';
import { updateEventConfig } from '../../lib/host';
import { fetchWizardEvent } from '../../lib/wizard/wizardApi';
import { supabase } from '../../lib/supabase';
import { SITE_ORIGIN, usePageTitle } from '../../lib/usePageTitle';
import { defaultDesign, normalizeDesign, type QrCardDesign } from '../../lib/qrCards/model';

const SAVE_MS = 900;

function Centered({ children }: { children: ReactNode }) {
  return (
    <div data-platform data-surface="night" className="wz-root app-bg grid place-items-center px-6 text-center h-[100dvh]">
      {children}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return <Centered><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none text-white/80" aria-label={label} /></Centered>;
}

function Problem({ title, line, action }: { title: string; line: string; action?: ReactNode }) {
  return (
    <Centered>
      <div className="liquid-glass rounded-[28px] p-8 max-w-md">
        <p className="wz-display text-[24px]">{title}</p>
        <p className="mt-2 text-white/80 text-[15px]">{line}</p>
        {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
      </div>
    </Centered>
  );
}

const eventBase = (slug: string) => `${SITE_ORIGIN}/e/${slug}`;

/** A local draft (admin + demo pages): survives a refresh, never leaves the browser. */
function useLocalDraft(key: string, initial: () => QrCardDesign, event: { name: string; date?: string | null } | null) {
  const [design, setDesign] = useState<QrCardDesign>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return normalizeDesign(JSON.parse(raw), event);
    } catch { /* private mode: start fresh */ }
    return initial();
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(design)); } catch { /* not persisted; still usable */ }
  }, [key, design]);
  return [design, setDesign] as const;
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

interface HostLoad { id: string; slug: string; name: string; status: string; startsAt: string | null; design: QrCardDesign }

export function HostQrCards() {
  usePageTitle('QR cards — Beamwall');
  const { id } = useParams();
  const { session, loading } = useSession();
  const [load, setLoad] = useState<{ state: 'loading' } | { state: 'failed' } | { state: 'missing' } | { state: 'ready'; ev: HostLoad }>({ state: 'loading' });

  const fetchEvent = useCallback(async () => {
    if (id === undefined) { setLoad({ state: 'missing' }); return; }
    setLoad({ state: 'loading' });
    const ev = await fetchWizardEvent(id);
    if (ev === 'failed') { setLoad({ state: 'failed' }); return; }
    if (ev === null) { setLoad({ state: 'missing' }); return; }
    const meta = { name: ev.name, date: ev.starts_at };
    setLoad({ state: 'ready', ev: { id: ev.id, slug: ev.slug, name: ev.name, status: ev.status, startsAt: ev.starts_at, design: normalizeDesign(ev.config.qrCard ?? null, meta) } });
  }, [id]);

  useEffect(() => { if (!loading && session) void fetchEvent(); }, [loading, session, fetchEvent]);

  if (loading) return <Spinner label="Loading" />;
  if (!session) return <Navigate to="/login" replace />;
  if (load.state === 'loading') return <Spinner label="Loading the event" />;
  if (load.state === 'ready') return <HostEditor key={load.ev.id} ev={load.ev} />;
  return (
    <Problem
      title={load.state === 'missing' ? 'We couldn’t find that event' : 'We couldn’t load this event'}
      line={load.state === 'missing' ? 'It may have been deleted, or it belongs to another account.' : 'Check your connection and try again.'}
      action={
        <>
          {load.state === 'failed' && <button type="button" onClick={() => void fetchEvent()} className="pressable bg-foil rounded-full px-5 min-h-11 font-semibold">Try again</button>}
          <Link to="/host" className="pressable liquid-glass-raised rounded-full px-5 min-h-11 inline-flex items-center">Your events</Link>
        </>
      }
    />
  );
}

function HostEditor({ ev }: { ev: HostLoad }) {
  const [design, setDesign] = useState(ev.design);
  const [saveState, setSaveState] = useState<EditorSaveState>('idle');
  const latest = useRef(design);
  const saved = useRef(JSON.stringify(ev.design));
  latest.current = design;

  const save = useCallback(async () => {
    const snapshot = latest.current;
    const json = JSON.stringify(snapshot);
    if (json === saved.current) return;
    setSaveState('saving');
    const ok = await updateEventConfig(ev.id, { qrCard: snapshot });
    if (ok) saved.current = json;
    // A newer edit may have landed while this write was in flight.
    setSaveState(ok ? (JSON.stringify(latest.current) === json ? 'saved' : 'saving') : 'error');
  }, [ev.id]);

  useEffect(() => {
    if (JSON.stringify(design) === saved.current) return;
    const t = setTimeout(() => void save(), SAVE_MS);
    return () => clearTimeout(t);
  }, [design, save]);

  const event: QrEditorEvent = { name: ev.name, base: eventBase(ev.slug), status: ev.status };
  return (
    <QrCardEditor
      design={design}
      onChange={setDesign}
      event={event}
      title={`QR cards · ${ev.name}`}
      backTo={`/host/events/${ev.id}/share`}
      backLabel="Share"
      saveState={saveState}
      onRetrySave={() => void save()}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Public event lookup (admin + demo)                                  */
/* ------------------------------------------------------------------ */

interface PublicEvent { slug: string; name: string; starts_at: string | null; status: string }

/** Any non-draft event by its address (events_public_read). */
async function fetchPublicEvent(slug: string): Promise<PublicEvent | null | 'failed'> {
  const { data, error } = await supabase.from('events').select('slug, name, starts_at, status').eq('slug', slug).maybeSingle();
  if (error) {
    console.error('[qr-cards] fetchPublicEvent', error);
    return 'failed';
  }
  return (data as PublicEvent | null) ?? null;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export function AdminQrCards() {
  usePageTitle('QR cards — Beamwall admin');
  const { session, loading } = useSession();
  const [admin, setAdmin] = useState<'checking' | 'yes' | 'no'>('checking');
  useEffect(() => {
    if (loading) return;
    if (!session) { setAdmin('no'); return; }
    let alive = true;
    void checkIsPlatformAdmin().then((ok) => { if (alive) setAdmin(ok ? 'yes' : 'no'); });
    return () => { alive = false; };
  }, [session, loading]);
  if (loading || (session && admin === 'checking')) return <Spinner label="Loading" />;
  if (!session) return <Navigate to="/login" replace />;
  if (admin !== 'yes') return <Navigate to="/host" replace />;
  return <AdminEditor />;
}

function AdminEditor() {
  const [slug, setSlug] = useState(() => {
    try { return localStorage.getItem('qrCards.admin.slug') ?? ''; } catch { return ''; }
  });
  const [ev, setEv] = useState<PublicEvent | null>(null);
  const [lookup, setLookup] = useState<'idle' | 'busy' | 'missing' | 'failed'>('idle');
  const [design, setDesign] = useLocalDraft('qrCards.admin.design', () => ({ ...defaultDesign(null), target: 'custom', customUrl: 'beamwall.app' }), null);

  const find = useCallback(async (s: string) => {
    const clean = s.trim().replace(/^.*\/e\//, '').replace(/\/.*$/, '');
    if (clean === '') { setEv(null); setLookup('idle'); return; }
    setLookup('busy');
    const res = await fetchPublicEvent(clean);
    if (res === 'failed') { setLookup('failed'); return; }
    if (res === null) { setLookup('missing'); setEv(null); return; }
    setEv(res);
    setLookup('idle');
    try { localStorage.setItem('qrCards.admin.slug', res.slug); } catch { /* fine */ }
  }, []);

  useEffect(() => { if (slug !== '') void find(slug); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, for the remembered event

  const pickEvent = (e: PublicEvent) => {
    const fresh = defaultDesign({ name: e.name, date: e.starts_at }, design.templateId);
    setDesign({ ...design, target: design.target === 'custom' ? 'welcome' : design.target, copy: { ...design.copy, names: fresh.copy.names, date: fresh.copy.date } });
  };

  const aside = (
    <form
      onSubmit={(e) => { e.preventDefault(); void find(slug).then(() => undefined); }}
      className="flex items-center gap-1.5"
    >
      <label htmlFor="qr-admin-slug" className="sr-only">Event address</label>
      <input
        id="qr-admin-slug"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="event address (slug)"
        className="wz-input !min-h-9 !py-1 !text-[13px] w-48"
        autoCapitalize="none"
        spellCheck={false}
      />
      <button type="submit" className="pressable rounded-full bg-white/[0.1] px-3 min-h-9 text-[13px]">{lookup === 'busy' ? '…' : 'Use'}</button>
      {ev !== null && (
        <button type="button" onClick={() => pickEvent(ev)} className="pressable rounded-full bg-white/[0.1] px-3 min-h-9 text-[13px]" title="Fill names and date from the event">
          Fill from {ev.name}
        </button>
      )}
      {lookup === 'missing' && <span className="text-[12.5px] text-[#FFD2DA]">No live event at that address</span>}
      {lookup === 'failed' && <span className="text-[12.5px] text-[#FFD2DA]">Couldn’t look it up</span>}
    </form>
  );

  return (
    <QrCardEditor
      design={design}
      onChange={setDesign}
      event={ev !== null ? { name: ev.name, base: eventBase(ev.slug), status: ev.status } : null}
      title="QR cards"
      titleAside={aside}
      backTo="/admin"
      backLabel="Admin"
      saveState="idle"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Public demo                                                         */
/* ------------------------------------------------------------------ */

const SAMPLE = { name: 'Adaeze & Tunde', date: '2026-12-19' };

export function QrCardsDemo() {
  usePageTitle('QR card maker — Beamwall');
  const { slug } = useParams();
  const [ev, setEv] = useState<PublicEvent | null | 'loading'>(slug !== undefined ? 'loading' : null);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    if (slug === undefined) return;
    let alive = true;
    void fetchPublicEvent(slug).then((res) => { if (alive) setEv(res === 'failed' ? null : res); });
    return () => { alive = false; };
  }, [slug]);

  if (ev === 'loading') return <Spinner label="Loading the event" />;
  return <DemoEditor key={ev?.slug ?? 'sample'} ev={ev} />;
}

function DemoEditor({ ev }: { ev: PublicEvent | null }) {
  const meta = ev !== null ? { name: ev.name, date: ev.starts_at } : SAMPLE;
  const [design, setDesign] = useLocalDraft(
    `qrCards.demo.${ev?.slug ?? 'sample'}`,
    () => (ev !== null ? defaultDesign(meta) : { ...defaultDesign(meta), target: 'custom', customUrl: 'beamwall.app' }),
    meta,
  );
  return (
    <QrCardEditor
      design={design}
      onChange={setDesign}
      event={ev !== null ? { name: ev.name, base: eventBase(ev.slug), status: ev.status } : null}
      title={ev !== null ? `QR cards · ${ev.name}` : 'QR card maker'}
      titleAside={<span className="rounded-full bg-white/[0.1] px-3 py-1 text-[12.5px] text-white/80">Preview · nothing is saved to the event</span>}
      backTo="/"
      backLabel="Beamwall"
      saveState="idle"
    />
  );
}
