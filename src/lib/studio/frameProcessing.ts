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
 * pixel maths live in ./chromaKey.ts and ./frameQuality.ts (prepareFrame:
 * key → fit → gate → repair, node-tested). The heavy part runs on a Web Worker
 * (./frameKey.worker.ts) when the browser has OffscreenCanvas, and falls back
 * to the main thread — the same pure function either way.
 */
import { uploadAsset, updateExperience } from '../db';
import { type KeyOutOptions, type RgbaImage } from './chromaKey';
import {
  FRAME_STAGE_COPY,
  autoRetryCode,
  paintingCopy,
  prepareFrame,
  rankTakes,
  takeUsable,
  type FrameStage,
  type PrepareFlags,
  type PrepareOptions,
  type PreparedFrame,
  type QualityCode,
  type QualityResult,
} from './frameQuality';
import type { FrameKeyRequest, FrameKeyResponse } from './frameKey.worker';
import {
  ctxMeasure,
  drawFrameText,
  fontString,
  layoutFrameText,
  pickTextColours,
  plaqueBox,
  sampleBackdrop,
  type FrameTextSpec,
} from './frameText';
import type { FrameLayout } from '../assetPrompt';
import {
  findFrameJobSince,
  fetchExperienceForJob,
  generateImage,
  resultTakes,
  serverHasFreeRetry,
  type AiErrorCode,
  type AiJob,
  type AiResult,
  type GenerateImageOpts,
} from '../ai';
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

/** Name/date drawn onto the frame in the browser (never by the model). */
export interface FrameTextOverlay {
  spec: FrameTextSpec;
  layout: FrameLayout;
  accentHexes?: string[];
}

/** Encode an RGBA buffer back to a PNG blob, drawing the text overlay (if
 *  any) on top. Fonts come from the page's self-hosted fonts.css. */
async function toPngBlob(rgba: RgbaImage, text?: FrameTextOverlay | null): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = rgba.width;
  canvas.height = rgba.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_2d_context');
  ctx.putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0);
  if (text && text.spec.enabled) {
    const font = text.spec.font ?? 'classic';
    try {
      await document.fonts.load(fontString(font, 64));
    } catch {
      /* the fallback face still draws readable text */
    }
    const box = plaqueBox(text.layout, rgba.width, rgba.height);
    const colours = pickTextColours(sampleBackdrop(rgba, box), text.accentHexes ?? []);
    drawFrameText(ctx, layoutFrameText(text.spec, box, ctxMeasure(ctx, font)), font, colours);
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png_encode_failed'))), 'image/png');
  });
}

/* ── Worker client (with a main-thread fallback) ─────────────────────────── */

/** undefined = not tried yet; null = unavailable (main thread from now on). */
let keyWorker: Worker | null | undefined;
let keySeq = 0;
const keyPending = new Map<number, (r: FrameKeyResponse) => void>();
/** A worker that has not answered by now is treated as unavailable. */
const WORKER_TIMEOUT_MS = 30_000;

function getKeyWorker(): Worker | null {
  if (keyWorker !== undefined) return keyWorker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    keyWorker = null;
    return null;
  }
  try {
    const w = new Worker(new URL('./frameKey.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FrameKeyResponse>) => {
      const done = keyPending.get(e.data.id);
      if (done) {
        keyPending.delete(e.data.id);
        done(e.data);
      }
    };
    w.onerror = (ev) => {
      console.warn('[studio] frame worker failed — keying on the main thread', ev.message);
      keyWorker = null;
      for (const [id, done] of keyPending) done({ id, ok: false, error: 'worker_error' });
      keyPending.clear();
      w.terminate();
    };
    keyWorker = w;
  } catch (e) {
    console.warn('[studio] frame worker unavailable', e);
    keyWorker = null;
  }
  return keyWorker;
}

function prepareOnWorker(url: string, flags: PrepareFlags, opts: PrepareOptions): Promise<PreparedFrame | null> {
  const w = getKeyWorker();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = ++keySeq;
    const timer = setTimeout(() => {
      keyPending.delete(id);
      resolve(null);
    }, WORKER_TIMEOUT_MS);
    keyPending.set(id, (r) => {
      clearTimeout(timer);
      if ('error' in r) {
        console.warn('[studio] worker keying failed — retrying on the main thread', r.error);
        resolve(null);
      } else {
        resolve(r.result);
      }
    });
    const msg: FrameKeyRequest = { id, url, flags, opts };
    w.postMessage(msg);
  });
}

/** Key → fit → gate → repair, on the worker when possible. Throws when the
 *  image cannot be read at all (CORS taint / decode). */
async function prepare(url: string, flags: PrepareFlags, opts: PrepareOptions): Promise<PreparedFrame> {
  const viaWorker = await prepareOnWorker(url, flags, opts);
  if (viaWorker) return viaWorker;
  return prepareFrame(await loadImageData(url), flags, opts);
}

/** Small, durable summary of the gate, stored on the experience config. */
function qualitySummary(q: QualityResult): { ok: boolean; score: number; codes: QualityCode[] } {
  return { ok: q.ok, score: Math.round(q.score * 100) / 100, codes: q.reasons.map((r) => r.code) };
}

