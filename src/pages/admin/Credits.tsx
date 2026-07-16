/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/credits — platform credit controls: the admin-editable welcome-credit
 * amount every new account receives, plus promo-code management (create codes
 * that grant bonus credits at signup, with optional usage caps + expiry).
 *
 * Per-org one-off credit grants live on the Customer detail screen; this is the
 * platform-wide config + the promo catalogue.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Check, Plus, Ticket } from 'lucide-react';
import {
  fetchPlatformConfig, setSignupCredits, fetchPromos, createPromo, setPromoActive, type PromoCode,
} from '../../lib/admin';

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export default function Credits() {
  /* Welcome credits */
  const [bonus, setBonus] = useState<number | null>(null);
  const [bonusInput, setBonusInput] = useState('');
  const [savingBonus, setSavingBonus] = useState(false);
  const [bonusMsg, setBonusMsg] = useState<string | null>(null);

  /* Promo codes */
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loadingPromos, setLoadingPromos] = useState(true);
  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [promoErr, setPromoErr] = useState<string | null>(null);

  useEffect(() => {
    fetchPlatformConfig().then((r) => {
      if (!r.error && r.data) {
        setBonus(r.data.signupBonusCredits);
        setBonusInput(String(r.data.signupBonusCredits));
      }
    });
    fetchPromos().then((r) => {
      if (r.data) setPromos(r.data);
      setLoadingPromos(false);
    });
  }, []);

  async function saveBonus(e: FormEvent) {
    e.preventDefault();
    const amount = Math.trunc(Number(bonusInput));
    if (!Number.isFinite(amount) || amount < 0) { setBonusMsg('Enter a whole number ≥ 0.'); return; }
    setSavingBonus(true);
    setBonusMsg(null);
    const r = await setSignupCredits(amount);
    setSavingBonus(false);
    if (!r.error && r.data) { setBonus(r.data.signupBonusCredits); setBonusMsg('Saved.'); }
    else setBonusMsg('Could not save — try again.');
  }

  async function submitPromo(e: FormEvent) {
    e.preventDefault();
    setPromoErr(null);
    const creditsN = Math.trunc(Number(credits));
    const maxN = maxRedemptions.trim() ? Math.trunc(Number(maxRedemptions)) : null;
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(code.trim())) { setPromoErr('Code: 3–40 letters, numbers, - or _.'); return; }
    if (!Number.isFinite(creditsN) || creditsN <= 0) { setPromoErr('Credits must be a positive number.'); return; }
    if (maxN !== null && (!Number.isFinite(maxN) || maxN <= 0)) { setPromoErr('Max redemptions must be positive or blank.'); return; }
    setCreating(true);
    const r = await createPromo({
      code: code.trim(),
      credits: creditsN,
      maxRedemptions: maxN,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
    setCreating(false);
    if (!r.error && r.data) {
      setPromos((p) => [r.data as PromoCode, ...p]);
      setCode(''); setCredits(''); setMaxRedemptions(''); setExpiresAt('');
    } else {
      setPromoErr(r.error === 'code_exists' ? 'That code already exists.' : 'Could not create the code.');
    }
  }

  async function toggleActive(promo: PromoCode) {
    const r = await setPromoActive(promo.id, !promo.active);
    if (!r.error) setPromos((list) => list.map((p) => (p.id === promo.id ? { ...p, active: !p.active } : p)));
  }

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-8">
      <h1 className="font-serif text-3xl text-foil-static">Credits</h1>
      <p className="mt-2 text-sm text-brand-muted/70">Welcome credits for new accounts, and promo codes.</p>

      {/* Welcome credits */}
      <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="font-label uppercase tracking-luxe text-[11px] text-brand-muted/70">Welcome credits</h2>
        <p className="mt-2 text-sm text-brand-muted/70">
          Every new account is granted this many credits when its first event/org is created
          {bonus !== null && <> (currently <span className="text-brand-fg">{bonus}</span>)</>}.
        </p>
        <form onSubmit={saveBonus} className="mt-4 flex items-center gap-3">
          <input
            type="number" min={0} step={1} value={bonusInput}
            onChange={(e) => setBonusInput(e.target.value)}
            className={`${inputClass} max-w-[8rem]`}
          />
          <button
            type="submit" disabled={savingBonus}
            className="rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-60"
          >
            {savingBonus ? 'Saving…' : 'Save'}
          </button>
          {bonusMsg && <span className="text-xs text-brand-muted/70">{bonusMsg}</span>}
        </form>
      </section>

      {/* Promo codes */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="flex items-center gap-2 font-label uppercase tracking-luxe text-[11px] text-brand-muted/70">
          <Ticket className="h-4 w-4" /> Promo codes
        </h2>

        <form onSubmit={submitPromo} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">Code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WELCOME50" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">Credits</span>
            <input type="number" min={1} value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="50" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">Max redemptions (optional)</span>
            <input type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="Unlimited" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">Expires (optional)</span>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputClass} />
          </label>
          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit" disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" /> {creating ? 'Creating…' : 'Create code'}
            </button>
            {promoErr && <span role="alert" className="text-xs text-red-400">{promoErr}</span>}
          </div>
        </form>

        <div className="mt-6 flex flex-col gap-2">
          {loadingPromos ? (
            <p className="text-sm text-brand-muted/50">Loading…</p>
          ) : promos.length === 0 ? (
            <p className="text-sm text-brand-muted/50">No promo codes yet.</p>
          ) : (
            promos.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
                <span className="font-mono font-semibold text-brand-fg">{p.code}</span>
                <span className="text-accent">{p.credits} cr</span>
                <span className="text-brand-muted/60">
                  {p.redemptions}{p.max_redemptions != null ? `/${p.max_redemptions}` : ''} used
                </span>
                <span className="text-brand-muted/60">exp {fmtDate(p.expires_at)}</span>
                <button
                  onClick={() => toggleActive(p)}
                  className={`ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 font-label uppercase tracking-luxe text-[9px] font-semibold transition ${
                    p.active ? 'bg-[color:var(--color-accent)]/15 text-accent' : 'border border-white/15 text-brand-muted/60 hover:text-brand-fg'
                  }`}
                >
                  {p.active && <Check className="h-3 w-3" />}{p.active ? 'Active' : 'Inactive'}
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
