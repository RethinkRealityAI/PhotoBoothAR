/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure half of bring-your-own provider credentials (Higgsfield today).
 *
 * WHY THIS FILE EXISTS SEPARATELY from providerKeys.ts: the client half has to
 * import ./supabase, and a vitest `node` test file may not reach that module.
 * So the validation, masking and response decoding — the parts worth testing —
 * live here with zero imports, exactly like supportModel.ts sits under
 * support.ts and listState.ts under the list screens.
 *
 * NOTHING HERE EVER SEES A DECRYPTED SECRET COMING BACK: the secret travels
 * one way (browser → `provider-keys` edge fn → org_provider_keys, whose RLS has
 * no policies at all — migration 030). The only thing the server returns is
 * whether a key is configured plus a masked id, which is what
 * {@link normalizeProviderKeyStatus} decodes.
 */

/** Providers a host may bring their own credentials for. Matches the CHECK
 *  constraint on org_provider_keys.provider (migration 030). */
export type ProviderId = 'higgsfield';

/** How much we know about a stored key. 'unverified' = nothing has called the
 *  provider with it yet, which is the honest default, not a warning. */
export type ProviderKeyState = 'unverified' | 'valid' | 'invalid';

export interface ProviderKeyStatus {
  /** The org has its own key stored for this provider. */
  configured: boolean;
  /** Masked id of the stored key, or null when none is stored. Never the secret. */
  keyIdMasked: string | null;
  /**
   * The PLATFORM's own key for this provider is configured server-side — i.e. a
   * host with no key of their own can still generate, paying platform credits.
   * False means BYO is the only route.
   */
  platformAvailable: boolean;
  /** Present only when the server reported it. */
  status?: ProviderKeyState;
}

/** Longest key id / secret we will send. Real Higgsfield credentials are far
 *  shorter; past this the paste is a file, a URL, or a whole JSON blob. */
export const KEY_FIELD_MAX = 200;

/** How many leading/trailing characters of a key id stay visible. */
const VISIBLE = 4;

/**
 * Mask a key id for display. Short ids are masked ENTIRELY — showing 4 of 6
 * characters is not a mask. Longer ones keep the first and last 4 (enough for a
 * host to recognise which of their keys is installed) with a fixed-width middle,
 * so the mask does not leak the exact length either.
 */
export function maskKeyId(keyId: string): string {
  const s = keyId.trim();
  if (!s) return '';
  if (s.length <= VISIBLE * 2) return '•'.repeat(s.length);
  return `${s.slice(0, VISIBLE)}${'•'.repeat(8)}${s.slice(-VISIBLE)}`;
}

/**
 * Accept the shape people actually paste — `id:secret` on one line, which is how
 * most dashboards offer a key pair for copying. Splits on the FIRST colon only,
 * because a secret may legitimately contain colons. Returns null when the raw
 * text is not a pair (no colon, or either half empty) — the caller then treats
 * it as a plain key id and lets validateKeyInput ask for the missing half.
 */
export function splitCombinedKey(raw: string): { keyId: string; keySecret: string } | null {
  const s = (raw ?? '').trim();
  const at = s.indexOf(':');
  if (at <= 0) return null; // no colon, or a leading colon (empty id)
  const keyId = s.slice(0, at).trim();
  const keySecret = s.slice(at + 1).trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

/**
 * Validate what the host typed BEFORE spending a round trip on it. Returns a
 * human-readable error, or null when the pair is worth sending.
 *
 * Deliberately NOT a format/prefix check: a provider is free to change its key
 * format, and a client that rejects a valid new-format key is worse than one
 * that lets the server say no. We only catch the mistakes that are certainly
 * mistakes — blank, whitespace-only, absurdly long, or containing whitespace
 * (a wrapped copy-paste, the single most common way a key arrives broken).
 */
export function validateKeyInput(keyId: string, keySecret: string): string | null {
  const id = (keyId ?? '').trim();
  const secret = (keySecret ?? '').trim();
  if (!id) return 'Paste your key id.';
  if (!secret) return 'Paste your key secret.';
  if (id.length > KEY_FIELD_MAX || secret.length > KEY_FIELD_MAX) {
    return `That is longer than ${KEY_FIELD_MAX} characters — paste just the key, not the whole page.`;
  }
  if (/\s/.test(id) || /\s/.test(secret)) {
    return 'Keys cannot contain spaces or line breaks — check the copy-paste.';
  }
  return null;
}

const KEY_STATES: ReadonlySet<string> = new Set<ProviderKeyState>(['unverified', 'valid', 'invalid']);

/**
 * Decode the `provider-keys` status payload. Untrusted-input rules apply even
 * though the source is our own function: a malformed 200 must degrade to "no
 * key, no platform key" rather than paint a key the org does not have.
 *
 * A FAILED read is NOT this shape's job — the client returns `{ data: null,
 * error }` for that, so a network failure can never be mistaken for "not
 * configured". Booleans are compared to `true` explicitly (truthiness on a
 * value that can be absent is the trap CLAUDE.md names).
 */
export function normalizeProviderKeyStatus(raw: unknown): ProviderKeyStatus {
  const o = (raw ?? {}) as Record<string, unknown>;
  const masked = typeof o.keyIdMasked === 'string' ? o.keyIdMasked.trim() : '';
  const state = typeof o.status === 'string' && KEY_STATES.has(o.status)
    ? (o.status as ProviderKeyState)
    : null;
  return {
    configured: o.configured === true,
    keyIdMasked: masked || null,
    platformAvailable: o.platformAvailable === true,
    ...(state ? { status: state } : {}),
  };
}
