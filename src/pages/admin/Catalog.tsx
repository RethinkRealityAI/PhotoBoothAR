/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/catalog — the product catalogue, and the button that provisions it
 * into Stripe.
 *
 * Before this, `stripe-checkout` built every line item from inline `price_data`,
 * so no Stripe Product or Price had ever existed: there was nothing to move a
 * subscription onto, Stripe's own reporting saw unrelated ad-hoc charges, and
 * the prices lived in one file while the credit grants lived in another.
 * Migration 029 made the database the single source for both; this screen is
 * how it is edited, and how it is pushed to Stripe.
 *
 * Two money rules the UI has to make visible rather than assume:
 *   - A Stripe Price is IMMUTABLE. Changing an amount cannot edit the Price; it
 *     must create a new one. So editing the amount clears the provisioned price
 *     id, and the row visibly returns to "not provisioned" until re-synced —
 *     rather than looking synced while quietly charging the old number.
 *   - Test vs live is stated on the button, because sandbox metadata that gets
 *     mistaken for production truth is its own outage.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, CloudUpload, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import LoadError from '../../components/ui/LoadError';
import StatusPill from '../../components/ui/StatusPill';
import { formatAmount } from '../../lib/planSync';
import {
  fetchCatalog, updateCatalogItem, syncCatalogToStripe, type CatalogItem,
} from '../../lib/admin';

const KIND_LABEL: Record<CatalogItem['kind'], string> = {
  event_package: 'Event packages',
  credit_pack: 'Credit packs',
  pro_subscription: 'Subscription',
};

const KINDS: CatalogItem['kind'][] = ['event_package', 'credit_pack', 'pro_subscription'];

