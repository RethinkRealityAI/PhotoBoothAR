/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/customers/:orgId — one organization: members (with resolved emails),
 * events, one-time event-plan purchases, Pro subscription, credit balance +
 * recent ledger. Read-only in Phase 2 (mutations land in Phase 4's Users screen).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { fetchOrg, type OrgDetail } from '../../lib/admin';
import { formatCount, formatDate } from '../../lib/adminFormat';
import StatusPill from '../../components/ui/StatusPill';

export default function CustomerDetail() {
  const { orgId = '' } = useParams<{ orgId: string }>();
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = async () => {
    setState('loading');
    const { data, error } = await fetchOrg(orgId);
    if (error || !data) { setState('error'); return; }
    setDetail(data);
    setState('ready');
  };

  useEffect(() => { load(); }, [orgId]);

  if (state === 'loading') {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <div className="h-8 w-48 glass rounded-lg animate-pulse mb-8" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 glass rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (state === 'error' || !detail) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <Link to="/admin/customers" className="inline-flex items-center gap-1.5 text-xs text-brand-muted/60 hover:text-brand-fg mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Customers
        </Link>
        <div className="glass-strong rounded-3xl p-12 text-center max-w-lg mx-auto">
          <h2 className="font-serif text-2xl text-foil-static mb-2">Couldn't load this organization</h2>
          <button
            onClick={load}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-foil px-6 py-3 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition active:scale-[0.98]"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const { org, members, events, eventPlans, subscription, creditBalance, ledger } = detail;
  const planByEvent = new Map(eventPlans.map((p) => [p.event_id, p]));

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <Link to="/admin/customers" className="inline-flex items-center gap-1.5 text-xs text-brand-muted/60 hover:text-brand-fg mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Customers
      </Link>

      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">{org.name}</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">Joined {formatDate(org.created_at)}</p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <div className="glass-strong rounded-2xl p-5">
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Subscription</p>
          {subscription ? (
            <div className="mt-2 flex items-center gap-2">
              <StatusPill status={subscription.status} />
              <span className="font-sans text-xs text-brand-muted/60 capitalize">{subscription.tier}</span>
            </div>
          ) : (
            <p className="mt-2 font-sans text-sm text-brand-muted/50">No subscription</p>
          )}
        </div>
        <div className="glass-strong rounded-2xl p-5">
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Credits</p>
          <p className="mt-1 font-serif text-2xl text-foil-static">{formatCount(creditBalance)}</p>
        </div>
        <div className="glass-strong rounded-2xl p-5">
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Stripe customer</p>
          <p className="mt-2 font-sans text-xs text-brand-muted/60">{org.stripe_customer_id ? 'Connected' : 'Not connected'}</p>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="font-label uppercase tracking-luxe text-[11px] text-brand-muted/50 mb-3">
          Members ({members.length})
        </h2>
        <div className="glass rounded-2xl divide-y divide-white/[0.04]">
          {members.length === 0 ? (
            <p className="p-5 font-sans text-sm text-brand-muted/50">No members.</p>
          ) : (
            members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-sans text-sm text-brand-fg truncate">{m.displayName || m.email || m.userId}</p>
                  {m.email && <p className="font-mono text-[10px] text-brand-muted/40 truncate">{m.email}</p>}
                </div>
                <span className="shrink-0 font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">{m.role}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-label uppercase tracking-luxe text-[11px] text-brand-muted/50 mb-3">
          Events ({events.length})
        </h2>
        <div className="glass rounded-2xl divide-y divide-white/[0.04]">
          {events.length === 0 ? (
            <p className="p-5 font-sans text-sm text-brand-muted/50">No events yet.</p>
          ) : (
            events.map((ev) => {
              const plan = planByEvent.get(ev.id);
              return (
                <div key={ev.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-sans text-sm text-brand-fg truncate">{ev.name}</p>
                    <p className="font-mono text-[10px] text-brand-muted/40">/e/{ev.slug}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {plan && <span className="font-label uppercase tracking-luxe text-[9px] text-gold-300 capitalize">{plan.tier}</span>}
                    <StatusPill status={ev.status} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section>
        <h2 className="font-label uppercase tracking-luxe text-[11px] text-brand-muted/50 mb-3">Recent credit ledger</h2>
        <div className="glass rounded-2xl divide-y divide-white/[0.04]">
          {ledger.length === 0 ? (
            <p className="p-5 font-sans text-sm text-brand-muted/50">No ledger activity.</p>
          ) : (
            ledger.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-sans text-xs text-brand-fg truncate">{l.reason}</p>
                  <p className="font-sans text-[10px] text-brand-muted/40">{formatDate(l.created_at)}</p>
                </div>
                <span className={`shrink-0 font-mono text-xs ${l.delta >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {l.delta >= 0 ? '+' : ''}{l.delta}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
