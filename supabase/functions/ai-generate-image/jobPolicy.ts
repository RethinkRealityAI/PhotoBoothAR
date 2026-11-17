/**
 * jobPolicy — the charge-safety and response-handling rules of
 * ai-generate-image, as pure functions.
 *
 * PURE and Deno-free (same rules as frameLayout.ts): no `Deno.*`, no imports,
 * no request-scoped values. Imported by index.ts AND by the vitest suite
 * src/lib/aiImageJobPolicy.test.ts, so every money rule here is tested in CI
 * even though tsconfig excludes supabase/. Deployed alongside index.ts
 * (deploy_edge_function files: index.ts, frameLayout.ts, jobPolicy.ts, deno.json).
 */

/* ── Charge-safe retry ────────────────────────────────────────────────────
 * The client's frame quality gate (src/lib/studio/frameQuality.ts) may ask for
 * ONE automatic regeneration of a frame that came back unusable. That retry is
 * free — the host already paid (or spent a trial slot) for a frame they cannot
 * use — but only under conditions a client cannot fake:
 *
 *   • the referenced job is THIS event's and THIS org's, kind 'image', a frame
 *     ('border'), and SUCCEEDED (a failed job was already refunded);
 *   • it is recent (RETRY_WINDOW_MS) — a retry is a correction, not a coupon;
 *   • same provider — a free retry must never be a free upgrade to the 2-credit
 *     provider;
 *   • it is not itself a retry — no chains;
 *   • it has not been retried before — enforced ATOMICALLY by the claim in
 *     index.ts (UPDATE … WHERE input->>'retriedBy' IS NULL), because two
 *     concurrent requests would both pass this read-only check.
 *
 * Net effect: at most TWO images per charge, ever. ai_jobs has only a member
 * SELECT policy (migration 003), so a host cannot clear `retriedBy` to re-arm
 * a claim. */

export const RETRY_WINDOW_MS = 30 * 60 * 1000;

export interface RetryOriginal {
  id: string;
  org_id: string;
  event_id: string | null;
  kind: string;
  provider: string;
  status: string;
  created_at: string;
  input: Record<string, unknown> | null;
}

export type RetryRejection =
  | 'not_found'
  | 'wrong_event'
  | 'not_a_frame'
  | 'not_succeeded'
  | 'too_old'
  | 'provider_mismatch'
  | 'is_a_retry'
  | 'already_retried';

export function retryEligibility(
  original: RetryOriginal | null,
  ctx: { eventUuid: string; orgId: string; provider: string; kind: string; nowMs: number },
): { ok: true } | { ok: false; reason: RetryRejection } {
  if (!original) return { ok: false, reason: 'not_found' };
  if (original.org_id !== ctx.orgId || original.event_id !== ctx.eventUuid) return { ok: false, reason: 'wrong_event' };
  const input = original.input ?? {};
  if (original.kind !== 'image' || input.kind !== 'border' || ctx.kind !== 'border') {
    return { ok: false, reason: 'not_a_frame' };
  }
  if (original.status !== 'succeeded') return { ok: false, reason: 'not_succeeded' };
  const created = Date.parse(original.created_at);
  if (!Number.isFinite(created) || ctx.nowMs - created > RETRY_WINDOW_MS || created - ctx.nowMs > 60_000) {
    return { ok: false, reason: 'too_old' };
  }
  if (original.provider !== ctx.provider) return { ok: false, reason: 'provider_mismatch' };
  if (typeof input.retryOf === 'string' && input.retryOf) return { ok: false, reason: 'is_a_retry' };
  if (input.retriedBy !== undefined && input.retriedBy !== null) return { ok: false, reason: 'already_retried' };
  return { ok: true };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A well-formed `retryOf`, or null. Anything else is ignored (the request
 *  proceeds as an ordinary, charged generation) — never a 400, so a stale
 *  client cannot break generation by sending junk. */
export function parseRetryOf(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;
}

/* ── Variants ─────────────────────────────────────────────────────────────
 * `variants: 1-2` generates that many takes IN PARALLEL with per-variant
 * nudges so they actually differ. HOW variants are charged is the owner's
 * decision (made 2026-11-17: one charge per request, set capped at two): the
 * constant below is the one switch.
 *   'per_variant' — each take costs the provider's unit price (3 takes = 3
 *                   credits). Honest to provider cost; a failed take refunds.
 *   'per_request' — the whole request costs one unit regardless of takes.
 *                   Friendlier; the platform absorbs up to MAX_VARIANTS×
 *                   provider cost, which is why MAX_VARIANTS is 2, not 3.
 * Free-trial and retry requests are clamped to ONE take, so neither can mint
 * extra images. */

export type VariantPricing = 'per_variant' | 'per_request';
export const VARIANT_PRICING: VariantPricing = 'per_request';
export const MAX_VARIANTS = 2;
export const FREE_TRIAL_MAX_VARIANTS = 1;

export const VARIANT_NUDGES: readonly string[] = [
  '',
  'Variation: a richer, bolder interpretation with stronger contrast and more pronounced ornament.',
];

/**
 * A host-picked palette from the guided frame maker: up to three `#rrggbb`
 * hexes, dominant first. undefined/null → null (use the event's own palette).
 * Anything else malformed → 'invalid' so the handler 400s rather than
 * silently painting a frame in colours the host did not choose.
 */
export const MAX_PALETTE = 3;
export function parsePalette(v: unknown): string[] | null | 'invalid' {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_PALETTE) return 'invalid';
  const out: string[] = [];
  for (const h of v) {
    if (typeof h !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(h)) return 'invalid';
    out.push(h.toUpperCase());
  }
  return out;
}

