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
import { uploadAsset, updateExperience } from '../../lib/db';
import { processFrameImage, type RgbaImage } from '../../lib/studio/chromaKey';
import { useEvent } from '../../events/EventContext';
import type { Experience } from '../../types';

/* ── Browser-side chroma-key glue (co-located; SceneDirectorPanel reuses it) ──
 * The edge function returns a frame/sticker whose backdrop is a solid green
 * (#00FF00) chroma-key fill (greenScreen prompt). We load that PNG, key the
 * green out to transparency, contain-fit it onto the booth's 1080×1920 canvas,
 * re-upload the transparent PNG, and repoint the experience at it — so the
 * placed overlay references the PROCESSED asset, never the raw green output.
 * Any failure (CORS taint, decode/encode error) logs a warning and falls back
 * to the raw image so a host is never blocked. */

/** Decode a public image URL into an ImageData-shaped RGBA buffer. */
async function loadImageData(url: string): Promise<RgbaImage> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image_decode_failed'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_2d_context');
  ctx.drawImage(img, 0, 0);
  // getImageData throws (SecurityError) if the source tainted the canvas.
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Encode an RGBA buffer back to a PNG blob via an offscreen canvas. */
function toPngBlob(rgba: RgbaImage): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = rgba.width;
  canvas.height = rgba.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_2d_context');
  ctx.putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png_encode_failed'))), 'image/png');
  });
}

/**
 * Chroma-key a freshly-generated frame/sticker experience and repoint it (and
 * its persisted row) at the processed transparent PNG. `extraConfig` is merged
 * into config and persisted even when processing is skipped, so callers can
 * piggy-back metadata (e.g. the Scene Director's scene tag). Returns the
 * experience the caller should hand to the studio — processed on success, the
 * original (raw) experience on any failure.
 */
export async function processGeneratedFrame(
  exp: Experience,
  eventId: string,
  extraConfig: Record<string, unknown> = {},
): Promise<Experience> {
  let processedUrl: string | null = null;
  if (exp.asset_url) {
    try {
      const src = await loadImageData(exp.asset_url);
      const out = processFrameImage(src); // keys green → transparent 1080×1920
      const blob = await toPngBlob(out);
      processedUrl = await uploadAsset(blob, `frame-${exp.id}`);
      if (!processedUrl) console.warn('[studio] processed frame upload failed; using raw image');
    } catch (e) {
      console.warn('[studio] chroma-key processing failed; using raw image', e);
    }
  }

  const config = {
    ...(exp.config ?? {}),
    ...extraConfig,
    ...(processedUrl ? { transparent: true } : {}),
  };
  const patch: Parameters<typeof updateExperience>[2] = { config };
  if (processedUrl) {
    patch.asset_url = processedUrl;
    patch.thumbnail_url = processedUrl;
  }

  // Persist when there's anything to persist (a processed URL and/or metadata).
  if (processedUrl || Object.keys(extraConfig).length > 0) {
    const saved = await updateExperience(eventId, exp.id, patch);
    if (saved) return saved;
  }
  return {
    ...exp,
    ...(processedUrl ? { asset_url: processedUrl, thumbnail_url: processedUrl } : {}),
    config: config as Experience['config'],
  };
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
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showBillingLink, setShowBillingLink] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

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
      // studio — falls back to the raw image on any processing failure.
      const processed = await processGeneratedFrame(data.experience, eventId);
      onGenerated(processed);
      refreshBalance();
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
    </div>
  );
}
