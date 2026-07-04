/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thin client for the manager-api edge function (day-of staff console).
 * The body token is the credential; the shared anon-key client satisfies the
 * function's verify_jwt gate.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type ManagerOp =
  | 'list_posts'
  | 'set_post_hidden'
  | 'set_post_approved'
  | 'delete_post'
  | 'get_wall_settings'
  | 'set_wall_settings';

export type ManagerApiError =
  | 'invalid_json'
  | 'invalid_body'
  | 'unknown_op'
  | 'invalid_args'
  | 'event_not_found'
  | 'bad_token'
  | 'internal'
  | 'network';

export interface ManagerApiResult<T> {
  data: T | null;
  error: ManagerApiError | null;
}

export async function callManagerApi<T = unknown>(
  slug: string,
  token: string,
  op: ManagerOp,
  args?: Record<string, unknown>,
): Promise<ManagerApiResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('manager-api', {
      body: { slug, token, op, args: args ?? {} },
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const body = (await error.context.json()) as { error?: string };
          return { data: null, error: (body.error as ManagerApiError) ?? 'internal' };
        } catch {
          return { data: null, error: 'internal' };
        }
      }
      return { data: null, error: 'network' };
    }
    return { data: ((data ?? {}) as { data?: T }).data ?? null, error: null };
  } catch (e) {
    console.error('[managerApi]', op, e);
    return { data: null, error: 'network' };
  }
}
