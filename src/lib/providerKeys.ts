/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client half of bring-your-own provider credentials (Higgsfield today).
 *
 * The secret travels ONE WAY. `org_provider_keys` has RLS enabled with no
 * policies at all (migration 030), so neither anon nor authenticated can read
 * it — the `provider-keys` edge function on the service role is the only
 * reader/writer, and it asserts org membership itself. Nothing here can read a
 * stored secret back; `status` answers only "is one configured" plus a masked
 * id, decoded by normalizeProviderKeyStatus.
 *
 * Error bodies are decoded from FunctionsHttpError exactly as ai.ts invokeAi
 * and support.ts supportApi do (the pattern is copied, not imported, so this
 * module owns its own error union and pulls in no AI types).
 *
 * The PURE parts — validation, masking, response decoding — live in
 * ./providerKeysModel.ts so they are testable under the vitest node env; this
 * file imports ./supabase and is therefore not node-testable by house rule.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  normalizeProviderKeyStatus,
  validateKeyInput,
  type ProviderId,
  type ProviderKeyStatus,
} from './providerKeysModel';

export interface ProviderKeyResult<T> {
  data: T | null;
  /** null on success, else an edge-fn error code ('network' for transport). */
  error: string | null;
  /** Human-readable detail when we have one (local validation, mostly). */
  message?: string;
}

/**
 * Invoke a `provider-keys` action. Body shape is the house multi-action
 * convention `{ action, args }` (admin-api, support-api); the response envelope
 * is unwrapped from `{ data }` when present and used as-is otherwise, so the
 * client works against either envelope the function chooses.
 */
async function providerKeysApi<T>(
  action: 'status' | 'set' | 'clear',
  args: Record<string, unknown> = {},
): Promise<ProviderKeyResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('provider-keys', {
      body: { action, args },
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string; message?: string };
          return { data: null, error: res.error ?? 'internal', ...(res.message ? { message: res.message } : {}) };
        } catch {
          return { data: null, error: 'internal' };
        }
      }
      return { data: null, error: 'network' };
    }
    const res = (data ?? {}) as Record<string, unknown>;
    const payload = 'data' in res ? res.data : res;
    return { data: (payload ?? null) as T | null, error: null };
  } catch (e) {
    console.error(`[providerKeys] ${action}`, e);
    return { data: null, error: 'network' };
  }
}

/** Is a BYO key installed for this org, and is the platform key available? */
export async function fetchProviderKeyStatus(
  provider: ProviderId = 'higgsfield',
  orgId?: string,
): Promise<ProviderKeyResult<ProviderKeyStatus>> {
  const res = await providerKeysApi<unknown>('status', {
    provider,
    ...(orgId ? { orgId } : {}),
  });
  if (res.error) return { data: null, error: res.error, ...(res.message ? { message: res.message } : {}) };
  return { data: normalizeProviderKeyStatus(res.data), error: null };
}

/**
 * Store (or replace) the org's key for a provider. Validated locally FIRST — a
 * blank or wrapped paste is caught without a round trip, and the returned
 * `message` is the copy the form shows.
 */
export async function setProviderKey(
  keyId: string,
  keySecret: string,
  provider: ProviderId = 'higgsfield',
  orgId?: string,
): Promise<ProviderKeyResult<ProviderKeyStatus>> {
  const problem = validateKeyInput(keyId, keySecret);
  if (problem) return { data: null, error: 'invalid_body', message: problem };
  const res = await providerKeysApi<unknown>('set', {
    provider,
    keyId: keyId.trim(),
    keySecret: keySecret.trim(),
    ...(orgId ? { orgId } : {}),
  });
  if (res.error) return { data: null, error: res.error, ...(res.message ? { message: res.message } : {}) };
  return { data: normalizeProviderKeyStatus(res.data), error: null };
}

/** Remove the org's key, so generation falls back to the platform's own. */
export async function clearProviderKey(
  provider: ProviderId = 'higgsfield',
  orgId?: string,
): Promise<ProviderKeyResult<ProviderKeyStatus>> {
  const res = await providerKeysApi<unknown>('clear', {
    provider,
    ...(orgId ? { orgId } : {}),
  });
  if (res.error) return { data: null, error: res.error, ...(res.message ? { message: res.message } : {}) };
  return { data: normalizeProviderKeyStatus(res.data), error: null };
}

/** Customer-safe copy per error code. The real cause stays in the logs. */
export function providerKeyErrorMessage(code: string, message?: string): string {
  if (message) return message;
  switch (code) {
    case 'unauthorized':
      return 'Sign in to your host account to manage provider keys.';
    case 'forbidden':
      return 'Your account does not have access to this organisation.';
    case 'invalid_body':
    case 'invalid_key':
      return 'That key pair was rejected — check you pasted the id and the secret.';
    case 'rate_limited':
      return 'Too many attempts — give it a minute and try again.';
    case 'network':
      return 'Network error — check your connection and try again.';
    default:
      return 'Something went wrong saving that key — please try again.';
  }
}

export type { ProviderId, ProviderKeyStatus };
