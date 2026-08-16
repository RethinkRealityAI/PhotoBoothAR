/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/features — plans, feature flags and the ops kill switches, with a live
 * "what they'll see" preview.
 *
 * Three things this screen is careful about:
 *
 * 1. PROVENANCE. Four resolution layers is a lot to hold in your head at 2am,
 *    so every flag row states which layer produced its value. A four-layer
 *    system without that is unmaintainable; with it, it is fine.
 * 2. COMPS EXPIRE. Granting a paid capability with no end date is how a free
 *    tier gets created by accident — nobody remembers granting it, and the
 *    revenue notices first. The expiry field is prompted, and a permanent grant
 *    has to be chosen deliberately.
 * 3. THE PREVIEW CANNOT LIE. It renders from the same pure selectors the real
 *    screens use (see FeaturePreview's docblock).
 *
 * The resolver itself is in SQL (migration 028) and is the only authority;
 * nothing on this screen re-implements precedence.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, Power, Search, ShieldAlert } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import ConfirmModal from '../../components/ui/ConfirmModal';
import LoadError from '../../components/ui/LoadError';
import StatusPill from '../../components/ui/StatusPill';
import FeaturePreview from '../../components/admin/FeaturePreview';
import { ENTITLEMENTS, normalizeTier, type PlanTier } from '../../lib/plans';
import { diffPlanDefaults, type FeatureSet } from '../../lib/features';
import { planChange, expiryWarning } from '../../lib/planSync';
import {
  fetchOrgs, fetchFeatureFlags, resolveFeaturesFor, setOrgOverride, clearOrgOverride,
  setFlagKill, setPlanDefault, setOrgPlan,
  type OrgRow, type FeatureFlagRow, type PlanDefaultRow, type ResolvedFeature,
} from '../../lib/admin';
import { registryNote } from './registryNote';

const TIERS: PlanTier[] = ['free', 'essentials', 'premium', 'deluxe'];

const LAYER_LABEL: Record<ResolvedFeature['layer'], string> = {
  plan_default: 'plan default',
  org_override: 'org override',
  event_override: 'event override',
  kill_switch: 'KILL SWITCH',
  legacy: 'legacy event',
};

/** Turn the resolver's provenance map into the plain shape the selectors read. */
function toFeatureSet(resolved: Record<string, ResolvedFeature>): FeatureSet {
  const base: Record<string, unknown> = { ...ENTITLEMENTS.free };
  for (const [k, v] of Object.entries(resolved)) base[k] = v.value;
  return base as unknown as FeatureSet;
}

function fmtValue(v: unknown): string {
  if (v === null) return 'unlimited';
  if (v === true) return 'on';
  if (v === false) return 'off';
  return String(v);
}

