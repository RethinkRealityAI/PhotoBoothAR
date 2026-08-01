/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AiFramePanel — server-side AI frame/sticker generation (ai-generate-image).
 * Ported from Creator2D's MagicGenerate onto platform tokens. Credits,
 * entitlements and the Gemini key are enforced server-side; the first 3
 * generations per event are free. On success the server has already saved an
 * unpublished experience — we load its asset into the current draft for
 * placement + publish.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader, Wand2 } from 'lucide-react';
import { generateImage, resolveEventUuid, aiErrorMessage, fetchEventCreditBalance } from '../../lib/ai';
import { fetchProviderKeyStatus, type ProviderKeyStatus } from '../../lib/providerKeys';
import {
  PROVIDER_LABELS, effectiveProvider, higgsfieldReady as isHiggsfieldReady,
  providerBody, providerCostLabel, providerHint, type ImageProvider,
} from '../../lib/providerPricing';
import { useEvent } from '../../events/EventContext';
import {
  inferFrameLayout, normalizeLettering, LETTERING_MAX,
  type FrameLayout, type LetteringPlacement, type LetteringStyle,
} from '../../lib/assetPrompt';
import { processGeneratedFrame } from '../../lib/studio/frameProcessing';
import type { Experience } from '../../types';

/** The five frame archetypes, in the order they escalate: an edge border, a
 *  whole illustrated scene, the two-head version of it, corner clusters, a
 *  lower-third band. Labels are what a host would call them, not the ids. */
const LAYOUT_CHIPS: { id: FrameLayout; label: string }[] = [
  { id: 'classic-border', label: 'Border' },
  { id: 'full-scene', label: 'Full scene' },
  { id: 'duo-scene', label: 'Two faces' },
  { id: 'corner-overlay', label: 'Corners' },
  { id: 'bottom-third', label: 'Banner' },
];

/** Lettering styles, each with the sample frame that shows the look. The
 *  thumbnails are vendored at build time (scripts/remote-assets.json) and hide
 *  themselves if missing, so the row degrades to plain pills. */
// `pos` = object-position: the samples are full 9:16 frames whose centre is the
// deliberately-empty face region, so a centre crop shows a dark blob — aim the
// 44px circle at the band where that sample's lettering actually sits.
const LETTERING_STYLE_PILLS: { id: LetteringStyle; label: string; sample: string; pos: string }[] = [
  { id: 'cursive-monogram', label: 'Monogram', sample: 'cursive-monogram-bottom', pos: 'center 85%' },
  { id: 'serif-initials', label: 'Initials', sample: 'serif-initials-top', pos: 'center 12%' },
  { id: 'script-name', label: 'Script', sample: 'script-name-extending', pos: '80% center' },
  { id: 'modern-block', label: 'Block', sample: 'block-name-integrated', pos: 'center 88%' },
];

const LETTERING_PLACEMENT_PILLS: { id: LetteringPlacement; label: string }[] = [
  { id: 'bottom', label: 'Bottom' },
  { id: 'top', label: 'Top' },
  { id: 'integrated', label: 'Woven in' },
  { id: 'beyond-edge', label: 'Past the edge' },
  { id: 'standalone', label: 'Name art only' },
];

/* ── Provider choice (shared with DirectorPanel) ──────────────────────────
 * WHICH MODEL PAINTS THE FRAME, and what that costs the host. The rules — the
 * labels, the prices, the effective-provider fallback and the hint copy — are
 * PURE and live in src/lib/providerPricing.ts, so they are unit-tested against
 * the server's own cost line instead of being asserted by eye in a component
 * (audit F10). This file owns only the React around them.
 *
 * Re-exported here because DirectorPanel imports the picker from this module;
 * the two studio surfaces must not drift into two pickers with two prices.
 */
export {
  providerBody,
  providerCostLabel,
  type ImageProvider,
} from '../../lib/providerPricing';

/** Remembered across sessions — a host who brought their own key should not
 *  have to re-pick it on every generation. */
const PROVIDER_STORE_KEY = 'bw.aiProvider';

function readStoredProvider(): ImageProvider {
  if (typeof window === 'undefined') return 'gemini';
  try {
    return localStorage.getItem(PROVIDER_STORE_KEY) === 'higgsfield' ? 'higgsfield' : 'gemini';
  } catch {
    return 'gemini'; // private mode / storage denied — the default still works
  }
}

function storeProvider(p: ImageProvider): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(PROVIDER_STORE_KEY, p); } catch { /* non-fatal */ }
}

/**
 * The org whose Higgsfield key ai-generate-image will actually read —
 * `events.org_id`, NOT the caller's first membership (the two differ for
 * multi-org members, which is the same trap fetchEventCreditBalance documents).
 * Undefined on any failure: the `provider-keys` function then resolves the
 * caller's own org, which is the right fallback and never a wrong answer for a
 * single-org host.
 */
