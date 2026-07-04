/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed client helpers for greeting cards / video guestbook (Phase 5).
 *
 * Host side (session-authed, member RLS): create/list cards, manage
 * contributions, publish/unpublish/send-email via the card-publish edge fn.
 * Guest side (anon key): contribute meta + init/upload/finalize via
 * card-contribute, and the public viewer read via card-view. Edge-function
 * error bodies are decoded FunctionsHttpError-style like managerApi.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export const CARDS_BUCKET = 'cards';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CardStatus = 'collecting' | 'published' | 'rendered';
export type CardTemplateId = 'storybook' | 'filmstrip';
export type ContributionMediaType = 'photo' | 'video' | 'text';

export interface CardRow {
  id: string;
  event_id: string;
  org_id: string;
  public_id: string;
  contribute_token: string;
  title: string;
  recipient_name: string | null;
  recipient_email: string | null;
  template: string;
  theme: Record<string, unknown>;
  status: CardStatus | string;
  contribution_deadline: string | null;
  published_at: string | null;
  created_at: string;
  /** Filled by listCards via a nested count. */
  contribution_count?: number;
}

export interface ContributionRow {
  id: string;
  card_id: string;
  contributor_name: string | null;
  message: string | null;
  media_type: ContributionMediaType | null;
  media_path: string | null;
  duration_seconds: number | null;
  sort_order: number;
  approved: boolean;
  hidden: boolean;
  created_at: string;
}

/** Public metadata for the contribute page (card-contribute 'meta'). */
export interface ContributeMeta {
  title: string;
  recipientName: string | null;
  eventName: string | null;
  deadline: string | null;
  /** 'collecting' | 'closed' (deadline passed) | 'published' | 'rendered' */
  status: string;
  template: string;
}

/** Viewer payload (card-view). */
export interface CardViewData {
  title: string;
  recipientName: string | null;
  template: string;
  theme: Record<string, unknown>;
  publishedAt: string | null;
  eventName: string | null;
}

export interface CardViewContribution {
  id: string;
  contributorName: string | null;
  message: string | null;
  mediaType: ContributionMediaType;
  durationSeconds: number | null;
  /** 1h signed media URL (null for text contributions). */
  url: string | null;
  sortOrder: number;
}

export type CardsError =
  | 'card_not_found'
  | 'card_closed'
  | 'deadline_passed'
  | 'quota_exceeded'
  | 'upgrade_required'
  | 'forbidden'
  | 'unauthorized'
  | 'not_published'
  | 'invalid_recipient'
  | 'email_not_configured'
  | 'email_failed'
  | 'object_too_large'
  | 'message_required'
  | 'invalid_body'
  | 'internal'
  | 'network';

export interface CardsResult<T> {
  data: T | null;
  error: CardsError | null;
}

/** Invoke an edge fn, decoding non-2xx `{ error }` bodies (managerApi style). */
async function invokeCardsFn<T>(name: string, body: Record<string, unknown>): Promise<CardsResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          return { data: null, error: (res.error as CardsError) ?? 'internal' };
        } catch {
          return { data: null, error: 'internal' };
        }
      }
      return { data: null, error: 'network' };
    }
    return { data: (data ?? null) as T, error: null };
  } catch (e) {
    console.error(`[cards] ${name}`, e);
    return { data: null, error: 'network' };
  }
}

/* ------------------------------------------------------------------ */
/* Host: card CRUD (direct member-RLS access)                          */
/* ------------------------------------------------------------------ */

export interface CreateCardInput {
  title: string;
  recipientName?: string;
  recipientEmail?: string;
  template?: CardTemplateId | string;
  /** ISO timestamp; contributions close after this. */
  deadline?: string;
}

