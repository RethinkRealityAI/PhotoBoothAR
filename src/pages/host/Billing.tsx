/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host/billing — org billing: credit balance + ledger, the Pro subscription
 * card (subscribe / manage via Stripe), and credit packs. While Stripe keys
 * are pending, checkout calls return 503 billing_not_configured and a
 * dismissable "Billing setup pending" notice is shown instead.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Coins, CreditCard, ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import {
  fetchMyOrgResult, fetchCreditBalance, fetchSubscription, fetchLedger,
  startCheckout, openPortal, invalidateProSubscriptionCache,
  type HostOrg, type SubscriptionRow, type LedgerRow, type CheckoutBody,
} from '../../lib/host';
import { BillingPendingNotice } from './UpgradeCard';

const CREDIT_PACKS: { pack: '50' | '120' | '300'; credits: number; price: string }[] = [
  { pack: '50', credits: 50, price: '$5' },
  { pack: '120', credits: 120, price: '$10' },
  { pack: '300', credits: 300, price: '$20' },
];

const REASON_BADGES: Record<string, { label: string; cls: string }> = {
  signup_bonus: { label: 'Welcome', cls: 'bg-sky-500/15 text-sky-300' },
  signup_grant: { label: 'Signup', cls: 'bg-sky-500/15 text-sky-300' }, // legacy pre-011 rows
  plan_grant: { label: 'Package', cls: 'bg-accent/15 text-accent-2' },
  pack: { label: 'Pack', cls: 'bg-emerald-500/15 text-emerald-400' },
  pro_grant: { label: 'Pro', cls: 'bg-purple-500/15 text-purple-300' },
  promo: { label: 'Promo', cls: 'bg-pink-500/15 text-pink-300' },
};

