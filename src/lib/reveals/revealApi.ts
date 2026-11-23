/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * revealApi — the database half of marketing reveals (migration 052).
 *
 *   readers  fetchPublishedReveal(slug): the anon RPC, published blob only
 *   admins   list / get / create / saveDraft / publish / unpublish / remove,
 *            straight to the table (RLS: is_platform_admin()).
 *
 * Every function reports failure as a value ('failed' / null / false), never
 * a throw, so a page can always show an honest state.
 */
import { supabase } from '../supabase';
import { normalizeRevealDoc, presetDoc, uniqueSlug, type RevealDoc, type RevealOccasion } from './revealModel';

export interface RevealRow {
  id: string;
  slug: string;
  name: string;
  draft: RevealDoc;
  published: RevealDoc | null;
  publishedAt: string | null;
  updatedAt: string;
}

/** Draft differs from what is live (or nothing is live yet). */
export function hasUnpublishedChanges(row: Pick<RevealRow, 'draft' | 'published'>): boolean {
  return row.published === null || JSON.stringify(row.draft) !== JSON.stringify(row.published);
}

interface DbRow {
  id: string;
  slug: string;
  name: string;
  draft: unknown;
  published: unknown;
  published_at: string | null;
  updated_at: string;
}

const COLS = 'id, slug, name, draft, published, published_at, updated_at';

function toRow(r: DbRow): RevealRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    draft: normalizeRevealDoc(r.draft),
    published: r.published === null || r.published === undefined ? null : normalizeRevealDoc(r.published),
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
  };
}

/** Public: the published reveal, null when there is none, 'failed' when the read failed. */
export async function fetchPublishedReveal(slug: string): Promise<RevealDoc | null | 'failed'> {
  const { data, error } = await supabase.rpc('get_marketing_reveal', { p_slug: slug });
  if (error) return 'failed';
  if (data === null || data === undefined) return null;
  return normalizeRevealDoc(data);
}

export async function listReveals(): Promise<RevealRow[] | 'failed'> {
  const { data, error } = await supabase.from('marketing_reveals').select(COLS).order('updated_at', { ascending: false }).limit(200);
  if (error || !data) return 'failed';
  return (data as DbRow[]).map(toRow);
}

export async function getReveal(id: string): Promise<RevealRow | null | 'failed'> {
  const { data, error } = await supabase.from('marketing_reveals').select(COLS).eq('id', id).maybeSingle();
  if (error) return 'failed';
  return data ? toRow(data as DbRow) : null;
}

export async function createReveal(occasion: RevealOccasion, name: string, taken: readonly string[]): Promise<RevealRow | 'failed'> {
  const { data: u } = await supabase.auth.getUser();
  const doc = presetDoc(occasion);
  const { data, error } = await supabase
    .from('marketing_reveals')
    .insert({ slug: uniqueSlug(name, taken), name, draft: doc, created_by: u.user?.id ?? null })
    .select(COLS)
    .single();
  if (error || !data) return 'failed';
  return toRow(data as DbRow);
}

export async function saveRevealDraft(id: string, patch: { draft?: RevealDoc; name?: string; slug?: string }): Promise<RevealRow | 'failed' | 'slug_taken'> {
  const { data, error } = await supabase.from('marketing_reveals').update(patch).eq('id', id).select(COLS).maybeSingle();
  if (error) return error.code === '23505' ? 'slug_taken' : 'failed';
  // A zero-row update (deleted meanwhile, or RLS) is a failure, never a silent "saved".
  return data ? toRow(data as DbRow) : 'failed';
}

export async function publishReveal(id: string, doc: RevealDoc): Promise<RevealRow | 'failed'> {
  const { data, error } = await supabase
    .from('marketing_reveals')
    .update({ draft: doc, published: doc, published_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLS)
    .maybeSingle();
  if (error || !data) return 'failed';
  return toRow(data as DbRow);
}

export async function unpublishReveal(id: string): Promise<RevealRow | 'failed'> {
  const { data, error } = await supabase
    .from('marketing_reveals')
    .update({ published: null, published_at: null })
    .eq('id', id)
    .select(COLS)
    .maybeSingle();
  if (error || !data) return 'failed';
  return toRow(data as DbRow);
}

export async function deleteReveal(id: string): Promise<boolean> {
  const { error, count } = await supabase.from('marketing_reveals').delete({ count: 'exact' }).eq('id', id);
  return !error && count === 1;
}
