/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UpgradeCard — per-event package upsell. Exports:
 *   • TierPill        — small plan-tier badge (EventsList cards, studio bar)
 *   • UpgradeModal    — the 3 packages (price + entitlement bullets) → Stripe
 *   • UpgradeCard     — compact studio banner (tier pill + Upgrade button)
 *
 * Checkout redirects to Stripe and returns to the current page
 * (?checkout=success|cancelled). While Stripe keys are pending the edge
 * function answers 503 billing_not_configured → a "Billing setup pending"
 * notice is shown instead.
 */
import { useState } from 'react';
import { ArrowUpRight, Check, Sparkles, X } from 'lucide-react';
import { ENTITLEMENTS, normalizeTier, type PlanTier } from '../../lib/entitlements';
import { startCheckout } from '../../lib/host';

type PaidTier = 'essentials' | 'premium' | 'deluxe';

const fmtPosts = (n: number | null) => (n === null ? 'Unlimited posts' : `${n} posts`);
const fmtRetention = (d: number | null) => (d === null ? 'Storage forever' : `${d}-day storage`);

/** Price + credit grant + entitlement-derived bullets per package. */
export const PACKAGES: { tier: PaidTier; price: string; credits: number; tagline: string; bullets: string[] }[] = [
  {
    tier: 'essentials',
    price: '$49',
    credits: 20,
    tagline: 'The must-haves',
    bullets: [
      fmtPosts(ENTITLEMENTS.essentials.maxPosts),
      'No watermark',
      'Video capture',
      'AI studio (basic)',
      fmtRetention(ENTITLEMENTS.essentials.retentionDays),
      '20 credits included',
    ],
  },
  {
    tier: 'premium',
    price: '$99',
    credits: 100,
    tagline: 'Most popular',
    bullets: [
      'Everything in Essentials',
      fmtPosts(ENTITLEMENTS.premium.maxPosts),
      'Standard photo cards',
      fmtRetention(ENTITLEMENTS.premium.retentionDays),
      '100 credits included',
    ],
  },
  {
    tier: 'deluxe',
    price: '$169',
    credits: 130,
    tagline: 'The full experience',
    bullets: [
      'Everything in Premium',
      'Premium MP4 card render',
      fmtRetention(ENTITLEMENTS.deluxe.retentionDays),
      '130 credits included',
    ],
  },
];

const TIER_ORDER: PlanTier[] = ['free', 'essentials', 'premium', 'deluxe'];

function tierPillClass(tier: PlanTier): string {
  switch (tier) {
    case 'deluxe': return 'bg-purple-500/15 text-purple-300';
    case 'premium': return 'bg-accent/15 text-accent-2';
    case 'essentials': return 'bg-sky-500/15 text-sky-300';
    default: return 'bg-white/[0.08] text-brand-muted/70';
  }
}

export function TierPill({ tier }: { tier: string }) {
  const t = normalizeTier(tier);
  return (
    <span className={`shrink-0 px-2.5 py-1 rounded-full text-[9px] font-label uppercase tracking-widest ${tierPillClass(t)}`}>
      {t}
    </span>
  );
}

export function BillingPendingNotice({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 text-left">
      <p className="flex-1 font-sans text-xs text-amber-200/90 leading-relaxed">
        <span className="font-semibold">Billing setup pending.</span> Payments aren't switched on for
        this platform yet — check back soon.
      </p>
      {onDismiss && (
        <button onClick={onDismiss} className="text-amber-200/60 hover:text-amber-200 transition-colors" aria-label="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function UpgradeModal({
  eventUuid,
  currentTier,
  onClose,
}: {
  eventUuid: string;
  currentTier: string;
  onClose: () => void;
}) {
  const [busyTier, setBusyTier] = useState<PaidTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = normalizeTier(currentTier);
  const currentIdx = TIER_ORDER.indexOf(current);

  const buy = async (tier: PaidTier) => {
    if (busyTier) return;
    setError(null);
    setBusyTier(tier);
    const { url, error: err } = await startCheckout({
      kind: 'event_package',
      tier,
      eventUuid,
      returnUrl: window.location.href,
    });
    if (url) {
      window.location.assign(url);
      return; // keep the busy state while the browser navigates away
    }
    setBusyTier(null);
    setError(err ?? 'internal');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="liquid-glass rounded-3xl p-6 md:p-8 w-full max-w-3xl animate-rise-in my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="font-serif text-2xl text-foil-static">Upgrade this event</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="font-sans text-xs text-brand-muted/60 mb-5">
          One-time purchase for this event only. Current plan: <TierPill tier={current} />
        </p>

        {error === 'billing_not_configured' && (
          <div className="mb-4"><BillingPendingNotice onDismiss={() => setError(null)} /></div>
        )}
        {error && error !== 'billing_not_configured' && (
          <p className="mb-4 font-sans text-xs text-red-400">Couldn't start checkout ({error}). Please try again.</p>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {PACKAGES.map((pkg) => {
            const owned = TIER_ORDER.indexOf(pkg.tier) <= currentIdx;
            const highlight = pkg.tier === 'premium';
            return (
              <div
                key={pkg.tier}
                className={`rounded-2xl p-5 flex flex-col gap-3 border ${
                  highlight ? 'border-accent/40 bg-accent/[0.06]' : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">{pkg.tier}</p>
                    {highlight && <Sparkles className="w-3.5 h-3.5 text-accent-2" />}
                  </div>
                  <p className="font-serif text-3xl text-brand-fg mt-1">{pkg.price}</p>
                  <p className="font-sans text-[10px] text-brand-muted/50">{pkg.tagline} · per event</p>
                </div>
                <ul className="flex-1 space-y-1.5">
                  {pkg.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-1.5 font-sans text-[11px] text-brand-muted/80 leading-snug">
                      <Check className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400/80" /> {b}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => buy(pkg.tier)}
                  disabled={owned || busyTier !== null}
                  className={`w-full rounded-full py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${
                    highlight ? 'bg-foil text-white glow-accent' : 'bg-white/[0.08] hover:bg-white/[0.14] text-brand-fg'
                  }`}
                >
                  {owned ? 'Current plan' : busyTier === pkg.tier ? 'Redirecting…' : `Get ${pkg.tier}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact banner for the event studio: tier pill + one-line pitch + Upgrade.
 * Hidden once the event is on deluxe (nothing left to sell).
 */
export default function UpgradeCard({ eventUuid, planTier }: { eventUuid: string; planTier: string }) {
  const [open, setOpen] = useState(false);
  const tier = normalizeTier(planTier);
  if (tier === 'deluxe') return null;

  const pitch =
    tier === 'free'
      ? '25 posts, photos only, watermark on — unlock the full booth for this event.'
      : tier === 'essentials'
        ? 'Unlock unlimited posts and photo cards with Premium.'
        : 'Add the rendered MP4 keepsake film with Deluxe.';

  return (
    <>
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-accent/10 bg-white/[0.02]">
        <TierPill tier={tier} />
        <p className="flex-1 font-sans text-[11px] text-brand-muted/60 truncate">{pitch}</p>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-foil px-4 py-1.5 font-label uppercase tracking-luxe text-[9px] font-bold text-white glow-accent transition active:scale-[0.98]"
        >
          Upgrade <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
      {open && <UpgradeModal eventUuid={eventUuid} currentTier={tier} onClose={() => setOpen(false)} />}
    </>
  );
}
