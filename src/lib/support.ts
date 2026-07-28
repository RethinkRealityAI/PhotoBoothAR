/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client half of the support suite.
 *
 * WRITES go through the `support-api` edge function: it is the only writer, so
 * the rate-limit and size guards in migration 024 cannot be walked around, and
 * it is where the Resend mail is sent from. READS go straight through PostgREST
 * on the RLS policies from 023, which is what the host UI wants anyway.
 *
 * Reads that can fail get a `*Result` sibling returning `{ data, failed }`, per
 * the house convention (db.ts:59, host.ts:34) — a support screen that cannot
 * tell "you have no tickets" from "we could not reach the server" would tell a
 * customer their report vanished.
 */
import { supabase } from './supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  redactDiagnostics,
  redactUrl,
  type SupportCategory,
  type SupportPriority,
  type SupportSource,
  type SupportStatus,
} from './supportModel';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface SupportTicket {
  id: string;
  public_ref: string;
  org_id: string | null;
  event_id: string | null;
  event_slug: string | null;
  created_by: string | null;
  reporter_email: string | null;
  reporter_name: string | null;
  source: SupportSource;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  subject: string;
  assigned_to: string | null;
  diagnostics: Record<string, unknown> | null;
  session_id: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  customer_last_read_at: string | null;
  admin_last_read_at: string | null;
  admin_unread: boolean;
  customer_unread: boolean;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  /** Joined by admin_list_tickets only. */
  org_name?: string | null;
}

export interface SupportMessage {
  id: string;
  ticket_id?: string;
  author_kind: 'customer' | 'admin' | 'system';
  author_user_id: string | null;
  author_email: string | null;
  body: string;
  internal: boolean;
  attachments: string[];
  email_sent_at?: string | null;
  email_error?: string | null;
  created_at: string;
}

export interface SupportResult<T> {
  data: T | null;
  /** null on success, else an edge-fn error code. */
  error: string | null;
}

/** The columns a customer may read. `internal` is excluded by RLS anyway; it is
 *  listed here so the shape is explicit at the call site. */
const TICKET_COLS =
  'id, public_ref, org_id, event_id, event_slug, created_by, reporter_email, reporter_name,' +
  ' source, category, priority, status, subject, assigned_to, diagnostics, session_id,' +
  ' first_response_at, resolved_at, customer_last_read_at, admin_last_read_at,' +
  ' admin_unread, customer_unread, last_message_at, created_at, updated_at';

/* ------------------------------------------------------------------ */
/* The one door for writes                                             */
/* ------------------------------------------------------------------ */

/** Invoke a support-api action, unwrapping the `{ data }` envelope and the
 *  function's `{ error }` body on a non-2xx (mirrors admin.ts adminApi). */
export async function supportApi<T = unknown>(
  action: string,
  args?: Record<string, unknown>,
): Promise<SupportResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('support-api', {
      body: { action, args: args ?? {} },
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          return { data: null, error: res.error ?? 'internal' };
        } catch {
          return { data: null, error: 'internal' };
        }
      }
      return { data: null, error: 'network' };
    }
    const res = (data ?? {}) as { data?: T };
    return { data: (res.data ?? null) as T | null, error: null };
  } catch (e) {
    console.error(`[support] ${action}`, e);
    return { data: null, error: 'network' };
  }
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

/** Optional build tag; '' (unset) is treated as absent (errorReport.ts's rule). */
const appVersion =
  ((import.meta.env.VITE_APP_VERSION as string | undefined) ?? '').trim() || null;

/**
 * What we attach to a report, already redacted.
 *
 * Every URL here goes through redactUrl first: after a Supabase recovery or
 * magic-link flow the fragment carries a session-granting access_token, and an
 * operator reading a ticket must never be handed one. The dialog shows this
 * object to the user before they send it — nothing is attached invisibly.
 */
export function collectDiagnostics(extra?: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = { appVersion, mode: import.meta.env.MODE };
  try {
    base.url = redactUrl(window.location.href);
    base.referrer = redactUrl(document.referrer);
    base.viewport = `${window.innerWidth}x${window.innerHeight}`;
    base.dpr = window.devicePixelRatio;
    base.userAgent = navigator.userAgent.slice(0, 400);
    base.language = navigator.language;
    base.online = navigator.onLine;
  } catch {
    // A locked-down or headless environment: partial diagnostics beat none, and
    // this must never be the reason a report cannot be filed.
  }
  return redactDiagnostics({ ...base, ...(extra ?? {}) });
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export interface NewTicketInput {
  subject: string;
  body: string;
  category: SupportCategory;
  source: SupportSource;
  eventSlug?: string | null;
  sessionId?: string | null;
  /** Guests only — a signed-in caller's address comes from their JWT. */
  reporterEmail?: string | null;
  reporterName?: string | null;
  diagnostics?: Record<string, unknown>;
}

export interface CreatedTicket {
  id: string;
  publicRef: string;
  status: SupportStatus;
  createdAt: string;
}

export async function createTicket(
  input: NewTicketInput,
): Promise<SupportResult<{ ticket: CreatedTicket; emailed: boolean }>> {
  return supportApi('create_ticket', {
    subject: input.subject,
    body: input.body,
    category: input.category,
    source: input.source,
    eventSlug: input.eventSlug ?? null,
    sessionId: input.sessionId ?? null,
    reporterEmail: input.reporterEmail ?? null,
    reporterName: input.reporterName ?? null,
    diagnostics: input.diagnostics ?? collectDiagnostics(),
  });
}

export async function replyToTicket(
  ticketId: string,
  body: string,
): Promise<SupportResult<{ message: { id: string; createdAt: string }; status: SupportStatus }>> {
  return supportApi('reply', { ticketId, body });
}

/** Stamp the customer's read pointer. Fire-and-forget: a failed read receipt
 *  must never block or error the screen the customer is already looking at. */
export function markTicketRead(ticketId: string): void {
  supabase.rpc('support_mark_read', { p_ticket: ticketId }).then(
    () => {},
    (e: unknown) => console.error('[support] markTicketRead', e),
  );
}

export async function fetchMyUnreadCount(): Promise<number> {
  const { data } = await supportApi<{ unread: number }>('my_counts');
  return data?.unread ?? 0;
}

/* ------------------------------------------------------------------ */
/* Reads (RLS)                                                         */
/* ------------------------------------------------------------------ */

export interface ListResult<T> {
  data: T[];
  /** true = the query failed, which is NOT the same as "there are none". */
  failed: boolean;
}

export async function fetchMyTicketsResult(): Promise<ListResult<SupportTicket>> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select(TICKET_COLS)
    .order('last_message_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[support] fetchMyTickets', error);
    return { data: [], failed: true };
  }
  return { data: (data ?? []) as unknown as SupportTicket[], failed: false };
}