/** Insert a card for the event (member RLS). org_id is derived from the event. */
export async function createCard(eventSlug: string, input: CreateCardInput): Promise<CardRow | null> {
  const { data: event, error: evErr } = await supabase
    .from('events')
    .select('org_id')
    .eq('slug', eventSlug)
    .maybeSingle();
  if (evErr || !event) {
    console.error('[cards] createCard (event lookup)', evErr);
    return null;
  }
  const { data, error } = await supabase
    .from('cards')
    .insert({
      event_id: eventSlug,
      org_id: event.org_id as string,
      title: input.title.trim(),
      recipient_name: input.recipientName?.trim() || null,
      recipient_email: input.recipientEmail?.trim() || null,
      template: input.template ?? 'storybook',
      contribution_deadline: input.deadline || null,
    })
    .select()
    .single();
  if (error) {
    console.error('[cards] createCard', error);
    return null;
  }
  return data as CardRow;
}

/** Every card of the event (member RLS), newest first, with contribution counts. */
export async function listCards(eventSlug: string): Promise<CardRow[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*, card_contributions(count)')
    .eq('event_id', eventSlug)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[cards] listCards', error);
    return [];
  }
  return ((data ?? []) as (CardRow & { card_contributions?: { count: number }[] })[]).map((row) => {
    const { card_contributions, ...card } = row;
    return { ...card, contribution_count: card_contributions?.[0]?.count ?? 0 };
  });
}