export interface ProcessFrameOptions {
  /** The frame's archetype — turns the quality gate on. Border frames only. */
  layout?: FrameLayout | null;
  /** A one-off looser key for the free re-key (frameQuality.rekeyOptions). */
  keyOpts?: KeyOutOptions;
  /** Name/date to draw on (kept editable: the un-texted art is saved too). */
  text?: FrameTextOverlay | null;
}

export interface ProcessedFrameResult {
  experience: Experience;
  keyed: boolean;
  /** The gate's verdict; null when no layout was given or the image never decoded. */
  quality: QualityResult | null;
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
  options: ProcessFrameOptions = {},
): Promise<ProcessedFrameResult> {
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
  let baseUrl: string | null = null;
  let quality: QualityResult | null = null;
  // Seeded from the flags and REPLACED by the pixel truth the moment the image
  // decodes. It therefore keeps the flag answer on the two paths that never see
  // pixels — no asset_url, and a decode that threw (CORS taint) — where
  // reporting keyed:false would make the caller refuse a good transparent PNG.
  let alreadyTransparent = claimsTransparent && !fromGreenScreen;
  const text = options.text && options.text.spec.enabled ? options.text : null;
  if (exp.asset_url) {
    try {
      // Detect the real backdrop hue, key it out, contain-fit to 1080×1920,
      // gate it and repair stray holes (frameQuality.prepareFrame). A genuinely
      // transparent source (frameQuality → chromaKey.hasGenuineAlpha) is only
      // fitted. On a worker when the browser allows.
      const prepared = await prepare(
        exp.asset_url,
        { claimsTransparent, fromGreenScreen },
        { layout: options.layout ?? null, keyOpts: options.keyOpts },
      );
      alreadyTransparent = prepared.alreadyTransparent;
      quality = prepared.quality;
      // A key that removed almost nothing never matched the backdrop — the
      // asset is still effectively the raw GREEN image. Leave processedUrl null
      // (→ keyed:false) so the free-retry UI and DirectorPanel's failed-card
      // path fire, exactly like the CORS/decode catch below. Do NOT upload it.
      if (!prepared.keyed) {
        console.warn('[studio] chroma-key removed too little — treating as unkeyed', {
          keyColor: prepared.keyColor,
          keyedFraction: prepared.keyedFraction,
        });
      } else {
        // With text: the UN-texted art is kept as the base so the words stay
        // editable later (restyleFrameText) without re-keying or re-paying.
        if (text) {
          baseUrl = await uploadAsset(eventId, await toPngBlob(prepared.image), `frame-${exp.id}-base`);
          if (!baseUrl) console.warn('[studio] frame base upload failed');
        }
        processedUrl = await uploadAsset(eventId, await toPngBlob(prepared.image, text), `frame-${exp.id}`);
        if (!processedUrl) console.warn('[studio] processed frame upload failed');
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
    ...(quality ? { quality: qualitySummary(quality) } : {}),
    ...(text && processedUrl ? { frameText: text.spec, ...(baseUrl ? { baseAssetUrl: baseUrl } : {}) } : {}),
  };
  const patch: Parameters<typeof updateExperience>[2] = { config };
  if (processedUrl) {
    patch.asset_url = processedUrl;
    patch.thumbnail_url = processedUrl;
  }

  // Persist when there's anything to persist (a processed URL and/or metadata).
  if (processedUrl || Object.keys(extraConfig).length > 0) {
    const saved = await updateExperience(eventId, exp.id, patch);
    if (saved) return { experience: saved, keyed, quality };
  }
  return {
    experience: {
      ...exp,
      ...(processedUrl ? { asset_url: processedUrl, thumbnail_url: processedUrl } : {}),
      config: config as Experience['config'],
    },
    keyed,
    quality,
  };
}

/**
 * Re-draw (or remove) the name/date on an already-processed frame. Reads the
 * saved un-texted base (config.baseAssetUrl), so it never re-keys and never
 * calls the AI — free, and instant enough to edit live. Null on failure.
 */
export async function restyleFrameText(
  exp: Experience,
  eventId: string,
  overlay: FrameTextOverlay,
): Promise<Experience | null> {
  const cfg = (exp.config ?? {}) as Record<string, unknown>;
  // A frame made WITHOUT text is its own base (it is already keyed); once text
  // has been drawn, only the saved base is clean — never draw on drawn text.
  const base = typeof cfg.baseAssetUrl === 'string'
    ? cfg.baseAssetUrl
    : cfg.frameText === undefined && cfg.transparent === true ? exp.asset_url : null;
  if (!base) return null;
  try {
    const img = await loadImageData(base);
    const url = await uploadAsset(eventId, await toPngBlob(img, overlay), `frame-${exp.id}`);
    if (!url) return null;
    return await updateExperience(eventId, exp.id, {
      asset_url: url,
      thumbnail_url: url,
      config: { ...cfg, frameText: overlay.spec, baseAssetUrl: base } as Experience['config'],
    });
  } catch (e) {
    console.warn('[studio] restyleFrameText failed', e);
    return null;
  }
}

/* ── One generation run, shared by every frame surface ──────────────────── */

export { FRAME_STAGE_COPY, paintingCopy, takeUsable, rankTakes, autoRetryCode, type FrameStage };

/** The client stops waiting here. The server's own provider budget is 115s
 *  (jobPolicy.GEMINI_BUDGET_MS) plus upload time. */
export const FRAME_CLIENT_TIMEOUT_MS = 150_000;

export interface FrameTake {
  experience: Experience;
  keyed: boolean;
  quality: QualityResult | null;
}

export interface FrameRunRequest {
  eventUuid: string;
  /** events.slug — experiences.event_id is the slug (key trap). */
  eventSlug: string;
  /** Sent as-is to ai-generate-image (kind 'border', greenScreen true). */
  opts: GenerateImageOpts & { layout: FrameLayout };
  text?: FrameTextOverlay | null;
  extraConfig?: Record<string, unknown>;
  signal?: AbortSignal;
  onStage?: (stage: FrameStage) => void;
}

export interface FrameRunResult {
  /** Ranked: the best usable take first. */
  takes: FrameTake[];
  job: AiJob;
  /** The one automatic quality retry ran. */
  autoRetried: boolean;
  /** The server confirmed that retry was free. */
  retryFree: boolean;
  /** The deployed server cannot do a free retry; no auto-retry was attempted. */
  retryUnavailable: boolean;
}

async function processTakes(req: FrameRunRequest, exps: Experience[]): Promise<FrameTake[]> {
  const out: FrameTake[] = [];
  // Sequential on purpose: one worker, and three 2M-pixel keys at once would
  // only queue there anyway while tripling peak memory on a phone.
  for (const exp of exps) {
    const r = await processGeneratedFrame(exp, req.eventSlug, req.extraConfig ?? {}, {
      layout: req.opts.layout,
      text: req.text ?? null,
    });
    out.push({ experience: r.experience, keyed: r.keyed, quality: r.quality });
  }
  return out;
}

/**
 * Generate → key → gate, then AT MOST ONE automatic retry with a correction
 * when no take is usable. The retry is sent as `retryOf` (free, once per
 * frame, enforced server-side) — and only to a server that reports it can
 * honour that: the currently deployed function ignores `retryOf`, so an auto
 * retry there would silently charge the host again. On such a server the
 * caller offers the retry instead, at its real price.
 */
export async function runFrameGeneration(req: FrameRunRequest): Promise<AiResult<FrameRunResult>> {
  req.onStage?.('painting');
  const call = { signal: req.signal, timeoutMs: FRAME_CLIENT_TIMEOUT_MS };
  const first = await generateImage(req.eventUuid, req.opts, call);
  if (first.error !== null || !first.data) return { data: null, error: first.error ?? 'internal' };

  req.onStage?.('checking');
  let takes = await processTakes(req, resultTakes(first.data));
  const job = first.data.job;
  const canRetry = serverHasFreeRetry(first.data);
  let autoRetried = false;
  let retryFree = false;

  const best = rankTakes(takes)[0];
  const code = best && !takeUsable(best) ? autoRetryCode(best) : null;
  if (code && canRetry && req.signal?.aborted !== true) {
    req.onStage?.('tidying');
    const again = await generateImage(
      req.eventUuid,
      { ...req.opts, retryOf: job.id, retryFreeOnly: true, correction: code, variants: 1 },
      call,
    );
    autoRetried = true;
    if (again.error === null && again.data) {
      retryFree = again.data.retry?.free === true;
      req.onStage?.('checking');
      takes = [...(await processTakes(req, resultTakes(again.data))), ...takes];
    }
  }
  return {
    data: { takes: rankTakes(takes), job, autoRetried, retryFree, retryUnavailable: code !== null && !canRetry },
    error: null,
  };
}

/**
 * After a timeout or a cancel: what happened to the request we stopped
 * waiting for? Never starts a new (paid) generation.
 *   'done'    → it finished; here is its frame (still raw — run processTakes
 *               via processGeneratedFrame before placing it)
 *   'running' → still being made; check again shortly
 *   'failed'  → it failed and was refunded; a new try is safe
 *   'unknown' → no job found / the read failed
 */
export type FrameRecovery =
  | { state: 'done'; experience: Experience; job: AiJob }
  | { state: 'running'; job: AiJob }
  | { state: 'failed'; job: AiJob }
  | { state: 'unknown' };

export async function recoverFrame(eventUuid: string, eventSlug: string, sinceIso: string): Promise<FrameRecovery> {
  const job = await findFrameJobSince(eventUuid, sinceIso);
  if (!job) return { state: 'unknown' };
  if (job.status === 'queued' || job.status === 'running') return { state: 'running', job };
  if (job.status === 'failed' || job.status === 'refunded') return { state: 'failed', job };
  const experience = await fetchExperienceForJob(eventSlug, job);
  return experience ? { state: 'done', experience, job } : { state: 'unknown' };
}

/** Error codes that mean "we stopped waiting", not "it failed". */
export function isWaitStopped(code: AiErrorCode | null): boolean {
  return code === 'timeout' || code === 'aborted';
}
