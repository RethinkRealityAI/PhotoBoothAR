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
import { useCallback, useState } from 'react';
import { Loader, Wand2 } from 'lucide-react';
import { generateImage, resolveEventUuid, aiErrorMessage } from '../../lib/ai';
import { fetchMyOrg, fetchCreditBalance } from '../../lib/host';
import { useEvent } from '../../events/EventContext';
import { processGeneratedFrame } from '../../lib/studio/frameProcessing';
import type { Experience } from '../../types';

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
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showBillingLink, setShowBillingLink] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  // Generation whose chroma-key processing failed — held for a FREE retry
  // (the raw green asset is saved server-side; reprocessing costs nothing).
  const [pendingRaw, setPendingRaw] = useState<Experience | null>(null);

  const refreshBalance = useCallback(async (): Promise<number | null> => {
    const org = await fetchMyOrg();
    if (!org) return null;
    const bal = await fetchCreditBalance(org.orgId);
    setBalance(bal);
    return bal;
  }, []);

  const generate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError('');
    setShowBillingLink(false);
    try {
      const uuid = await resolveEventUuid(eventId, eventUuid);
      if (!uuid) { setError(aiErrorMessage('event_not_found')); return; }
      const { data, error: err } = await generateImage(uuid, {
        prompt: prompt.trim(),
        kind,
        transparentBackground: kind === '2d_filter',
        greenScreen: true,
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
      <button
        onClick={generate}
        disabled={loading || !prompt.trim()}
        className="flex items-center justify-center gap-1.5 py-2 bg-foil text-white rounded-xl font-bold text-[10px] font-label uppercase tracking-widest disabled:opacity-40 glow-accent transition active:scale-[0.98]"
      >
        {loading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        {loading ? 'Generating…' : 'Generate · 1 credit'}
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
