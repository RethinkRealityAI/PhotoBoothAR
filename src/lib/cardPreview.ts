/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cardPreview — the host's full-screen preview, as PURE data plumbing.
 *
 * The public viewer gets its data from the card-view edge function, which only
 * serves PUBLISHED cards. A host previewing a card that is still collecting has
 * no such endpoint, so the preview assembles the same CardViewData /
 * CardViewContribution shapes from the host's own member-RLS rows. The rules
 * below are card-view's, mirrored, so the preview shows exactly what the
 * recipient will get:
 *   - only approved && !hidden contributions,
 *   - ordered by sort_order, then created_at,
 *   - photo/video carry a signed url (null when signing failed), text has none.
 *
 * Also the presentation merge the pickers write through, so a single tap and
 * the preview's "Use these" can never disagree about the stored shape.
 *
 * Type-only imports from lib/cards.ts: they are erased at compile time, so
 * this module never reaches the Supabase client and tests under vitest's node
 * env.
 */
import type {
  CardRow,
  CardViewContribution,
  CardViewData,
  ContributionMediaType,
  ContributionRow,
} from './cards';
import {
  normalizeCardPresentation,
  type CardPresentation,
  type CardViewOverrides,
} from './cardPresentation';

/** card-view's visibility rule. */
export function visibleContributions(rows: readonly ContributionRow[]): ContributionRow[] {
  return rows
    .filter((r) => r.approved === true && r.hidden !== true)
    .slice()
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    });
}

/** The storage paths the preview has to sign (text contributions have none). */
export function previewMediaPaths(rows: readonly ContributionRow[]): string[] {
  return visibleContributions(rows)
    .map((r) => r.media_path)
    .filter((p): p is string => typeof p === 'string' && p !== '');
}

const MEDIA_TYPES: readonly ContributionMediaType[] = ['photo', 'video', 'text'];

function mediaTypeOf(row: ContributionRow): ContributionMediaType {
  if (row.media_type !== null && MEDIA_TYPES.includes(row.media_type)) return row.media_type;
  // A row without a media type but with a path predates the column's strict
  // values; without either it can only be a note.
  return row.media_path ? 'photo' : 'text';
}

export interface CardPreviewInput {
  card: Pick<CardRow, 'title' | 'recipient_name' | 'template' | 'theme' | 'published_at' | 'presentation'>;
  rows: readonly ContributionRow[];
  /** path → signed URL (signContributionUrls). A missing path → url null. */
  urls: ReadonlyMap<string, string>;
  eventName: string | null;
}

export interface CardPreviewData {
  card: CardViewData;
  contributions: CardViewContribution[];
}

/** The host's rows → exactly what card-view would have returned. */
export function buildCardPreview(input: CardPreviewInput): CardPreviewData {
  const { card, rows, urls, eventName } = input;
  return {
    card: {
      title: card.title,
      recipientName: card.recipient_name,
      template: card.template,
      theme: card.theme ?? {},
      presentation: card.presentation ?? {},
      publishedAt: card.published_at,
      eventName,
      // The film is a published-card artefact the host already has in the
      // studio; the preview is about the arrival, so it is left out.
      filmUrl: null,
    },
    contributions: visibleContributions(rows).map((r) => ({
      id: r.id,
      contributorName: r.contributor_name,
      message: r.message,
      mediaType: mediaTypeOf(r),
      durationSeconds: r.duration_seconds,
      url: r.media_path ? (urls.get(r.media_path) ?? null) : null,
      sortOrder: r.sort_order,
    })),
  };
}

/** One picker's change, applied onto whatever is stored. Always a full,
 *  normalised presentation — the shape migration 049's CHECK expects. */
export function mergePresentation(
  stored: unknown,
  patch: Partial<Pick<CardPresentation, 'reveal' | 'email' | 'look'>>,
): CardPresentation {
  return normalizeCardPresentation({ ...normalizeCardPresentation(stored), ...patch });
}

/** The preview's unsaved picks, in the shape CardExperience reads. */
export interface PreviewPicks {
  reveal: CardPresentation['reveal'];
  look: CardPresentation['look'];
  template: string;
}

export function picksFrom(card: Pick<CardRow, 'presentation' | 'template'>): PreviewPicks {
  const p = normalizeCardPresentation(card.presentation);
  return { reveal: p.reveal, look: p.look, template: card.template };
}

export function picksToOverrides(picks: PreviewPicks): CardViewOverrides {
  return { reveal: picks.reveal, look: picks.look, template: picks.template };
}

/** True when "Use these" would change something. */
export function picksDiffer(card: Pick<CardRow, 'presentation' | 'template'>, picks: PreviewPicks): boolean {
  const saved = picksFrom(card);
  return saved.reveal !== picks.reveal || saved.look !== picks.look || saved.template !== picks.template;
}