function ReasonBadge({ reason }: { reason: string }) {
  // Promo grants use a `promo:<code>` reason (migration 011 redeem_promo).
  const key = reason.startsWith('promo:') ? 'promo' : reason;
  const badge = REASON_BADGES[key] ?? {
    label: reason.replace(/_/g, ' '),
    cls: 'bg-white/[0.08] text-brand-muted/70',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[9px] font-label uppercase tracking-widest ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

/** Raw checkout/portal error codes → human sentences (the code itself goes to
 *  console.error for support). billing_not_configured is handled separately. */
function checkoutErrorMessage(code: string | null): string {
  switch (code) {
    case 'network':
      return 'Couldn’t reach Beamwall — check your connection and try again.';
    case 'unauthorized':
      return 'Your session has expired — sign in again, then retry.';
    default:
      return 'Something went wrong on our side — try again in a moment.';
  }
}

function subStatusPill(status: string): string {
  switch (status) {
    case 'active': return 'bg-emerald-500/15 text-emerald-400';
    case 'past_due': return 'bg-amber-500/15 text-amber-400';
    case 'canceled': return 'bg-white/[0.05] text-brand-muted/40';
    default: return 'bg-white/[0.08] text-brand-muted/70';
  }
}

export default function Billing() {
  const [searchParams] = useSearchParams();
  const [org, setOrg] = useState<HostOrg | null>(null);
  const [orgLoadFailed, setOrgLoadFailed] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // 'pro' | 'portal' | pack id
  const [notice, setNotice] = useState<'pending' | 'success' | string | null>(
    searchParams.get('checkout') === 'success' ? 'success' : null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { org: myOrg, failed } = await fetchMyOrgResult();
    setOrgLoadFailed(failed);
    setOrg(myOrg);
    if (myOrg) {
      const [bal, sub, rows] = await Promise.all([
        fetchCreditBalance(myOrg.orgId),
        fetchSubscription(myOrg.orgId),
        fetchLedger(myOrg.orgId, 20),
      ]);
      setBalance(bal);
      setSubscription(sub);
      setLedger(rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Fresh data after a checkout round-trip (webhooks land within seconds).
    invalidateProSubscriptionCache();
    load();
  }, [load]);

  const checkout = async (label: string, body: CheckoutBody) => {
    if (busy) return;
    setBusy(label);
    const { url, error } = await startCheckout(body);
    if (url) {
      window.location.assign(url);
      return;
    }
    setBusy(null);
    if (error === 'billing_not_configured') { setNotice('pending'); return; }
    console.error('[billing] checkout failed:', error);
    setNotice(checkoutErrorMessage(error));
  };

  const portal = async () => {
    if (busy) return;
    setBusy('portal');
    const { url, error } = await openPortal();
    if (url) {
      window.location.assign(url);
      return;
    }
    setBusy(null);
    if (error === 'billing_not_configured') { setNotice('pending'); return; }
    console.error('[billing] portal failed:', error);
    setNotice(checkoutErrorMessage(error));
  };

  const returnUrl = typeof window !== 'undefined' ? `${window.location.origin}/host/billing` : '';
  const subActive = subscription?.status === 'active';
  // The org is created lazily with the first event — until then purchases have
  // nothing to attach to, so point at event creation instead of dead buttons.
  // A transient fetch FAILURE is NOT no-org: don't tell an established host to
  // "create your first event" — show the retry notice below instead.
  const noOrg = !loading && !org && !orgLoadFailed;

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Billing</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">
            {org ? org.name : loading ? 'Loading…' : orgLoadFailed ? 'Couldn’t load your billing.' : 'No organization yet — create your first event to get started.'}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {!loading && orgLoadFailed && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-red-500/10 border border-red-500/25 px-4 py-3">
          <p className="flex-1 font-sans text-xs text-red-300">Couldn’t load your billing — check your connection and try again.</p>
          <button
            onClick={load}
            className="shrink-0 flex items-center gap-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] px-3 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg/90 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}
      {notice === 'pending' && (
        <div className="mb-5"><BillingPendingNotice onDismiss={() => setNotice(null)} /></div>
      )}
      {notice === 'success' && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3">
          <p className="flex-1 font-sans text-xs text-emerald-200/90">
            Payment received — your plan and credits update within a minute of Stripe confirming. Refresh if you don't see them yet.
          </p>
          <button onClick={() => setNotice(null)} className="text-emerald-200/60 hover:text-emerald-200 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}
      {notice && notice !== 'pending' && notice !== 'success' && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-red-500/10 border border-red-500/25 px-4 py-3">
          <p className="flex-1 font-sans text-xs text-red-300">{notice}</p>
          <button onClick={() => setNotice(null)} className="text-red-300/60 hover:text-red-300 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        {/* Credits */}
        <div className="liquid-glass rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-brand-muted/60">
            <Coins className="w-4 h-4 text-accent/80" />
            <span className="font-label uppercase tracking-luxe text-[10px]">Credits</span>
          </div>
          <p className="font-sans text-[11px] text-brand-muted/50 leading-snug -mt-2">
            Credits power the AI studio — an AI frame is 1 credit, a 3D prop about 11, and the keepsake film render 30.
          </p>
          <p className="font-serif text-4xl text-brand-fg">
            {balance ?? 0}
            <span className="ml-2 font-sans text-xs text-brand-muted/50">credits</span>
          </p>
          <div>
            <p className="font-sans text-[10px] uppercase tracking-widest text-brand-muted/40 mb-2">Top up</p>
            {noOrg ? (
              <p className="font-sans text-[11px] text-brand-muted/60 leading-relaxed">
                <Link to="/host/new" className="text-accent-2 hover:underline">Create your first event</Link>{' '}
                to set up your organization — then you can top up credits here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {CREDIT_PACKS.map((p) => (
                  <button
                    key={p.pack}
                    onClick={() => checkout(p.pack, { kind: 'credit_pack', pack: p.pack, returnUrl })}
                    disabled={busy !== null || !org}
                    className="flex-1 min-w-[6rem] rounded-xl bg-white/[0.06] hover:bg-white/[0.1] px-3 py-2.5 text-center transition-colors disabled:opacity-40"
                  >
                    <span className="block font-serif text-lg text-brand-fg">{busy === p.pack ? '…' : p.credits}</span>
                    <span className="block font-sans text-[10px] text-brand-muted/60">credits · {p.price}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pro subscription */}
        <div className="liquid-glass rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-brand-muted/60">
              <Sparkles className="w-4 h-4 text-accent/80" />
              <span className="font-label uppercase tracking-luxe text-[10px]">Beamwall Pro</span>
            </div>
            {subscription && (
              <span className={`px-2.5 py-1 rounded-full text-[9px] font-label uppercase tracking-widest ${subStatusPill(subscription.status)}`}>
                {subscription.status}
              </span>
            )}
          </div>
          <p className="font-serif text-4xl text-brand-fg">
            $79<span className="ml-1 font-sans text-xs text-brand-muted/50">/ month</span>
          </p>
          <ul className="font-sans text-[11px] text-brand-muted/70 space-y-1 leading-snug">
            <li>· Premium-level entitlements on every event</li>
            <li>· 300 credits every month</li>
            <li>· For planners, venues &amp; booth operators</li>
          </ul>
          {subscription?.current_period_end && subActive && (
            <p className="font-sans text-[10px] text-brand-muted/50">
              Renews {new Date(subscription.current_period_end).toLocaleDateString()}
            </p>
          )}
          <div className="mt-auto flex gap-2">
            {noOrg ? (
              <p className="font-sans text-[11px] text-brand-muted/60 leading-relaxed">
                <Link to="/host/new" className="text-accent-2 hover:underline">Create your first event</Link>{' '}
                to set up your organization — then you can subscribe here.
              </p>
            ) : !subActive && (
              <button
                onClick={() => checkout('pro', { kind: 'pro_subscription', returnUrl })}
                disabled={busy !== null || !org}
                className="flex-1 rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-40"
              >
                {busy === 'pro' ? 'Redirecting…' : 'Subscribe'}
              </button>
            )}
            {subscription?.stripe_subscription_id && (
              <button
                onClick={portal}
                disabled={busy !== null}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors disabled:opacity-40"
              >
                <CreditCard className="w-3.5 h-3.5" /> {busy === 'portal' ? 'Opening…' : 'Manage'}
                <ExternalLink className="w-3 h-3 opacity-50" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Ledger */}
      <div className="liquid-glass rounded-2xl p-5">
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 mb-3">
          Recent credit activity
        </p>
        {ledger.length === 0 ? (
          <p className="font-sans text-xs text-brand-muted/50 py-4 text-center">
            {loading ? 'Loading…' : 'No credit activity yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="font-label uppercase tracking-widest text-[9px] text-brand-muted/40">
                  <th className="pb-2 pr-4 font-normal">When</th>
                  <th className="pb-2 pr-4 font-normal">Reason</th>
                  <th className="pb-2 text-right font-normal">Credits</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id} className="border-t border-white/[0.05]">
                    <td className="py-2.5 pr-4 font-sans text-[11px] text-brand-muted/70 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 pr-4"><ReasonBadge reason={row.reason} /></td>
                    <td className={`py-2.5 text-right font-mono text-xs ${row.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {row.delta >= 0 ? `+${row.delta}` : row.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