export default function AdminFeatures() {
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  /** The customer search itself failed. Without this the picker answered a
   *  dead admin-api with "No customers match." — telling an operator hunting
   *  for the account they need to change that the account does not exist. */
  const [orgsFailed, setOrgsFailed] = useState(false);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [org, setOrg] = useState<OrgRow | null>(null);

  const [flags, setFlags] = useState<FeatureFlagRow[]>([]);
  const [planDefaults, setPlanDefaults] = useState<PlanDefaultRow[]>([]);
  const [resolved, setResolved] = useState<Record<string, ResolvedFeature>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<'customer' | 'defaults' | 'kill'>('customer');

  // Plan editor
  const [planTier, setPlanTier] = useState<PlanTier>('free');
  const [planExpiry, setPlanExpiry] = useState('');
  const [planNote, setPlanNote] = useState('');
  const [syncStripe, setSyncStripe] = useState(true);
  const [confirmPlan, setConfirmPlan] = useState(false);

  const loadFlags = useCallback(async () => {
    const { data, error } = await fetchFeatureFlags();
    setLoadErr(error);
    setFlags(data?.flags ?? []);
    setPlanDefaults(data?.planDefaults ?? []);
  }, []);

  useEffect(() => { void loadFlags(); }, [loadFlags]);

  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      void fetchOrgs({ search, limit: 20 }).then(({ data, error }) => {
        if (!alive) return;
        setOrgsFailed(error !== null || !data);
        setOrgs(data?.orgs ?? []);
        setOrgsLoaded(true);
      });
    }, search === '' ? 0 : 300);
    return () => { alive = false; clearTimeout(id); };
  }, [search]);

  const loadResolved = useCallback(async (orgId: string) => {
    const { data, error } = await resolveFeaturesFor(orgId, null);
    if (error !== null) { toast.push(`Couldn't resolve features: ${error}`, 'error'); return; }
    setResolved(data?.features ?? {});
  }, [toast]);

  useEffect(() => {
    if (org === null) { setResolved({}); return; }
    setPlanTier(normalizeTier(org.subscriptionTier));
    setPlanExpiry('');
    setPlanNote('');
    void loadResolved(org.id);
  }, [org, loadResolved]);

  const featureSet = useMemo(() => toFeatureSet(resolved), [resolved]);

  /** Live DB defaults vs the shipped bundle. Drift is visible, not discovered. */
  const drift = useMemo(() => {
    if (planDefaults.length === 0) return [];
    const live: Partial<Record<PlanTier, Partial<FeatureSet>>> = {};
    for (const d of planDefaults) {
      const t = d.tier;
      if (live[t] === undefined) live[t] = {};
      (live[t] as Record<string, unknown>)[d.flag_key] = d.value;
    }
    return diffPlanDefaults(ENTITLEMENTS, live);
  }, [planDefaults]);

  async function toggleOrgFlag(f: FeatureFlagRow, next: unknown) {
    if (org === null) return;
    setBusy(true);
    const { error } = next === undefined
      ? await clearOrgOverride(org.id, f.key)
      : await setOrgOverride(org.id, f.key, next, planNote || 'admin override', planExpiry || null);
    setBusy(false);
    if (error !== null) { toast.push(`Couldn't save: ${error}`, 'error'); return; }
    toast.push(next === undefined ? `${f.label} back to inherited.` : `${f.label} set.`, 'success');
    await loadResolved(org.id);
  }

  async function toggleKill(f: FeatureFlagRow) {
    if (!f.killable) { toast.push(`${f.label} cannot be killed — it would break a live wall.`, 'error'); return; }
    setBusy(true);
    const { error } = await setFlagKill(f.key, !f.killed, false, 'ops kill switch');
    setBusy(false);
    if (error !== null) { toast.push(`Couldn't flip the switch: ${error}`, 'error'); return; }
    toast.push(f.killed ? `${f.label} restored platform-wide.` : `${f.label} KILLED platform-wide.`,
      f.killed ? 'success' : 'info');
    await loadFlags();
    if (org !== null) await loadResolved(org.id);
  }

  async function savePlan() {
    if (org === null) return;
    setConfirmPlan(false);
    setBusy(true);
    const { data, error } = await setOrgPlan(org.id, planTier, planExpiry || null, planNote, syncStripe);
    setBusy(false);
    if (error !== null) { toast.push(`Plan change failed: ${error}`, 'error'); return; }
    // Honest about Stripe: the plan applied either way.
    if (data?.stripeError !== null && data?.stripeError !== undefined) {
      toast.push(`Plan set to ${planTier}. Stripe was NOT updated (${data.stripeError}).`, 'info');
    } else {
      toast.push(`Plan set to ${planTier}.${data?.stripeSynced === true ? ' Stripe updated.' : ''}`, 'success');
    }
    await loadResolved(org.id);
  }

  const change = org === null ? null : planChange({
    current: normalizeTier(org.subscriptionTier),
    next: planTier,
    hasActiveSubscription: org.subscriptionStatus === 'active',
  });
  const expiryNote = expiryWarning(planTier, planExpiry || null);

  const chip = 'pressable rounded-full px-3 py-1.5 min-h-9 font-label uppercase tracking-luxe text-[10px] border transition-colors';
  const chipOn = 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg';
  const chipOff = 'bg-white/[0.03] border-white/10 text-brand-muted/60 hover:text-brand-fg';
  const input = 'w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-[color:var(--color-accent)]/50';

  return (
    <div className="min-h-full px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5">
          <h1 className="font-serif text-2xl md:text-3xl text-foil-static">Plans &amp; features</h1>
          <p className="font-sans text-sm text-brand-muted/60 mt-1">
            Upgrade an account, grant one capability to one customer, or turn a feature off for everybody.
          </p>
          <p className="font-sans text-[11px] text-brand-muted/50 mt-1" aria-live="polite">
            {registryNote(flags.length, 'feature flag')}
          </p>
        </header>

        {loadErr !== null && (
          <LoadError what="the flag registry" code={loadErr} onRetry={() => void loadFlags()} />
        )}

        {drift.length > 0 && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />
            <p className="font-sans text-xs leading-relaxed text-amber-100/90">
              The live plan defaults differ from the shipped build for{' '}
              <span className="font-mono">{drift.join(', ')}</span>. The database wins — the app
              is only optimistic — but this is worth knowing about.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {(['customer', 'defaults', 'kill'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`${chip} ${tab === t ? chipOn : chipOff}`}>
              {t === 'customer' ? 'One customer' : t === 'defaults' ? 'Plan defaults' : 'Kill switches'}
            </button>
          ))}
        </div>

        {/* ── One customer ── */}
        {tab === 'customer' && (
          <div className="grid lg:grid-cols-[1fr_380px] gap-4">
            <div className="space-y-4">
              <div className="liquid-glass rounded-2xl p-4">
                <div className="relative mb-3">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/40" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a customer…" className={`${input} pl-9`} />
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {orgs.map((o) => (
                    <button key={o.id} onClick={() => setOrg(o)}
                      className={`${chip} ${org?.id === o.id ? chipOn : chipOff}`}>
                      <Building2 className="w-3 h-3 inline mr-1.5" />{o.name}
                    </button>
                  ))}
                  {orgs.length === 0 && (
                    <p className={`font-sans text-xs py-2 ${orgsFailed ? 'text-amber-300/90' : 'text-brand-muted/50'}`}>
                      {!orgsLoaded
                        ? 'Searching…'
                        : orgsFailed
                        ? 'Couldn’t search customers — this is not "no matches".'
                        : 'No customers match.'}
                    </p>
                  )}
                </div>
              </div>

              {org === null ? (
                <div className="liquid-glass rounded-2xl p-10 text-center">
                  <p className="font-sans text-sm text-brand-muted/50">Pick a customer to see and change what they can do.</p>
                </div>
              ) : (
                <>
                  {/* Plan */}
                  <div className="liquid-glass rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <h2 className="font-serif text-lg text-brand-fg">{org.name}</h2>
                      {org.subscriptionStatus !== null && <StatusPill status={org.subscriptionStatus} />}
                      <span className="ml-auto font-sans text-[11px] text-brand-muted/50">
                        {org.eventCount} event{org.eventCount === 1 ? '' : 's'} · {org.creditBalance} cr
                      </span>
                    </div>

                    <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50 mb-2">Account plan</p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {TIERS.map((t) => (
                        <button key={t} onClick={() => setPlanTier(t)}
                          className={`${chip} ${planTier === t ? chipOn : chipOff}`}>{t}</button>
                      ))}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-2 mb-3">
                      <label className="block">
                        <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">Expires</span>
                        <input type="date" value={planExpiry} onChange={(e) => setPlanExpiry(e.target.value)}
                          className={`${input} mt-1`} />
                      </label>
                      <label className="block">
                        <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">Why (audited)</span>
                        <input value={planNote} onChange={(e) => setPlanNote(e.target.value)}
                          placeholder="e.g. conference comp" className={`${input} mt-1`} />
                      </label>
                    </div>

                    {expiryNote !== null && (
                      <p className="font-sans text-xs text-amber-300/90 mb-2">{expiryNote}</p>
                    )}
                    {change?.warning !== null && change?.warning !== undefined && (
                      <p className="font-sans text-xs text-brand-muted/70 mb-3 leading-relaxed">{change.warning}</p>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="inline-flex items-center gap-2 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 cursor-pointer">
                        <input type="checkbox" checked={syncStripe} onChange={(e) => setSyncStripe(e.target.checked)}
                          className="accent-[color:var(--color-accent)]" />
                        Also update Stripe
                      </label>
                      <button onClick={() => setConfirmPlan(true)} disabled={busy}
                        className="pressable ml-auto min-h-11 px-4 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-40">
                        Apply plan
                      </button>
                    </div>
                  </div>

                  {/* Flags */}
                  <div className="liquid-glass rounded-2xl p-4">
                    <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50 mb-3">
                      Capabilities for {org.name}
                    </p>
                    <div className="space-y-1.5">
                      {flags.map((f) => {
                        const r = resolved[f.key];
                        const isOverride = r?.layer === 'org_override';
                        return (
                          <div key={f.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <p className="font-sans text-sm text-brand-fg/90">
                                {f.label}
                                {f.paid && <span className="ml-2 text-[9px] font-label uppercase tracking-luxe text-amber-300/70">paid</span>}
                              </p>
                              <p className="font-sans text-[11px] text-brand-muted/45">
                                {/* The provenance trail — see the file docblock. */}
                                {r === undefined ? '—' : `${LAYER_LABEL[r.layer]} → ${fmtValue(r.value)}`}
                                {r?.note !== null && r?.note !== undefined && r.note !== '' && ` (${r.note})`}
                              </p>
                            </div>
                            {f.value_type === 'boolean' ? (
                              <div className="flex gap-1">
                                <button disabled={busy} onClick={() => void toggleOrgFlag(f, true)}
                                  className={`${chip} ${isOverride && r?.value === true ? chipOn : chipOff}`}>on</button>
                                <button disabled={busy} onClick={() => void toggleOrgFlag(f, false)}
                                  className={`${chip} ${isOverride && r?.value === false ? chipOn : chipOff}`}>off</button>
                                <button disabled={busy || !isOverride} onClick={() => void toggleOrgFlag(f, undefined)}
                                  className={`${chip} ${chipOff} disabled:opacity-30`}>inherit</button>
                              </div>
                            ) : (
                              <div className="flex gap-1 items-center">
                                <input
                                  type="number" min={0} placeholder="number"
                                  aria-label={`${f.label} value`}
                                  defaultValue={typeof r?.value === 'number' ? r.value : undefined}
                                  onBlur={(e) => {
                                    const raw = e.target.value.trim();
                                    if (raw === '') return;
                                    void toggleOrgFlag(f, Number(raw));
                                  }}
                                  className="w-24 rounded-lg bg-white/[0.04] border border-white/10 px-2 py-1.5 text-xs text-brand-fg"
                                />
                                <button disabled={busy} onClick={() => void toggleOrgFlag(f, null)}
                                  className={`${chip} ${isOverride && r?.value === null ? chipOn : chipOff}`}>∞</button>
                                <button disabled={busy || !isOverride} onClick={() => void toggleOrgFlag(f, undefined)}
                                  className={`${chip} ${chipOff} disabled:opacity-30`}>inherit</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="lg:sticky lg:top-6 h-fit">
              <FeaturePreview features={featureSet} />
            </div>
          </div>
        )}

        {/* ── Plan defaults ── */}
        {tab === 'defaults' && (
          <div className="liquid-glass rounded-2xl p-4 overflow-x-auto">
            <p className="font-sans text-xs text-brand-muted/60 mb-4">
              What each tier grants by default. Changing these changes every customer on that tier —
              overrides and kill switches still win.
            </p>
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/45">
                  <th className="pb-2 pr-4">Capability</th>
                  {TIERS.map((t) => <th key={t} className="pb-2 pr-4">{t}</th>)}
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.key} className="border-t border-white/[0.06]">
                    <td className="py-2.5 pr-4 font-sans text-sm text-brand-fg/85">{f.label}</td>
                    {TIERS.map((t) => {
                      const row = planDefaults.find((d) => d.tier === t && d.flag_key === f.key);
                      const v = row?.value;
                      return (
                        <td key={t} className="py-2.5 pr-4">
                          {f.value_type === 'boolean' ? (
                            <button
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                const { error } = await setPlanDefault(t, f.key, !(v === true));
                                setBusy(false);
                                if (error !== null) { toast.push(`Couldn't save: ${error}`, 'error'); return; }
                                await loadFlags();
                              }}
                              className={`${chip} ${v === true ? chipOn : chipOff}`}
                            >
                              {v === true ? 'on' : 'off'}
                            </button>
                          ) : (
                            <span className="font-sans text-xs text-brand-muted/70">{fmtValue(v)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Kill switches ── */}
        {tab === 'kill' && (
          <div className="liquid-glass rounded-2xl p-4">
            <div className="flex items-start gap-3 rounded-xl border border-rose-400/25 bg-rose-400/[0.05] px-4 py-3 mb-4">
              <ShieldAlert className="w-4 h-4 shrink-0 text-rose-300 mt-0.5" />
              <p className="font-sans text-xs leading-relaxed text-rose-100/85">
                These switch a capability off for <strong>every customer instantly</strong>, overriding
                paid plans and comps alike. This is the valve for "the AI provider is down or burning
                money" — not a way to manage one account.
              </p>
            </div>
            <div className="space-y-1.5">
              {flags.map((f) => (
                <div key={f.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-sans text-sm text-brand-fg/90">{f.label}</p>
                    <p className="font-sans text-[11px] text-brand-muted/45">{f.description}</p>
                  </div>
                  {f.killed && <StatusPill status="disabled" />}
                  <button
                    disabled={busy || !f.killable}
                    onClick={() => void toggleKill(f)}
                    title={f.killable ? undefined : 'Not killable — switching this off would break a live wall.'}
                    className={`${chip} ${f.killed ? 'bg-rose-500/15 border-rose-400/40 text-rose-200' : chipOff} disabled:opacity-30`}
                  >
                    <Power className="w-3 h-3 inline mr-1.5" />
                    {f.killed ? 'Restore' : 'Kill'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {confirmPlan && org !== null && (
        <ConfirmModal
          title={`Set ${org.name} to ${planTier}?`}
          confirmLabel="Apply plan"
          tone={change?.stripeAction === 'cancel_at_period_end' ? 'danger' : 'caution'}
          onConfirm={() => void savePlan()}
          onCancel={() => setConfirmPlan(false)}
          busy={busy}
          body={
            <>
              <p className="leading-relaxed">{change?.warning ?? 'This takes effect immediately.'}</p>
              {expiryNote !== null && (
                <p className="mt-2 leading-relaxed text-amber-300/90">{expiryNote}</p>
              )}
              {syncStripe && (
                <p className="mt-2 leading-relaxed text-brand-muted/50">
                  Stripe gets a metadata update only. No card is charged from here, ever.
                </p>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
