/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client for admin-api's shared-library actions (see the header of
 * supabase/functions/admin-api/index.ts). Same `adminApi` envelope as every
 * other admin screen: `{ data, error }`, where `error` is the function's own
 * code ('invalid_tags', 'has_links', 'copy_failed', …) or 'network'.
 */
import { adminApi, type AdminResult } from './admin';
import type { LibraryState, LibraryTags, StateChangeTarget } from './libraryPublish';
import type { ExperienceKind } from '../types';
import type { Classification, ImportMeta } from './libraryImport';
import type { LibraryCategory } from './libraryTaxonomy';

export interface LibraryItemRow {
  id: string;
  name: string;
  kind: ExperienceKind;
  source: string | null;
  assetUrl: string | null;
  thumbnailUrl: string | null;
  state: LibraryState;
  version: number;
  tags: LibraryTags;
  sourceExperienceId: string | null;
  publishedAt: string;
  sortOrder: number;
  linkCount: number;
  /** Migration 045. Absent from an admin-api older than the CMS -> treated as none. */
  categoryId?: string | null;
  keywords?: string[];
  /** config.library.collection, e.g. 'christmas'. */
  collection?: string | null;
  createdAt?: string;
  /** A .glb the viewer can open (a prop's own, or a scene's first 3D layer). */
  modelUrl?: string | null;
}

export interface LibraryList {
  items: LibraryItemRow[];
  total: number;
  /** True when link counting stopped early — counts are then lower bounds. */
  linkCountsCapped: boolean;
}

export function fetchLibraryItems(): Promise<AdminResult<LibraryList>> {
  return adminApi<LibraryList>('list_library_items');
}

export interface PublishResult {
  id: string;
  version: number;
  files: number;
  /** Older versions of the same scene that this publish retired. */
  retired: string[];
  retireFailed: string[];
}

export function publishLibraryItem(args: {
  experienceId: string;
  name: string;
  tags: LibraryTags;
  listed?: boolean;
  /** Omitted = the previous version's shelf (or none). null = uncategorised. */
  categoryId?: string | null;
  keywords?: string[];
  /** A picture staged under _platform/library/_pictures/ for a piece that has none. */
  thumbnailUrl?: string;
}): Promise<AdminResult<PublishResult>> {
  return adminApi<PublishResult>('publish_library_item', { ...args });
}

export function updateLibraryItemMeta(args: {
  id: string;
  name?: string;
  tags?: LibraryTags;
  sortOrder?: number;
}): Promise<AdminResult<{ id: string }>> {
  return adminApi<{ id: string }>('update_library_item_meta', { ...args });
}

export function setLibraryItemState(
  id: string,
  state: StateChangeTarget,
): Promise<AdminResult<{ id: string; state: StateChangeTarget; linkCount: number }>> {
  return adminApi('set_library_item_state', { id, state });
}

/* ── Bulk 3D import drafts (/admin/library/import) ─────────────────────── */

export interface LibraryDraftRow {
  id: string;
  name: string;
  assetUrl: string;
  thumbnailUrl: string | null;
  config: Record<string, unknown>;
  tags: LibraryTags;
  importMeta: ImportMeta;
  createdAt: string;
  categoryId?: string | null;
  keywords?: string[];
}

export function fetchLibraryDrafts(): Promise<AdminResult<{ drafts: LibraryDraftRow[]; total: number }>> {
  return adminApi('list_library_drafts');
}

export interface DraftCreateItem {
  id: string;
  name: string;
  assetUrl: string;
  thumbnailUrl: string;
  config: Record<string, unknown>;
  tags: LibraryTags;
  importMeta: ImportMeta;
}

type BatchFailure = { id: string; error: string };

export function createLibraryDrafts(items: DraftCreateItem[]): Promise<AdminResult<{ created: string[]; failed: BatchFailure[] }>> {
  return adminApi('create_library_drafts', { items });
}

export function updateLibraryDraft(args: {
  id: string;
  name?: string;
  tags?: LibraryTags;
  config?: Record<string, unknown>;
  importMeta?: ImportMeta;
  /** Point the draft at another model in its own folder (the optimizer's
   *  "Use optimized"); `config` must then name the same URL. */
  assetUrl?: string;
}): Promise<AdminResult<{ id: string }>> {
  return adminApi('update_library_draft', { ...args });
}

export type ClassifyResult =
  | { id: string; ok: true; classification: Classification; error?: undefined }
  | { id: string; ok: false; error: string; classification?: undefined };

export function classifyLibraryDrafts(ids: string[]): Promise<AdminResult<{ results: ClassifyResult[] }>> {
  return adminApi('classify_library_drafts', { ids });
}

export function publishLibraryDrafts(ids: string[]): Promise<AdminResult<{ published: string[]; failed: BatchFailure[] }>> {
  return adminApi('publish_library_drafts', { ids });
}