export default function AdminCatalog() {
  const toast = useToast();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error } = await fetchCatalog();
    setErr(error);
    setItems(data?.items ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveAmount(item: CatalogItem) {
    const raw = (draft[item.id] ?? '').trim();
    if (raw === '') return;
    // Dollars in the box, integer cents on the wire — never a float in the DB.
    const dollars = Number(raw);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.push('That is not a price.', 'error');
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents === item.amount_cents) return;

    setBusyId(item.id);
    const { error } = await updateCatalogItem(item.id, { amountCents: cents });
    setBusyId(null);
    if (error !== null) { toast.push(`Couldn't save: ${error}`, 'error'); return; }
    toast.push(`${item.name} is now ${formatAmount(cents)}. Re-sync to push it to Stripe.`, 'success');
    setDraft((d) => ({ ...d, [item.id]: '' }));
    await load();
  }

  async function toggleActive(item: CatalogItem) {
    setBusyId(item.id);
    const { error } = await updateCatalogItem(item.id, { active: !item.active });
    setBusyId(null);
    if (error !== null) { toast.push(`Couldn't save: ${error}`, 'error'); return; }
    await load();
  }

  async function sync(id?: string) {
    setSyncing(true);
    const { data, error } = await syncCatalogToStripe(id);
    setSyncing(false);
    if (error !== null) {
      toast.push(
        error === 'billing_not_configured'
          ? 'No Stripe key is set, so there is nothing to provision into.'
          : error === 'billing_test_mode'
            ? 'The Stripe key is a test key and ALLOW_TEST_BILLING is not "true".'
            : `Sync failed: ${error}`,
        'error',
      );
      return;
    }
    const failed = (data?.results ?? []).filter((r) => !r.ok);
    if (failed.length > 0) {
      toast.push(`${failed.length} item(s) failed to sync — see the rows for why.`, 'error');
    } else {
      toast.push(`Provisioned into Stripe (${data?.mode} mode).`, 'success');
    }
    await load();
  }

  const btn = 'pressable min-h-11 px-4 rounded-xl font-label uppercase tracking-luxe text-[10px] transition-colors';

  return (
    <div className="min-h-full px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl text-foil-static">Catalog</h1>
            <p className="font-sans text-sm text-brand-muted/60 mt-1">
              What Beamwall sells, what each purchase grants, and its Stripe product.
            </p>
          </div>
          <button onClick={() => void sync()} disabled={syncing}
            className={`${btn} bg-foil text-[color:var(--on-accent)] inline-flex items-center gap-2 disabled:opacity-40`}>
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
            {syncing ? 'Provisioning' : 'Provision in Stripe'}
          </button>
        </header>

        <div className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 mb-5">
          <AlertTriangle className="w-4 h-4 shrink-0 text-brand-muted/50 mt-0.5" />
          <p className="font-sans text-xs leading-relaxed text-brand-muted/60">
            A Stripe price can never be edited once created — changing an amount here clears the
            provisioned price and creates a new one on the next sync. Old prices stay in Stripe
            because existing orders reference them. Nothing on this screen charges anybody.
          </p>
        </div>

        {err !== null && <LoadError what="the catalog" code={err} onRetry={() => void load()} />}

        {!loaded ? (
          <div className="liquid-glass rounded-2xl p-10 flex justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {KINDS.map((kind) => {
              const rows = items.filter((i) => i.kind === kind);
              if (rows.length === 0) return null;
              return (
                <section key={kind}>
                  <h2 className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50 mb-2">
                    {KIND_LABEL[kind]}
                  </h2>
                  <div className="space-y-2">
                    {rows.map((item) => (
                      <div key={item.id} className="liquid-glass rounded-2xl p-4">
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-sans text-sm text-brand-fg/90">{item.name}</p>
                              {!item.active && <StatusPill status="archived" />}
                              {item.stripe_price_id !== null ? (
                                <span className="inline-flex items-center gap-1 font-label uppercase tracking-luxe text-[9px] text-emerald-400/80">
                                  <Check className="w-3 h-3" /> in stripe
                                </span>
                              ) : (
                                <span className="font-label uppercase tracking-luxe text-[9px] text-amber-300/80">
                                  not provisioned
                                </span>
                              )}
                            </div>
                            <p className="font-sans text-[11px] text-brand-muted/50 mt-0.5">
                              {item.description}
                            </p>
                            <p className="font-mono text-[10px] text-brand-muted/35 mt-1 break-all">
                              {item.id}
                              {item.recurring_interval !== null && ` · per ${item.recurring_interval}`}
                              {` · grants ${item.credits_granted} credits`}
                              {item.stripe_price_id !== null && ` · ${item.stripe_price_id}`}
                            </p>
                            {item.sync_error !== null && (
                              <p className="font-sans text-[11px] text-amber-300/85 mt-1 break-all">
                                Last sync failed: {item.sync_error}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="text-right">
                              <p className="font-serif text-lg text-brand-fg">
                                {formatAmount(item.amount_cents, item.currency)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="font-sans text-xs text-brand-muted/40">$</span>
                              <input
                                type="number" min={0} step="0.01"
                                aria-label={`New price for ${item.name}`}
                                placeholder={(item.amount_cents / 100).toFixed(2)}
                                value={draft[item.id] ?? ''}
                                onChange={(e) => setDraft((d) => ({ ...d, [item.id]: e.target.value }))}
                                onBlur={() => void saveAmount(item)}
                                className="w-24 rounded-lg bg-white/[0.04] border border-white/10 px-2 py-1.5 text-xs text-brand-fg"
                              />
                            </div>
                            <button onClick={() => void toggleActive(item)} disabled={busyId === item.id}
                              className={`${btn} bg-white/[0.05] text-brand-muted/70 hover:text-brand-fg disabled:opacity-40`}>
                              {item.active ? 'Retire' : 'Restore'}
                            </button>
                            <button onClick={() => void sync(item.id)} disabled={syncing || !item.active}
                              title="Provision just this item"
                              className={`${btn} bg-white/[0.05] text-brand-muted/70 hover:text-brand-fg disabled:opacity-30`}>
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