export async function deleteCard(cardId: string): Promise<boolean> {
  const { error } = await supabase.from('cards').delete().eq('id', cardId);
  if (error) {
    console.error('[cards] deleteCard', error);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Host: contribution moderation                                       */
/* ------------------------------------------------------------------ */

export async function listContributions(cardId: string): Promise<ContributionRow[]> {
  const { data, error } = await supabase
    .from('card_contributions')
    .select('*')
    .eq('card_id', cardId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[cards] listContributions', error);
    return [];
  }
  return (data as ContributionRow[]) ?? [];
}

export async function updateContribution(
  id: string,
  patch: Partial<Pick<ContributionRow, 'hidden' | 'approved' | 'sort_order'>>,
): Promise<boolean> {
  const { error } = await supabase.from('card_contributions').update(patch).eq('id', id);
  if (error) {
    console.error('[cards] updateContribution', error);
    return false;
  }
  return true;
}

export async function deleteContribution(id: string): Promise<boolean> {
  const { error } = await supabase.from('card_contributions').delete().eq('id', id);
  if (error) {
    console.error('[cards] deleteContribution', error);
    return false;
  }
  return true;
}

/**
 * Studio previews: sign private 'cards' media paths for member viewing.
 * Requires the cards_bucket_member_read storage policy (007); when it's
 * unavailable the map comes back empty and the UI falls back to icons.
 */
export async function signContributionUrls(paths: string[], ttlSeconds = 3600): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!paths.length) return map;
  const { data, error } = await supabase.storage.from(CARDS_BUCKET).createSignedUrls(paths, ttlSeconds);
  if (error || !data) {
    if (error) console.warn('[cards] signContributionUrls', error);
    return map;
  }
  for (const s of data) {
    if (s.path && s.signedUrl && !s.error) map.set(s.path, s.signedUrl);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Host: publish lifecycle (card-publish edge fn)                      */
/* ------------------------------------------------------------------ */

export interface PublishedCard {
  id: string;
  status: string;
  publishedAt: string | null;
  publicId: string;
}

export function publishCard(cardId: string): Promise<CardsResult<{ card: PublishedCard }>> {
  return invokeCardsFn('card-publish', { cardId, action: 'publish' });
}

export function unpublishCard(cardId: string): Promise<CardsResult<{ card: PublishedCard }>> {
  return invokeCardsFn('card-publish', { cardId, action: 'unpublish' });
}

export function sendCardEmail(cardId: string): Promise<CardsResult<{ sent: boolean }>> {
  return invokeCardsFn('card-publish', { cardId, action: 'send_email' });
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

/** Shareable guest contribute URL (the token IS the credential — long-lived by design). */
export function contributeUrl(card: Pick<CardRow, 'public_id' | 'contribute_token'>, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/c/${card.public_id}/contribute?t=${card.contribute_token}`;
}

/** Public viewer path for a card. */
export function viewerPath(publicId: string): string {
  return `/c/${publicId}`;
}

/* ------------------------------------------------------------------ */
/* Guest: contribute flow (card-contribute edge fn)                    */
/* ------------------------------------------------------------------ */

export async function fetchContributeMeta(token: string): Promise<CardsResult<ContributeMeta>> {
  const res = await invokeCardsFn<{ card: ContributeMeta }>('card-contribute', { action: 'meta', token });
  return { data: res.data?.card ?? null, error: res.error };
}

export function contributeInit(args: {
  token: string;
  sessionId: string;
  mediaType: 'photo' | 'video';
  contentType: string;
  ext: string;
}): Promise<CardsResult<{ path: string; token: string }>> {
  return invokeCardsFn('card-contribute', { action: 'init', ...args });
}

export interface FinalizeInput {
  token: string;
  sessionId: string;
  path?: string;
  contributorName?: string;
  message?: string;
  mediaType: ContributionMediaType;
  durationSeconds?: number;
  textOnly?: boolean;
}

export function contributeFinalize(
  args: FinalizeInput,
): Promise<CardsResult<{ contribution: { id: string; contributorName: string | null; mediaType: string } }>> {
  return invokeCardsFn('card-contribute', { action: 'finalize', ...args });
}

function extForBlob(blob: Blob, isVideo: boolean): string {
  const t = blob.type;
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('webm')) return 'webm';
  if (t.includes('mp4')) return 'mp4';
  return isVideo ? 'webm' : 'jpg';
}

export interface SubmitContributionInput {
  contributorName: string;
  message?: string;
  mediaType: ContributionMediaType;
  /** Required for photo/video; ignored for text. */
  blob?: Blob;
  durationSeconds?: number;
}

/**
 * Full guest submission: text-only finalizes directly; media runs
 * init → signed upload → finalize (submit-post pattern, 'cards' bucket).
 */
export async function submitContribution(
  token: string,
  sessionId: string,
  input: SubmitContributionInput,
): Promise<CardsResult<{ id: string }>> {
  if (input.mediaType === 'text') {
    const res = await contributeFinalize({
      token,
      sessionId,
      mediaType: 'text',
      textOnly: true,
      contributorName: input.contributorName,
      message: input.message,
    });
    return { data: res.data ? { id: res.data.contribution.id } : null, error: res.error };
  }

  if (!input.blob) return { data: null, error: 'invalid_body' };
  const isVideo = input.mediaType === 'video';
  const contentType = input.blob.type || (isVideo ? 'video/webm' : 'image/jpeg');
  const ext = extForBlob(input.blob, isVideo);

  const init = await contributeInit({ token, sessionId, mediaType: input.mediaType, contentType, ext });
  if (init.error || !init.data) return { data: null, error: init.error ?? 'internal' };

  const { error: upErr } = await supabase.storage
    .from(CARDS_BUCKET)
    .uploadToSignedUrl(init.data.path, init.data.token, input.blob, { contentType });
  if (upErr) {
    console.error('[cards] submitContribution upload', upErr);
    return { data: null, error: 'network' };
  }

  const fin = await contributeFinalize({
    token,
    sessionId,
    path: init.data.path,
    contributorName: input.contributorName,
    message: input.message,
    mediaType: input.mediaType,
    durationSeconds: input.durationSeconds,
  });
  return { data: fin.data ? { id: fin.data.contribution.id } : null, error: fin.error };
}

/* ------------------------------------------------------------------ */
/* Guest: public viewer (card-view edge fn)                            */
/* ------------------------------------------------------------------ */

export async function viewCard(
  publicId: string,
): Promise<CardsResult<{ card: CardViewData; contributions: CardViewContribution[] }>> {
  return invokeCardsFn('card-view', { publicId });
}
