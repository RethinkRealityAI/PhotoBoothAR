/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Manager access studio tab — mint, list and revoke day-of staff tokens.
 * The raw token is revealed exactly once (as an /m/<slug>?t=<raw> share link);
 * only its hash is stored.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Plus, Trash2, X } from 'lucide-react';
import EventBackground from '../../components/ui/EventBackground';
import { useEvent } from '../../events/EventContext';
import {
  createManagerToken, listManagerTokens, revokeManagerToken,
  type ManagerTokenRow,
} from '../../lib/host';

function fmt(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return ts;
  }
}

export default function ManagerAccess({ eventUuid }: { eventUuid: string }) {
  const { eventId } = useEvent(); // slug
  const [tokens, setTokens] = useState<ManagerTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('Door staff');
  const [expiry, setExpiry] = useState('');
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState<{ url: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = useCallback(async () => {
    setLoading(true);
    setTokens(await listManagerTokens(eventUuid));
    setLoading(false);
  }, [eventUuid]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setCreating(true);
    const expiresAt = expiry ? new Date(expiry).toISOString() : undefined;
    const res = await createManagerToken(eventUuid, label.trim() || 'Door staff', expiresAt);
    setCreating(false);
    if (!res) return;
    setReveal({ url: `${origin}/m/${eventId}?t=${res.raw}`, label: res.row.label ?? 'Manager link' });
    setCopied(false);
    load();
  };

  const revoke = async (id: string) => {
    if (confirmRevoke !== id) {
      setConfirmRevoke(id);
      return;
    }
    setConfirmRevoke(null);
    setTokens((t) => t.filter((r) => r.id !== id)); // optimistic
    const ok = await revokeManagerToken(id);
    if (!ok) load();
  };

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <EventBackground density={24} />
      <div className="relative z-10 p-6 md:p-10 flex flex-col gap-8 max-w-2xl mx-auto">
        <header className="animate-rise-in">
          <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40 mb-1">Studio</p>
          <h1 className="font-serif italic text-3xl text-foil-static">Manager Access</h1>
          <p className="font-sans text-xs text-champagne/45 mt-1">
            Give day-of staff a link to moderate the wall and flip wall settings — no account needed.
          </p>
        </header>

        {/* One-time reveal */}
        {reveal && (
          <section className="glass-strong rounded-2xl border border-gold-400/40 p-6 animate-rise-in">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5" /> {reveal.label} — share link
              </h2>
              <button onClick={() => setReveal(null)} className="text-champagne/40 hover:text-ivory transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <p className="flex-1 font-mono text-[11px] text-champagne/80 break-all bg-noir-900/50 rounded-lg px-3 py-2.5">
                {reveal.url}
              </p>
              <button
                onClick={() => navigator.clipboard.writeText(reveal.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
                className="p-2.5 glass rounded-lg text-champagne/60 hover:text-gold-300 transition-colors shrink-0"
                title="Copy link"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="font-sans text-[10px] text-amber-300/70 mt-3">
              Copy it now — for security you won't see this link again.
            </p>
          </section>
        )}

        {/* Create form */}
        <section className="glass-strong rounded-2xl border border-gold-400/20 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-4">New access link</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-widest text-[9px] text-champagne/40">Label</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Door staff"
                className="bg-noir-800/80 border border-gold-700/30 rounded-lg px-3 py-2.5 font-sans text-sm text-ivory/90 outline-none focus:border-gold-400/55 transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-widest text-[9px] text-champagne/40">Expires (optional)</span>
              <input
                type="datetime-local"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="bg-noir-800/80 border border-gold-700/30 rounded-lg px-3 py-2.5 font-sans text-sm text-ivory/90 outline-none focus:border-gold-400/55 transition-colors"
              />
            </label>
          </div>
          <button
            onClick={create}
            disabled={creating}
            className="mt-4 w-full py-3 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] font-bold rounded-xl glow-accent hover:scale-[1.01] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create access link
          </button>
        </section>

        {/* Existing tokens */}
        <section className="glass rounded-2xl border border-gold-400/15 p-6 animate-rise-in">
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-gold-300 mb-4">
            Active links ({tokens.length})
          </h2>
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-12 glass rounded-xl animate-pulse" />)}
            </div>
          ) : tokens.length === 0 ? (
            <p className="font-sans text-sm text-champagne/40">No access links yet — create one above.</p>
          ) : (
            <div className="divide-y divide-white/5">
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-3">
                  <KeyRound className="w-4 h-4 text-gold-400/60 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-sans text-sm text-ivory truncate">{t.label ?? 'Manager link'}</p>
                    <p className="font-sans text-[10px] text-champagne/35">
                      Created {fmt(t.created_at)} · Expires {fmt(t.expires_at)}
                    </p>
                  </div>
                  {confirmRevoke === t.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => revoke(t.id)} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors" title="Confirm revoke">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setConfirmRevoke(null)} className="p-1.5 rounded-lg glass text-champagne/40 hover:text-ivory transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => revoke(t.id)} className="p-1.5 glass rounded-lg text-champagne/30 hover:text-red-400 transition-colors" title="Revoke">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="h-6" />
      </div>
    </div>
  );
}