export async function fetchTicketResult(
  ticketId: string,
): Promise<{ ticket: SupportTicket | null; messages: SupportMessage[]; failed: boolean }> {
  const [tRes, mRes] = await Promise.all([
    supabase.from('support_tickets').select(TICKET_COLS).eq('id', ticketId).maybeSingle(),
    supabase
      .from('support_messages')
      // `internal` is filtered by the RLS policy in 023; repeating it here is
      // belt and braces on the one leak that would be business-ending.
      .select('id, author_kind, author_user_id, author_email, body, internal, attachments, created_at')
      .eq('ticket_id', ticketId)
      .eq('internal', false)
      .order('created_at', { ascending: true }),
  ]);
  if (tRes.error || mRes.error) {
    console.error('[support] fetchTicket', tRes.error ?? mRes.error);
    return { ticket: null, messages: [], failed: true };
  }
  return {
    ticket: (tRes.data ?? null) as unknown as SupportTicket | null,
    messages: (mRes.data ?? []) as unknown as SupportMessage[],
    failed: false,
  };
}

/* ------------------------------------------------------------------ */
/* Admin (platform operator)                                           */
/* ------------------------------------------------------------------ */
/* These go through support-api too, which asserts is_platform_admin BEFORE its
 * dispatch switch — the same structural guard admin-api uses, so a new admin
 * action cannot forget its gate. The customer RLS policies are never widened
 * for the operator; cross-tenant reads happen on the service role. */

export interface AdminTicketDetail {
  ticket: SupportTicket;
  /** Includes `internal` notes — the customer's policy in 023 excludes them. */
  messages: SupportMessage[];
  org: { id: string; name: string } | null;
  event: { id: string; name: string; slug: string; status: string } | null;
  /** client_errors rows sharing this ticket's session_id: what the browser
   *  reported around the time the human wrote in. */
  recentErrors: Array<{ id: string; message: string; url: string; created_at: string }>;
}

export interface AdminTicketFilters {
  search?: string;
  status?: string;
  priority?: string;
  category?: string;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export function adminListTickets(filters: AdminTicketFilters) {
  return supportApi<{ tickets: SupportTicket[]; hasMore: boolean }>('admin_list_tickets', { ...filters });
}

export function adminGetTicket(ticketId: string) {
  return supportApi<AdminTicketDetail>('admin_get_ticket', { ticketId });
}

export function adminReply(ticketId: string, body: string, internal = false) {
  return supportApi<{ message: { id: string; createdAt: string }; emailed: boolean }>(
    'admin_reply', { ticketId, body, internal },
  );
}

export function adminSetStatus(ticketId: string, status: SupportStatus) {
  return supportApi<{ ticket: SupportTicket }>('admin_set_status', { ticketId, status });
}

export function adminSetPriority(ticketId: string, priority: SupportPriority) {
  return supportApi<{ ticket: SupportTicket }>('admin_set_priority', { ticketId, priority });
}

export function adminMarkRead(ticketId: string) {
  return supportApi<{ ok: true }>('admin_mark_read', { ticketId });
}

export function adminSupportCounts() {
  return supportApi<{ unread: number; open: number }>('admin_counts');
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

const SUPPORT_BUCKET = 'support';

/** Signed-in customers only — the `support` bucket has no anon insert policy,
 *  deliberately (an anon-writable prefix is free file hosting). */
export async function uploadSupportScreenshot(
  orgId: string,
  ticketId: string,
  file: File,
): Promise<string | null> {
  const safe = (file.name || 'screenshot').replace(/[^a-z0-9.\-_]/gi, '_').slice(0, 80);
  const uid = Math.random().toString(36).slice(2, 10);
  const path = `${orgId}/${ticketId}/${uid}-${safe}`;
  const { error } = await supabase.storage
    .from(SUPPORT_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) {
    console.error('[support] uploadSupportScreenshot', error);
    return null;
  }
  return path;
}

/** The bucket is PRIVATE, so a screenshot needs a signed URL to render. */
export async function signedAttachmentUrl(path: string, seconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(SUPPORT_BUCKET)
    .createSignedUrl(path, seconds);
  if (error) {
    console.error('[support] signedAttachmentUrl', error);
    return null;
  }
  return data?.signedUrl ?? null;
}
