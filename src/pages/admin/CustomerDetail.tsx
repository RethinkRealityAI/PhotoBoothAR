/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/customers/:orgId — one organization: members (with resolved emails),
 * events, one-time event-plan purchases, Pro subscription, credit balance +
 * recent ledger. Read-only in Phase 2 (mutations land in Phase 4's Users screen).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AdminHeader, AdminNotice, AdminPage, RefreshButton, StatTile } from './AdminChrome';
import { fetchOrg, adjustCredits, type OrgDetail } from '../../lib/admin';
import { formatCount, formatDate } from '../../lib/adminFormat';
import StatusPill from '../../components/ui/StatusPill';
import ConfirmModal from '../../components/ui/ConfirmModal';

const sectionTitle = 'font-sans text-sm font-semibold text-brand-fg mb-3';
const emptyRow = 'p-5 font-sans text-sm text-brand-muted/75';
const fieldLabel = 'font-sans text-[11px] text-brand-muted/75';
const fieldInput = 'min-h-11 rounded-xl bg-white/[0.06] border border-white/10 px-3 text-sm text-brand-fg placeholder:text-brand-muted/60 outline-none focus:border-[color:var(--color-accent)]/60';

function BackToCustomers() {
  return (
    <Link to="/admin/customers" className="-ml-1 mb-2 inline-flex items-center gap-1.5 min-h-11 px-1 font-sans text-[13px] text-brand-muted/75 hover:text-brand-fg">
      <ArrowLeft className="w-4 h-4" /> Customers
    </Link>
  );
}

export default function CustomerDetail() {
  const { orgId = '' } = useParams<{ orgId: string }>();
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [grantAmt, setGrantAmt] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [granting, setGranting] = useState(false);
  /** A grant awaiting explicit confirmation. */
  const [pendingGrant, setPendingGrant] = useState<{ delta: number; reason: string } | null>(null);
  const [grantMsg, setGrantMsg] = useState<string | null>(null);

  const load = async () => {
    setState('loading');
    const { data, error } = await fetchOrg(orgId);
    if (error || !data) { setState('error'); return; }
    setDetail(data);
    setState('ready');
  };

  useEffect(() => { load(); }, [orgId]);

  async function grant(e: FormEvent) {
    e.preventDefault();
    const delta = Math.trunc(Number(grantAmt));
    const reason = grantReason.trim();
    if (!Number.isFinite(delta) || delta === 0 || !reason) { setGrantMsg('Enter a non-zero amount and a reason.'); return; }
    // This is a bare <form>, so Enter in either field submits it — and the
    // adjustment used to apply instantly, with "500" typed for "50" only
    // reversible by a second manual grant. Confirm first, in the app's own
    // dialog rather than a native window.confirm.
    setPendingGrant({ delta, reason });
  }

  async function applyGrant() {
    const pending = pendingGrant;
    if (!pending) return;
    const { delta, reason } = pending;
    setPendingGrant(null);
    setGranting(true); setGrantMsg(null);
    const { error } = await adjustCredits(orgId, delta, reason);
    setGranting(false);
    if (error) { setGrantMsg('Failed — try again.'); return; }
    setGrantAmt(''); setGrantReason(''); setGrantMsg('Applied.');
    load();
  }

  if (state === 'loading') {
    return (
      <AdminPage>
        <BackToCustomers />
        <div className="h-8 w-48 glass rounded-lg motion-safe:animate-pulse mb-8" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 glass rounded-2xl motion-safe:animate-pulse" />)}
        </div>
      </AdminPage>
    );
  }

  if (state === 'error' || !detail) {
    return (
      <AdminPage>
        <BackToCustomers />
        <AdminNotice title="Couldn’t load this organization" action={{ label: 'Try again', onClick: load }}>
          The platform API didn’t answer, or this organization no longer exists.
        </AdminNotice>
      </AdminPage>
    );
  }

  const { org, members, events, eventPlans, subscription, creditBalance, ledger } = detail;
  const planByEvent = new Map(eventPlans.map((p) => [p.event_id, p]));

  return (
    <AdminPage>
      <BackToCustomers />
      <AdminHeader
        title={org.name}
        subtitle={`Joined ${formatDate(org.created_at)}`}
        actions={<RefreshButton onClick={load} />}
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <div className="glass-strong rounded-2xl p-5">
          <p className="font-sans text-[11px] text-brand-muted/75">Subscription</p>
          {subscription ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="font-serif text-2xl text-foil-static capitalize leading-none">{subscription.tier}</span>
              <StatusPill status={subscription.status} />
            </div>
          ) : (
            <p className="mt-2 font-sans text-sm text-brand-muted/75">Free, no subscription</p>
          )}
          {subscription?.current_period_end && (
            <p className="mt-2 font-sans text-[11px] text-brand-muted/65">Renews {formatDate(subscription.current_period_end)}</p>
          )}
        </div>
        <StatTile label="Credits" value={formatCount(creditBalance)} />
        <div className="glass-strong rounded-2xl p-5">
          <p className="font-sans text-[11px] text-brand-muted/75">Stripe customer</p>
          <p className="mt-2 font-sans text-sm text-brand-fg/90">{org.stripe_customer_id ? 'Connected' : 'Not connected yet'}</p>
        </div>
      </div>

      <section className="mb-8">
        <h2 className={sectionTitle}>
          Members <span className="font-normal text-brand-muted/70">({members.length})</span>
        </h2>
        <div className="glass rounded-2xl divide-y divide-white/[0.06]">
          {members.length === 0 ? (
            <p className={emptyRow}>No members.</p>
          ) : (
            members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-sans text-sm text-brand-fg truncate">{m.displayName || m.email || m.userId}</p>
                  {m.email && m.displayName && <p className="font-mono text-[11px] text-brand-muted/75 truncate">{m.email}</p>}
                </div>
                <span className="shrink-0 font-sans text-[11px] text-brand-muted/75 capitalize">{m.role}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className={sectionTitle}>
          Events <span className="font-normal text-brand-muted/70">({events.length})</span>
        </h2>
        <div className="glass rounded-2xl divide-y divide-white/[0.06]">
          {events.length === 0 ? (
            <p className={emptyRow}>No events yet.</p>
          ) : (
            events.map((ev) => {
              const plan = planByEvent.get(ev.id);
              return (
                <div key={ev.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-sans text-sm text-brand-fg truncate">{ev.name}</p>
                    <p className="font-mono text-[10px] text-brand-muted/70 truncate">/e/{ev.slug}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {plan && <span className="font-sans text-[11px] text-accent capitalize">{plan.tier}</span>}
                    <StatusPill status={ev.status} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className={sectionTitle}>Grant or remove credits</h2>
        <form onSubmit={grant} className="glass rounded-2xl p-5 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Amount (negative removes)</span>
            <input
              type="number" value={grantAmt} onChange={(e) => setGrantAmt(e.target.value)} placeholder="50 or -10"
              className={`w-32 ${fieldInput}`}
            />
          </label>
          <label className="flex flex-1 min-w-[10rem] flex-col gap-1">
            <span className={fieldLabel}>Reason (goes in the audit log)</span>
            <input
              value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="e.g. goodwill credit"
              className={`w-full ${fieldInput}`}
            />
          </label>
          <button
            type="submit" disabled={granting}
            className="pressable min-h-11 rounded-full bg-foil px-5 font-sans text-sm font-semibold text-[color:var(--on-accent)] glow-accent transition active:scale-[0.98] disabled:opacity-60"
          >
            {granting ? 'Applying…' : 'Apply'}
          </button>
          {grantMsg && <span role="status" className="text-xs text-brand-muted/80">{grantMsg}</span>}
        </form>
      </section>

      <section>
        <h2 className={sectionTitle}>Recent credit activity</h2>
        <div className="glass rounded-2xl divide-y divide-white/[0.06]">
          {ledger.length === 0 ? (
            <p className={emptyRow}>No credit activity yet.</p>
          ) : (
            ledger.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-sans text-xs text-brand-fg truncate">{l.reason}</p>
                  <p className="font-sans text-[11px] text-brand-muted/65">{formatDate(l.created_at)}</p>
                </div>
                <span className={`shrink-0 font-mono text-xs tabular-nums ${l.delta >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {l.delta >= 0 ? '+' : ''}{l.delta}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {pendingGrant && (
        <ConfirmModal
          tone="danger"
          title={`${pendingGrant.delta > 0 ? 'Grant' : 'Remove'} ${Math.abs(pendingGrant.delta)} credit${Math.abs(pendingGrant.delta) === 1 ? '' : 's'}?`}
          confirmLabel={pendingGrant.delta > 0 ? 'Grant credits' : 'Remove credits'}
          busy={granting}
          onCancel={() => setPendingGrant(null)}
          onConfirm={applyGrant}
          body={
            <>
              <p>
                {pendingGrant.delta > 0 ? 'To' : 'From'}{' '}
                <span className="text-brand-fg">{detail?.org.name ?? 'this organization'}</span>.
              </p>
              <p className="mt-2">
                Balance <span className="text-brand-fg">{detail?.creditBalance ?? 0}</span> →{' '}
                <span className="text-brand-fg">{(detail?.creditBalance ?? 0) + pendingGrant.delta}</span>
              </p>
              <p className="mt-2">Reason: <span className="text-brand-fg">{pendingGrant.reason}</span></p>
              <p className="mt-3 text-brand-muted/75">Reversible only by a second manual adjustment.</p>
            </>
          }
        />
      )}
    </AdminPage>
  );
}