async function eventOrgId(eventUuid: string | null): Promise<string | undefined> {
  if (!eventUuid) return undefined;
  try {
    const { supabase } = await import('../../lib/supabase');
    const { data, error } = await supabase
      .from('events')
      .select('org_id')
      .eq('id', eventUuid)
      .maybeSingle();
    if (error) { console.error('[aiFrame] eventOrgId', error); return undefined; }
    return typeof data?.org_id === 'string' ? data.org_id : undefined;
  } catch (e) {
    console.error('[aiFrame] eventOrgId', e);
    return undefined;
  }
}

export interface ProviderChoice {
  /** What the host picked (remembered even when this org can't use it). */
  provider: ImageProvider;
  /** What we will actually SEND — falls back to gemini when Higgsfield is
   *  unusable for this org, so a stale stored pick can never fail a generation. */
  effective: ImageProvider;
  setProvider: (p: ImageProvider) => void;
  /** null = not known yet (loading) or the read failed — see statusFailed. */
  status: ProviderKeyStatus | null;
  statusFailed: boolean;
  higgsfieldReady: boolean;
}

/** Resolve the org's Higgsfield connection once per event and hold the pick. */
export function useImageProvider(eventId: string, eventUuid: string | null): ProviderChoice {
  const [provider, setProviderState] = useState<ImageProvider>(readStoredProvider);
  const [status, setStatus] = useState<ProviderKeyStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const uuid = await resolveEventUuid(eventId, eventUuid);
      const orgId = await eventOrgId(uuid);
      const { data, error } = await fetchProviderKeyStatus('higgsfield', orgId);
      if (!alive) return;
      // A FAILED read is not "no key" — it must not paint a connection the org
      // may well have, nor promise a price we can't stand behind.
      if (error !== null || data === null) { setStatus(null); setStatusFailed(true); return; }
      setStatus(data);
      setStatusFailed(false);
    })();
    return () => { alive = false; };
  }, [eventId, eventUuid]);

  const setProvider = useCallback((p: ImageProvider) => {
    setProviderState(p);
    storeProvider(p);
  }, []);

  const higgsfieldReady = isHiggsfieldReady(status);
  const effective = effectiveProvider(provider, status);
  return { provider, effective, setProvider, status, statusFailed, higgsfieldReady };
}

/**
 * Two pills + one honest line about what Higgsfield costs (copy from
 * providerPricing.providerHint).
 */
