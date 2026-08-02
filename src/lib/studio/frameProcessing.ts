/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser-side chroma-key glue for freshly-generated AI frames/stickers.
 * Extracted from components/studio/AiFramePanel.tsx so BOTH the studio panels
 * (AiFramePanel, DirectorPanel) AND the in-chat Event Concierge tools can reuse
 * the exact same pipeline: load the raw greenScreen PNG the edge function
 * returned, key the backdrop out to transparency, contain-fit it onto the
 * booth's 1080×1920 canvas, re-upload the transparent PNG, and repoint the
 * experience row at it — so a placed overlay references the PROCESSED asset,
 * never the raw green output.
 *
 * Uses the DOM (Image / canvas) → browser-only, not node-testable. The pure
 * pixel maths live in ./chromaKey.ts (processFrameImage, node-tested).
 */
import { uploadAsset, updateExperience } from '../db';
import {
  FRAME_H,
  FRAME_W,
  fitOnCanvas,
  hasGenuineAlpha,
  needsChromaKey,
  processFrameImage,
  type RgbaImage,
} from './chromaKey';
import type { Experience } from '../../types';

/**
 * Read a boolean flag out of an experience's jsonb config. `transparent` is
 * written by this very module (and by ai-generate-image) but is not on
 * ExperienceConfig, so the read goes through a widened cast rather than a
 * schema change. Only exactly `true` counts — the house rule for opt-in flags.
 */
function configFlag(config: Experience['config'], key: string): boolean {
  return (config as Record<string, unknown> | null | undefined)?.[key] === true;
}

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
 * into config and persisted even when processing fails, so callers can
 * piggy-back metadata (e.g. the Scene Director's scene tag).
 *
 * Returns { experience, keyed }: `keyed` is true when the transparent PNG was
 * produced AND uploaded — or when the asset ALREADY had genuine alpha (see the
 * short-circuit below), which needs no keying to be placeable. When false,
 * `experience` still references the
 * RAW GREEN output — callers must NOT place it in a scene (a solid green box
 * over the guest is worse than an error); offer a retry instead. Reprocessing
 * a saved raw experience costs no credits.
 */
export async function processGeneratedFrame(
  exp: Experience,
  eventId: string,
  extraConfig: Record<string, unknown> = {},
): Promise<{ experience: Experience; keyed: boolean }> {
  // GENUINE ALPHA SHORT-CIRCUIT. A Higgsfield marketplace-app import or a
  // remove_background output arrives as a real transparent PNG. There is no
  // green backdrop to find, so the honesty gate below would have measured a
  // keyedFraction of ~0 and REJECTED exactly the best inputs the pipeline can
  // get. Skip detection and keying entirely; only the contain-fit onto the
  // booth's 1080×1920 canvas remains (fitOnCanvas already resamples
  // premultiplied, so soft edges survive).
  //
  // The decision takes THREE facts, not one (audit F2): `config.transparent` is
  // only an IHDR colour-TYPE probe, so an opaque-RGBA green-screen sticker used
  // to skip keying and place raw green. `config.greenScreen` (stamped by
  // ai-generate-image) vetoes the skip, and the decoded pixels outrank both
  // flags — see chromaKey.hasGenuineAlpha.
  const claimsTransparent = configFlag(exp.config, 'transparent');
  const fromGreenScreen = configFlag(exp.config, 'greenScreen');

  let processedUrl: string | null = null;
  // Seeded from the flags and REPLACED by the pixel truth the moment the image
  // decodes. It therefore keeps the flag answer on the two paths that never see
  // pixels — no asset_url, and a decode that threw (CORS taint) — where
  // reporting keyed:false would make the caller refuse a good transparent PNG.
  let alreadyTransparent = claimsTransparent && !fromGreenScreen;
  if (exp.asset_url) {
    try {
      const src = await loadImageData(exp.asset_url);
      alreadyTransparent = hasGenuineAlpha(claimsTransparent, fromGreenScreen, src);
      if (alreadyTransparent) {
        const blob = await toPngBlob(fitOnCanvas(src, FRAME_W, FRAME_H));
        processedUrl = await uploadAsset(eventId, blob, `frame-${exp.id}`);
        if (!processedUrl) console.warn('[studio] transparent frame upload failed');
      } else {
        // Detect the real backdrop hue, key it out, contain-fit to 1080×1920.
        const { image, keyedFraction, keyColor } = processFrameImage(src);
        // A key that removed almost nothing never matched the backdrop — the
        // asset is still effectively the raw GREEN image. Leave processedUrl null
        // (→ keyed:false) so the free-retry UI and DirectorPanel's failed-card
        // path fire, exactly like the CORS/decode catch below. Do NOT upload it.
        // `alreadyTransparent` is false on this branch by construction; passing
        // it anyway keeps the skip and the gate reading off ONE helper (and one
        // threshold), so the two decisions cannot drift apart.
        if (!needsChromaKey(alreadyTransparent, keyedFraction)) {
          console.warn('[studio] chroma-key removed too little — treating as unkeyed', {
            keyColor,
            keyedFraction,
          });
        } else {
          const blob = await toPngBlob(image);
          processedUrl = await uploadAsset(eventId, blob, `frame-${exp.id}`);
          if (!processedUrl) console.warn('[studio] processed frame upload failed');
        }
      }
    } catch (e) {
      console.warn('[studio] chroma-key processing failed', e);
    }
  }

  // An already-transparent asset is PLACEABLE whatever happened above: a failed
  // re-fit (or a CORS-tainted canvas, which is a browser-side read problem, not
  // an asset problem) leaves a PNG the booth renders correctly as-is. Reporting
  // keyed:false there would make the caller refuse a perfectly good frame.
  const keyed = alreadyTransparent || !!processedUrl;

  const config = {
    ...(exp.config ?? {}),
    ...extraConfig,
    ...(keyed ? { transparent: true } : {}),
  };
  const patch: Parameters<typeof updateExperience>[2] = { config };
  if (processedUrl) {
    patch.asset_url = processedUrl;
    patch.thumbnail_url = processedUrl;
  }

  // Persist when there's anything to persist (a processed URL and/or metadata).
  if (processedUrl || Object.keys(extraConfig).length > 0) {
    const saved = await updateExperience(eventId, exp.id, patch);
    if (saved) return { experience: saved, keyed };
  }
  return {
    experience: {
      ...exp,
      ...(processedUrl ? { asset_url: processedUrl, thumbnail_url: processedUrl } : {}),
      config: config as Experience['config'],
    },
    keyed,
  };
}
