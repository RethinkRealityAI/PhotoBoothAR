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
import { Coins, CreditCard, ExternalLink, Link2, RefreshCw, Sparkles } from 'lucide-react';
import {
  fetchMyOrgResult, fetchCreditBalance, fetchSubscription, fetchLedgerResult,
  startCheckout, openPortal, invalidateProSubscriptionCache,
  type HostOrg, type SubscriptionRow, type LedgerRow, type CheckoutBody,
} from '../../lib/host';
import {
  fetchProviderKeyStatus, setProviderKey, clearProviderKey, providerKeyErrorMessage,
  type ProviderKeyStatus,
} from '../../lib/providerKeys';
import { splitCombinedKey, validateKeyInput, KEY_FIELD_MAX } from '../../lib/providerKeysModel';
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
  /** The ledger read failed — not a record of zero purchases. */
  const [ledgerFailed, setLedgerFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // 'pro' | 'portal' | pack id
  const [notice, setNotice] = useState<'pending' | 'success' | string | null>(
    searchParams.get('checkout') === 'success' ? 'success' : null,
  );
  /* Connected accounts (bring-your-own Higgsfield key). `keyStatus` null with
     keyFailed false = still loading; null with keyFailed true = the read failed,
     which must never be painted as "not connected". */
  const [keyStatus, setKeyStatus] = useState<ProviderKeyStatus | null>(null);
  const [keyFailed, setKeyFailed] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyNotice, setKeyNotice] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { org: myOrg, failed } = await fetchMyOrgResult();
    setOrgLoadFailed(failed);
    setOrg(myOrg);
    if (myOrg) {
      const [bal, sub, ledgerResult, keyResult] = await Promise.all([
        fetchCreditBalance(myOrg.orgId),
        fetchSubscription(myOrg.orgId),
        fetchLedgerResult(myOrg.orgId, 20),
        fetchProviderKeyStatus('higgsfield', myOrg.orgId),
      ]);
      setBalance(bal);
      setSubscription(sub);
      // Same rule as the ledger below: a failed read is not a record of "no key".
      if (keyResult.error !== null || keyResult.data === null) {
        console.error('[billing] provider key status failed:', keyResult.error);
        setKeyStatus(null);
        setKeyFailed(true);
      } else {
        setKeyStatus(keyResult.data);
        setKeyFailed(false);
      }
      // A failed ledger read printed "No credit activity yet." over the
      // customer's real purchases — the balance card above already models the
      // error case properly, this one did not.
      setLedgerFailed(ledgerResult.failed);
      setLedger(ledgerResult.rows);
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
    if (error === 'billing_not_configured' || error === 'billing_test_mode') { setNotice('pending'); return; }
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
    if (error === 'billing_not_configured' || error === 'billing_test_mode') { setNotice('pending'); return; }
    console.error('[billing] portal failed:', error);
    setNotice(checkoutErrorMessage(error));
  };

  /* ── Connected accounts: store / remove the org's own Higgsfield key ─────
   * The secret travels ONE WAY (browser → provider-keys edge fn). Nothing here
   * can read it back, and both fields are cleared the instant it is stored, so
   * it is never left sitting in a form the next person to walk past can read. */
  const onKeyIdChange = (raw: string) => {
    // Most dashboards offer the pair as `id:secret` on one line — accept that
    // paste in either box rather than making the host split it by hand.
    const pair = splitCombinedKey(raw);
    if (pair) { setKeyId(pair.keyId); setKeySecret(pair.keySecret); return; }
    setKeyId(raw);
  };

  const connectKey = async () => {
    if (keyBusy || !org) return;
    setKeyError(null);
    setKeyNotice(null);
    const problem = validateKeyInput(keyId, keySecret);
    if (problem) { setKeyError(problem); return; }
    setKeyBusy(true);
    const res = await setProviderKey(keyId.trim(), keySecret.trim(), 'higgsfield', org.orgId);
    setKeyBusy(false);
    if (res.error !== null || res.data === null) {
      console.error('[billing] provider key save failed:', res.error);
      setKeyError(providerKeyErrorMessage(res.error ?? 'internal', res.message));
      return;
    }
    setKeyId('');
    setKeySecret('');
    setKeyStatus(res.data);
    setKeyFailed(false);
    setKeyNotice('Higgsfield connected — new generations run on your own account.');
  };

  const disconnectKey = async () => {
    if (keyBusy || !org) return;
    setKeyError(null);
    setKeyNotice(null);
    setKeyBusy(true);
    const res = await clearProviderKey('higgsfield', org.orgId);
    setKeyBusy(false);
    setConfirmDisconnect(false);
    if (res.error !== null || res.data === null) {
      console.error('[billing] provider key clear failed:', res.error);
      setKeyError(providerKeyErrorMessage(res.error ?? 'internal', res.message));
      return;
    }
    setKeyStatus(res.data);
    setKeyFailed(false);
    setKeyNotice('Higgsfield disconnected — generations fall back to Beamwall credits.');
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
          className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
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
          {/* fetchCreditBalance returns null on query failure (a real zero
              comes back as 0) — never render that null as a false "0". */}
          <p className="font-serif text-4xl text-brand-fg">
            {balance !== null ? balance : loading ? '…' : '—'}
            <span className="ml-2 font-sans text-xs text-brand-muted/50">credits</span>
          </p>
          {balance === null && !loading && org && (
            <button
              onClick={load}
              className="self-start -mt-2 flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg/80 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Couldn’t load — retry
            </button>
          )}
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
                className="pressable flex-1 flex items-center justify-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-5 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors disabled:opacity-40"
              >
                <CreditCard className="w-3.5 h-3.5" /> {busy === 'portal' ? 'Opening…' : 'Manage'}
                <ExternalLink className="w-3 h-3 opacity-50" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Connected accounts — bring your own provider credentials */}
      <div className="liquid-glass rounded-2xl p-5 mb-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-brand-muted/60">
          <Link2 className="w-4 h-4 text-accent/80" />
          <span className="font-label uppercase tracking-luxe text-[10px]">Connected accounts</span>
        </div>
        <p className="font-sans text-[11px] text-brand-muted/60 leading-relaxed -mt-2">
          Bring your own Higgsfield account — generations through Higgsfield stop consuming Beamwall credits.
          Create API keys at{' '}
          <a
            href="https://cloud.higgsfield.ai"
            target="_blank"
            rel="noreferrer"
            className="text-accent-2 hover:underline inline-flex items-center gap-0.5"
          >
            cloud.higgsfield.ai <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
          .
        </p>

        <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-serif text-base text-brand-fg leading-tight">Higgsfield</p>
              <p className="font-sans text-[11px] text-brand-muted/60 mt-0.5">
                {loading
                  ? 'Checking…'
                  : noOrg
                    ? 'Create your first event to set up your organization.'
                    : keyFailed
                      ? 'Couldn’t check this connection — this is not a record of "not connected".'
                      : keyStatus === null
                        ? 'Checking…'
                        : keyStatus.configured
                          ? `Connected · key ${keyStatus.keyIdMasked ?? '••••'}`
                          : keyStatus.platformAvailable
                            ? 'Not connected — Higgsfield generations cost 2 Beamwall credits.'
                            : 'Not connected — Higgsfield generation needs your own key.'}
              </p>
            </div>
            {keyStatus?.configured === true && !confirmDisconnect && (
              <button
                onClick={() => setConfirmDisconnect(true)}
                disabled={keyBusy}
                className="pressable shrink-0 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors disabled:opacity-40"
              >
                Disconnect
              </button>
            )}
          </div>

          {keyStatus?.configured === true && confirmDisconnect && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-400/25 px-3 py-2.5">
              <p className="flex-1 min-w-[12rem] font-sans text-[11px] text-amber-200/90 leading-snug">
                Remove this key? Higgsfield generations will spend Beamwall credits again.
              </p>
              <button
                onClick={disconnectKey}
                disabled={keyBusy}
                className="rounded-full bg-amber-500/20 hover:bg-amber-500/30 px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] text-amber-200 transition-colors disabled:opacity-40"
              >
                {keyBusy ? 'Removing…' : 'Remove key'}
              </button>
              <button
                onClick={() => setConfirmDisconnect(false)}
                disabled={keyBusy}
                className="rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg/80 transition-colors disabled:opacity-40"
              >
                Keep it
              </button>
            </div>
          )}

          {/* The form shows while nothing is stored — and stays hidden while the
              status is unknown, so a failed read never invites a host to
              overwrite a key they may already have. */}
          {!noOrg && keyStatus !== null && !keyStatus.configured && (
            <div className="flex flex-col gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="font-label uppercase tracking-widest text-[9px] text-brand-muted/50">Key id</span>
                  <input
                    type="text"
                    value={keyId}
                    onChange={(e) => onKeyIdChange(e.target.value)}
                    maxLength={KEY_FIELD_MAX}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Paste key id — or id:secret"
                    className="w-full rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2.5 font-mono text-[11px] text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/50"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-label uppercase tracking-widest text-[9px] text-brand-muted/50">Key secret</span>
                  <input
                    type="password"
                    value={keySecret}
                    onChange={(e) => setKeySecret(e.target.value)}
                    maxLength={KEY_FIELD_MAX}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder="Paste key secret"
                    className="w-full rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2.5 font-mono text-[11px] text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/50"
                  />
                </label>
              </div>
              <p className="font-sans text-[10px] text-brand-muted/40 leading-relaxed">
                Stored encrypted and write-only — we can never show it back to you. Paste a new pair any time to replace it.
              </p>
              <button
                onClick={connectKey}
                disabled={keyBusy || !keyId.trim() || !keySecret.trim()}
                className="self-start rounded-full bg-foil px-5 min-h-11 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-40"
              >
                {keyBusy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          )}

          {keyFailed && !loading && (
            <button
              onClick={load}
              className="self-start flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-3 min-h-11 font-label uppercase tracking-luxe text-[9px] text-brand-fg/80 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          )}
          {keyError && (
            <p className="font-sans text-[11px] text-red-300" role="alert">{keyError}</p>
          )}
          {keyNotice && (
            <p className="font-sans text-[11px] text-emerald-200/90">{keyNotice}</p>
          )}
        </div>
      </div>

      {/* Ledger */}
      <div className="liquid-glass rounded-2xl p-5">
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 mb-3">
          Recent credit activity
        </p>
        {ledger.length === 0 ? (
          <div className="py-4 text-center">
            <p className={`font-sans text-xs ${ledgerFailed && !loading ? 'text-amber-300/90' : 'text-brand-muted/50'}`}>
              {loading
                ? 'Loading…'
                : ledgerFailed
                ? 'We couldn’t load your credit activity — this is not a record of zero purchases.'
                : 'No credit activity yet.'}
            </p>
            {ledgerFailed && !loading && (
              <button
                onClick={load}
                className="mt-3 min-h-11 rounded-lg px-4 bg-white/[0.06] font-label uppercase tracking-luxe text-[10px] text-brand-fg"
              >
                Try again
              </button>
            )}
          </div>
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
