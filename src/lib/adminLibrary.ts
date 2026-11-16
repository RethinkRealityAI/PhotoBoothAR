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
    case 'forbidden': return 'This account is not a platform admin.';
    case 'unauthorized': return 'Your session has expired. Sign in again.';
    // A dropped connection says nothing about whether the server finished, so
    // neither of these claims "nothing changed".
    case 'network': return 'The platform API could not be reached. Refresh the library to see whether it went through.';
    default: return 'The platform API returned an error. Refresh the library to check before retrying.';
  }
}