export function ProviderSegment({ choice, freeTrial }: { choice: ProviderChoice; freeTrial: boolean }) {
  const { provider, setProvider, status, statusFailed, higgsfieldReady } = choice;
  const notConnected = status !== null && !higgsfieldReady;
  const hint = providerHint(status, statusFailed, freeTrial);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Image provider">
        {PROVIDER_LABELS.map(({ id, label }) => {
          const active = id === provider;
          // Disabled for the WHOLE time Higgsfield is unusable — including
          // while `status` is null (still checking, or the check failed).
          // Leaving it live there let a host pick a provider that
          // effectiveProvider silently swapped for gemini, so the button read
          // "2 credits" for a 1-credit gemini generation (audit F9). The hint
          // line below already explains which of the two states we are in.
          const disabled = id === 'higgsfield' && !higgsfieldReady;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setProvider(id)}
              disabled={disabled}
              aria-pressed={active}
              title={
                !disabled
                  ? undefined
                  : notConnected
                    ? 'Connect a Higgsfield account in Billing to use this'
                    : statusFailed
                      ? 'Couldn’t check your Higgsfield connection — Beamwall AI is being used'
                      : 'Checking your Higgsfield connection…'
              }
              className={`pressable liquid-glass rounded-full px-2.5 py-1 font-label uppercase tracking-widest text-[9px] transition-colors disabled:opacity-40 ${
                active
                  ? 'bg-accent/20 ring-1 ring-accent/40 text-brand-fg'
                  : 'text-brand-muted/60 hover:text-brand-fg'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-[9px] text-brand-muted/50 font-sans leading-relaxed">
        Higgsfield: {hint}
        {notConnected && (
          <>
            {' '}
            {/* New tab on purpose: navigating away in place would unmount the
                studio and lose the host's unsaved scene work. */}
            <a href="/host/billing" target="_blank" rel="noopener" className="underline text-accent-2 hover:text-accent">
              Connect in Billing
            </a>
          </>
        )}
      </p>
    </div>
  );
}

export default function AiFramePanel({
  kind,
  freeTrial,
  onGenerated,
}: {
  kind: 'border' | '2d_filter';
  freeTrial: boolean;
  onGenerated: (exp: Experience) => void;
}) {
  const { eventId, eventUuid, source } = useEvent();
  const providerChoice = useImageProvider(eventId, eventUuid);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showBillingLink, setShowBillingLink] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  // Generation whose chroma-key processing failed — held for a FREE retry
  // (the raw green asset is saved server-side; reprocessing costs nothing).
  const [pendingRaw, setPendingRaw] = useState<Experience | null>(null);
  // The archetype tracks what the host is TYPING until they touch a chip;
  // after that their choice wins (null = still following the brief).
  const [layoutPick, setLayoutPick] = useState<FrameLayout | null>(null);
  const layout = layoutPick ?? inferFrameLayout(prompt);
  // Lettering ON the frame — opt-in, and only sent when the host actually typed
  // something. Empty text (or the pill closed) leaves the request body exactly
  // as it was before lettering existed.
  const [letteringOpen, setLetteringOpen] = useState(false);
  const [letteringText, setLetteringText] = useState('');
  const [letteringStyle, setLetteringStyle] = useState<LetteringStyle>('script-name');
  const [letteringPlacement, setLetteringPlacement] = useState<LetteringPlacement>('bottom');
  const lettering = letteringOpen
    ? normalizeLettering({ text: letteringText, style: letteringStyle, placement: letteringPlacement })
    : null;

  // Balance of the EVENT's org — the org ai-generate-image actually charges
  // (event.org_id), not the caller's first org membership (they can differ
  // for multi-org members; the old fetchMyOrg() showed the wrong wallet).
  const refreshBalance = useCallback(async (): Promise<number | null> => {
    const uuid = await resolveEventUuid(eventId, eventUuid);
    if (!uuid) return null;
    const bal = await fetchEventCreditBalance(uuid);
    setBalance(bal);
    return bal;
  }, [eventId, eventUuid]);

  // Show the live balance where generation is offered — not only after a spend.
  useEffect(() => { void refreshBalance(); }, [refreshBalance]);

  const generate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError('');
    setShowBillingLink(false);
    try {
      const uuid = await resolveEventUuid(eventId, eventUuid);
      if (!uuid) { setError(aiErrorMessage('event_not_found')); return; }
      // "Name art only" is words with NO frame around them — a single centred
      // subject, which is the sticker path, whatever panel the host is in.
      const genKind = lettering?.placement === 'standalone' ? '2d_filter' : kind;
      const { data, error: err } = await generateImage(uuid, {
        prompt: prompt.trim(),
        kind: genKind,
        transparentBackground: genKind === '2d_filter',
        greenScreen: true,
        // Absent for gemini — the default path's body is unchanged.
        ...providerBody(providerChoice.effective),
        // A sticker has one subject, not a canvas layout — only a frame carries
        // an archetype (the edge function ignores it for other kinds anyway).
        ...(genKind === 'border' ? { layout } : {}),
        // Only ever present when the host typed real text — absent keeps the
        // server prompt byte-identical to before this control existed.
        ...(lettering ? { lettering } : {}),
      });
      if (err || !data?.experience) {
        if (err === 'insufficient_credits') {
          const bal = await refreshBalance();
          setError(`Not enough credits${bal !== null ? ` — balance: ${bal}` : ''}.`);
          setShowBillingLink(source === 'db');
        } else if (err === 'upgrade_required') {
          setError(aiErrorMessage('upgrade_required'));
          setShowBillingLink(source === 'db');
        } else {
          setError(aiErrorMessage(err ?? 'internal'));
        }
        return;
      }
      // Chroma-key the green backdrop out before handing the asset to the
      // studio. A failed key means the asset is still the raw GREEN image —
      // never place that in the scene; hold it for a free retry instead.
      const { experience: processed, keyed } = await processGeneratedFrame(data.experience, eventId);
      if (!keyed) {
        setPendingRaw(data.experience);
        setError('Generated, but transparency processing failed — retry below (no extra credits).');
        return;
      }
      setPendingRaw(null);
      onGenerated(processed);
      refreshBalance();
    } finally {
      setLoading(false);
    }
  };

  // Free retry: re-run chroma-key on the already-saved raw generation.
  const retryProcessing = async () => {
    if (!pendingRaw || loading) return;
    setLoading(true);
    setError('');
    try {
      const { experience: processed, keyed } = await processGeneratedFrame(pendingRaw, eventId);
      if (!keyed) {
        setError('Transparency processing failed again — the raw image is in your Library.');
        return;
      }
      setPendingRaw(null);
      onGenerated(processed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-accent/20 bg-accent/[0.05] p-3.5 flex flex-col gap-2.5">
      <p className="font-label uppercase tracking-widest text-[9px] text-accent-2 flex items-center gap-1.5">
        <Wand2 className="w-3 h-3" /> {kind === 'border' ? 'AI generate frame' : 'AI generate sticker'}
      </p>
      {freeTrial && (
        <p className="text-[9px] text-accent-2/80 leading-relaxed">Your first 3 AI generations are on us — upgrade for unlimited AI Studio.</p>
      )}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe an overlay — e.g. 'art-deco gold border with confetti'…"
        rows={2}
        className="w-full rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-brand-fg text-xs placeholder:text-brand-muted/40 outline-none focus:border-accent/50 resize-none"
      />
      {kind === 'border' && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Frame style">
          {LAYOUT_CHIPS.map(({ id, label }) => {
            const active = id === layout;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setLayoutPick(id)}
                aria-pressed={active}
                className={`pressable liquid-glass rounded-full px-2.5 py-1 font-label uppercase tracking-widest text-[9px] transition-colors ${
                  active
                    ? 'bg-accent/20 ring-1 ring-accent/40 text-brand-fg'
                    : 'text-brand-muted/60 hover:text-brand-fg'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {kind === 'border' && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setLetteringOpen((o) => !o)}
            aria-pressed={letteringOpen}
            className={`pressable liquid-glass self-start rounded-full px-2.5 py-1 font-label uppercase tracking-widest text-[9px] transition-colors ${
              letteringOpen
                ? 'bg-accent/20 ring-1 ring-accent/40 text-brand-fg'
                : 'text-brand-muted/60 hover:text-brand-fg'
            }`}
          >
            Lettering
          </button>
          {letteringOpen && (
            <div className="flex flex-col gap-1.5">
              <input
                type="text"
                value={letteringText}
                onChange={(e) => setLetteringText(e.target.value.slice(0, LETTERING_MAX))}
                placeholder="Names or initials — e.g. 'Maya & Sam'"
                className="w-full rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-brand-fg text-xs placeholder:text-brand-muted/40 outline-none focus:border-accent/50"
              />
              <div className="flex flex-wrap gap-1" role="group" aria-label="Lettering style">
                {LETTERING_STYLE_PILLS.map(({ id, label, sample, pos }) => {
                  const active = id === letteringStyle;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setLetteringStyle(id)}
                      aria-pressed={active}
                      className={`pressable liquid-glass flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 font-label uppercase tracking-widest text-[9px] transition-colors ${
                        active
                          ? 'bg-accent/20 ring-1 ring-accent/40 text-brand-fg'
                          : 'text-brand-muted/60 hover:text-brand-fg'
                      }`}
                    >
                      {/* Vendored at build time — hidden if it isn't there. */}
                      <img
                        src={`/samples/lettering/${sample}.png`}
                        alt=""
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        className="w-[44px] h-[44px] rounded-full object-cover"
                        style={{ objectPosition: pos }}
                      />
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Lettering placement">
                {LETTERING_PLACEMENT_PILLS.map(({ id, label }) => {
                  const active = id === letteringPlacement;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setLetteringPlacement(id)}
                      aria-pressed={active}
                      className={`pressable liquid-glass rounded-full px-2.5 py-1 font-label uppercase tracking-widest text-[9px] transition-colors ${
                        active
                          ? 'bg-accent/20 ring-1 ring-accent/40 text-brand-fg'
                          : 'text-brand-muted/60 hover:text-brand-fg'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] text-brand-muted/40 font-sans leading-relaxed">
                Up to {LETTERING_MAX} characters spells reliably. “Name art only” drops the frame and generates the words alone.
              </p>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="text-rose-400 text-[10px]">
          {error}
          {showBillingLink && (
            <> <a href="/host/billing" className="underline text-accent-2 hover:text-accent">Open billing</a></>
          )}
          {pendingRaw && (
            <>
              {' '}
              <button onClick={retryProcessing} disabled={loading} className="underline text-accent-2 hover:text-accent disabled:opacity-50">
                Retry processing
              </button>
            </>
          )}
        </p>
      )}
      <ProviderSegment choice={providerChoice} freeTrial={freeTrial} />
      <button
        onClick={generate}
        disabled={loading || !prompt.trim()}
        className="flex items-center justify-center gap-1.5 py-2 bg-foil text-white rounded-xl font-bold text-[10px] font-label uppercase tracking-widest disabled:opacity-40 glow-accent transition active:scale-[0.98]"
      >
        {loading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        {loading ? 'Generating…' : `Generate · ${providerCostLabel(providerChoice.effective, providerChoice.status)}`}
      </button>
      {balance !== null && (
        <p className="text-[9px] text-brand-muted/50 font-sans">{balance} credit{balance === 1 ? '' : 's'} left · saved to your Library as a draft</p>
      )}
      <p className="text-[9px] text-brand-muted/40 font-sans leading-relaxed">
        Tip: avoid pure-green art — a green screen is keyed out for transparency, so near-#00FF00 elements disappear.
      </p>
    </div>
  );
}