/** Requested takes, clamped. Junk → 1. */
export function parseVariants(v: unknown): number {
  const n = typeof v === 'number' && Number.isInteger(v) ? v : 1;
  return Math.min(MAX_VARIANTS, Math.max(1, n));
}

/** Takes actually granted for this request. */
export function grantedVariants(requested: number, opts: { freeTrial: boolean; retry: boolean }): number {
  if (opts.retry) return 1;
  if (opts.freeTrial) return Math.min(requested, FREE_TRIAL_MAX_VARIANTS);
  return requested;
}

/** Credits for a request. `zero` = free trial, BYO key or an eligible retry. */
export function requestCost(
  unit: number,
  takes: number,
  opts: { zero: boolean; pricing?: VariantPricing },
): number {
  if (opts.zero) return 0;
  return (opts.pricing ?? VARIANT_PRICING) === 'per_variant' ? unit * takes : unit;
}

/** Credits to refund when some takes failed and at least one succeeded. */
export function partialRefund(
  unit: number,
  failedTakes: number,
  opts: { zero: boolean; pricing?: VariantPricing },
): number {
  if (opts.zero || failedTakes <= 0) return 0;
  return (opts.pricing ?? VARIANT_PRICING) === 'per_variant' ? unit * failedTakes : 0;
}

/* ── Gemini response handling ─────────────────────────────────────────── */

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
}

/**
 * The image to keep from a response's parts. Thinking image models can emit
 * interim "thought" images before the final one; the FINAL image is the last
 * non-thought image part. Falls back to the last image part of any kind.
 */
export function pickImagePart(parts: GeminiPart[] | undefined | null): GeminiPart | null {
  const images = (parts ?? []).filter((p) => typeof p?.inlineData?.data === 'string' && p.inlineData.data.length > 0);
  if (images.length === 0) return null;
  const final = images.filter((p) => p.thought !== true);
  const pool = final.length > 0 ? final : images;
  return pool[pool.length - 1];
}

/* ── Stored format ────────────────────────────────────────────────────── */

/** Identify a provider image by its BYTES. Gemini returns JPEG for some
 *  models, and storing those as `.png` / image/png made every consumer that
 *  trusts the extension mis-decode or mis-probe them. */
export function imageFormat(bytes: Uint8Array): { contentType: string; ext: string } | null {
  if (bytes.length < 16) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { contentType: 'image/png', ext: 'png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: 'image/jpeg', ext: 'jpg' };
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return riff && webp ? { contentType: 'image/webp', ext: 'webp' } : null;
}

/* ── Deadlines ────────────────────────────────────────────────────────── */

/** Whole Gemini chain budget. Supabase's request limit is 150 s; leaving
 *  ~35 s is what guarantees the refund + job-fail write still runs after a
 *  hung provider (Deno's fetch has no default timeout). */
export const GEMINI_BUDGET_MS = 115_000;
/** The optional stronger model gets at most this much of the budget, so a
 *  slow attempt can never starve the production model that follows it. */
export const PREFER_MODEL_MAX_MS = 55_000;
export const REFERENCE_FETCH_MS = 8_000;

/** Timeout for the next attempt given the deadline; null when spent. */
export function attemptTimeout(deadlineMs: number, nowMs: number, capMs = Infinity): number | null {
  const left = deadlineMs - nowMs;
  if (left < 3_000) return null;
  return Math.floor(Math.min(left, capMs));
}

/* ── Free-trial accounting ────────────────────────────────────────────── */

/** Does an existing ai_jobs row consume one of the event's free images?
 *  The index.ts count query is the SQL form of exactly this predicate. */
export function consumesFreeSlot(job: { kind: string; status: string; input: Record<string, unknown> | null }): boolean {
  if (job.kind !== 'image') return false;
  if (job.status === 'failed' || job.status === 'refunded') return false;
  const retryOf = job.input?.retryOf;
  return !(typeof retryOf === 'string' && retryOf);
}