export function discardLibraryDrafts(ids: string[]): Promise<AdminResult<{ discarded: string[]; filesFailed: string[] }>> {
  return adminApi('discard_library_drafts', { ids });
}

/* ── Taxonomy: categories + keywords (migration 045) ──────────────────── */

export function fetchLibraryCategories(): Promise<AdminResult<{ categories: LibraryCategory[] }>> {
  return adminApi('list_library_categories');
}

export function saveLibraryCategory(args: {
  id?: string;
  name: string;
  description?: string;
  parentId?: string | null;
  sortOrder?: number;
}): Promise<AdminResult<{ category: LibraryCategory }>> {
  return adminApi('save_library_category', { ...args });
}

export function deleteLibraryCategory(id: string): Promise<AdminResult<{ id: string; movedTo: string | null; moved: number }>> {
  return adminApi('delete_library_category', { id });
}

export interface BulkLibraryEdit {
  /** Omitted = keep; null = uncategorised. */
  categoryId?: string | null;
  addKeywords?: string[];
  removeKeywords?: string[];
  addTags?: Partial<LibraryTags>;
  removeTags?: Partial<LibraryTags>;
}

export function bulkUpdateLibraryItems(
  ids: string[], edit: BulkLibraryEdit,
): Promise<AdminResult<{ updated: string[]; failed: BatchFailure[] }>> {
  return adminApi('bulk_update_library_items', { ids, ...edit });
}

export interface EventModelRow {
  id: string;
  name: string;
  kind: ExperienceKind;
  assetUrl: string | null;
  thumbnailUrl: string | null;
  /** Only `layers[{kind, asset_url}]` — enough for the picture fallback. */
  config: { layers: Array<{ kind: string; asset_url: string | null }> };
  prompt: string | null;
  eventSlug: string;
  eventName: string;
  eventArchived: boolean;
  createdAt: string;
  inLibrary: boolean;
}

export function fetchEventModels(): Promise<AdminResult<{ models: EventModelRow[]; total: number }>> {
  return adminApi('list_event_models');
}

/** Operator-facing copy for the codes these actions return. */
export function libraryErrorText(code: string): string {
  switch (code) {
    case 'invalid_name': return 'Give it a name (up to 80 characters).';
    case 'invalid_tags': return 'One of the tags is not in the library vocabulary.';
    case 'not_event_owned': return 'Only a scene saved in an event can be published.';
    case 'thumbnail_required': return '3D and layered scenes need a thumbnail first — add one in the Studio and save.';
    case 'too_many_files': return 'This scene uses too many files to publish.';
    case 'copy_failed': return 'Copying the scene’s files failed, so nothing was published.';
    case 'not_found': return 'That item no longer exists.';
    case 'same_state': return 'It is already in that state.';
    case 'has_links': return 'Events still use it, so it cannot be deleted. Retire or withdraw it instead.';
    case 'unlist_first': return 'Retire or withdraw it before deleting.';
    case 'unknown_action': return 'The server does not have this yet — the admin-api update still needs deploying.';
    case 'is_draft': return 'That item is still a draft. Publish or discard it from Bulk import.';
    case 'invalid_asset': return 'The uploaded file is not where the import expected it. Try importing it again.';
    case 'invalid_config': return 'The model’s placement data was rejected. Try importing it again.';
    case 'already_exists': return 'It was already imported.';
    case 'insert_failed': case 'update_failed': return 'The database refused the change. Try again.';
    case 'thumbnail_unreadable': return 'Its thumbnail could not be read, so the AI could not look at it.';
    case 'ai_not_configured': return 'AI labelling is not set up (no Gemini key on the server). Label these by hand.';
    case 'ai_key_invalid': return 'The Gemini key was rejected. Label these by hand, or fix the key.';
    case 'ai_quota': return 'The AI is rate-limited right now. Wait a minute and try again.';
    case 'ai_unavailable': return 'The AI did not answer for this one. Try again, or label it by hand.';
    case 'invalid_category': return 'That category no longer exists. Refresh and pick another.';
    case 'invalid_keywords': return 'Keywords are letters and numbers, up to 32 characters each and 24 per item.';
    case 'invalid_thumbnail': return 'The picture was not uploaded where the library expected it. Try again.';
    case 'category_too_deep': return 'Categories go two levels deep: a subcategory cannot have its own subcategories.';
    case 'category_has_children': return 'It has subcategories. Move or delete those first.';
    case 'slug_taken': return 'A category with that name already exists.';
    case 'slug_immutable': return 'A category’s web name cannot change after it is made.';
    case 'too_many_categories': return 'That is the most categories the library holds (300).';
    case 'forbidden': return 'This account is not a platform admin.';
    case 'unauthorized': return 'Your session has expired. Sign in again.';
    // A dropped connection says nothing about whether the server finished, so
    // neither of these claims "nothing changed".
    case 'network': return 'The platform API could not be reached. Refresh the library to see whether it went through.';
    default: return 'The platform API returned an error. Refresh the library to check before retrying.';
  }
}
