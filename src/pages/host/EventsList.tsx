/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host — the member's events: guest link + QR, status toggles, Open studio,
 * and the New event CTA. Empty state sells the wizard.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowUpRight, Check, Copy, ExternalLink, Plus, QrCode, RefreshCw, Settings2 } from 'lucide-react';
import { fetchMyEvents, updateEventStatus, type HostEventRow } from '../../lib/host';
import { TierPill, UpgradeModal } from './UpgradeCard';
import { normalizeTier } from '../../lib/entitlements';
import StatusPill from '../../components/ui/StatusPill';

function CopyLinkButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      title="Copy guest link"
      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function QRModal({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="glass-strong rounded-3xl p-8 w-full max-w-xs text-center animate-rise-in flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-serif text-xl text-foil-static">{name}</p>
        <div className="rounded-xl p-3 bg-ivory/95 shadow-lg">
          <QRCodeSVG value={url} size={160} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
        </div>
        <p className="font-mono text-[9px] text-brand-muted/60 break-all">{url}</p>
        <button
          onClick={() => navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
          className="w-full py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-label uppercase tracking-widest text-brand-fg/80 transition-colors flex items-center justify-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <QrCode className="w-3.5 h-3.5" />}
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <button onClick={onClose} className="text-brand-muted/50 hover:text-brand-fg text-xs transition-colors">Close</button>
      </div>
    </div>
  );
}

export default function EventsList() {
  const [events, setEvents] = useState<HostEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrTarget, setQrTarget] = useState<HostEventRow | null>(null);
  const [upgradeTarget, setUpgradeTarget] = useState<HostEventRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = useCallback(async () => {
    setLoading(true);
    setEvents(await fetchMyEvents());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (ev: HostEventRow, status: string) => {
    setBusyId(ev.id);
    const prev = ev.status;
    setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, status } : e))); // optimistic
    const ok = await updateEventStatus(ev.id, status);
    if (!ok) {
      setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, status: prev } : e))); // revert
    }
    setBusyId(null);
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Your events</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">
            {loading ? 'Loading…' : `${events.length} event${events.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            to="/host/new"
            className="flex items-center gap-2 rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-noir-900 glow-accent transition active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" /> New event
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 glass rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="glass-strong rounded-3xl p-12 text-center max-w-lg mx-auto">
          <h2 className="font-serif text-2xl text-foil-static mb-2">Create your first event</h2>
          <p className="font-sans text-sm text-brand-muted/70 leading-relaxed mb-8">
            Booth, live wall and studio in under a minute — pick a name, claim your link, and share the QR with your guests.
          </p>
          <Link
            to="/host/new"
            className="inline-flex items-center gap-2 rounded-full bg-foil px-8 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" /> New event
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {events.map((ev) => {
            const guestUrl = `${origin}/e/${ev.slug}`;
            const busy = busyId === ev.id;
            return (
              <div key={ev.id} className="glass rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-serif text-lg text-brand-fg leading-tight truncate">{ev.name}</p>
                    <p className="font-sans text-[10px] uppercase tracking-widest text-brand-muted/40 mt-0.5">{ev.event_type}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <TierPill tier={ev.plan_tier} />
                    <StatusPill status={ev.status} />
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <p className="flex-1 font-mono text-[11px] text-brand-muted/70 truncate">/e/{ev.slug}</p>
                  <CopyLinkButton text={guestUrl} />
                  <button
                    onClick={() => setQrTarget(ev)}
                    title="QR code"
                    className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={guestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open guest view"
                    className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="mt-auto flex items-center gap-2 pt-1">
                  <Link
                    to={`/host/events/${ev.id}`}
                    className="flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-4 py-2 font-label uppercase tracking-luxe text-[9px] text-brand-fg/90 transition-colors"
                  >
                    <Settings2 className="w-3.5 h-3.5" /> Open studio
                  </Link>
                  {(ev.status === 'draft' || ev.status === 'ended') && (
                    <button
                      onClick={() => setStatus(ev, 'live')}
                      disabled={busy}
                      className="rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 px-4 py-2 font-label uppercase tracking-luxe text-[9px] text-emerald-400 transition-colors disabled:opacity-40"
                    >
                      Go live
                    </button>
                  )}
                  {ev.status === 'live' && (
                    <button
                      onClick={() => setStatus(ev, 'ended')}
                      disabled={busy}
                      className="rounded-full bg-amber-500/15 hover:bg-amber-500/25 px-4 py-2 font-label uppercase tracking-luxe text-[9px] text-amber-400 transition-colors disabled:opacity-40"
                    >
                      End
                    </button>
                  )}
                  {normalizeTier(ev.plan_tier) !== 'deluxe' && (
                    <button
                      onClick={() => setUpgradeTarget(ev)}
                      className="ml-auto flex items-center gap-1 rounded-full bg-gold-400/10 hover:bg-gold-400/20 px-4 py-2 font-label uppercase tracking-luxe text-[9px] text-gold-300 transition-colors"
                    >
                      Upgrade <ArrowUpRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {qrTarget && (
        <QRModal url={`${origin}/e/${qrTarget.slug}`} name={qrTarget.name} onClose={() => setQrTarget(null)} />
      )}
      {upgradeTarget && (
        <UpgradeModal
          eventUuid={upgradeTarget.id}
          currentTier={upgradeTarget.plan_tier}
          onClose={() => setUpgradeTarget(null)}
        />
      )}
    </div>
  );
}
