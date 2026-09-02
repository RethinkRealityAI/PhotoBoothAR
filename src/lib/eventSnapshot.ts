/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Event snapshot — the compact, capped context block the Platform Copilot
 * sends with every event-aware turn so the agent "knows everything" about
 * the host's event without the server ever gaining cross-tenant reach.
 *
 * KEY FACT (verified against the live DB): challenges / experiences / cards /
 * app_settings are ALL partitioned by events.slug (text). The uuid rides
 * along for config-level operations only (events.config, ai fns).
 *
 * `formatSnapshot` is pure (node-tested); `loadEventSnapshot` composes the
 * existing RLS-scoped fetchers — it never touches the zustand store, so it
 * works anywhere in /host/** regardless of EventProvider.
 */
export interface EventSnapshotMeta {
  eventUuid: string;
  slug: string;
  name: string;
  status: string;
  planTier: string;
  eventType: string;
}

export interface EventSnapshot extends EventSnapshotMeta {
  /**
   * At least one of the five reads behind this snapshot FAILED, so the counts
   * and lists below are floors, not facts. Every one of the underlying fetchers
   * degrades a failed query to "no rows", which made a network blip
   * indistinguishable from a brand-new event — the assistant then told a
   * fully-built event it was empty, `get_stats` rendered 0·0·0·0, the
   * beam-ready checklist marked every step ○, and `normalizeActions` (which
   * builds its known-id sets from here) SILENTLY dropped every
   * update/delete/set-default proposal the model made about real rows.
   * Consumers must render a degraded state instead of the numbers.
   */
  failed: boolean;
  postCount: number;
  showChallenges: boolean;
  challenges: { id: string; title: string; emoji: string; points: number; active: boolean }[];
  experiences: { id: string; name: string; kind: string; published: boolean }[];
  cards: { id: string; title: string; status: string; publicId: string }[];
}

/** Hard caps keep the context block small on big events. */
export const SNAPSHOT_CAPS = { challenges: 20, experiences: 30, cards: 10 } as const;

/** Fetch everything the copilot needs about one event, in parallel.
 *  Lazy imports: db/cards create the supabase client at module load, which
 *  needs VITE_ env vars the vitest node env doesn't have — this keeps
 *  formatSnapshot pure and testable. */
export async function loadEventSnapshot(meta: EventSnapshotMeta): Promise<EventSnapshot> {
  // The *Result* variants, never the plain ones: those swallow the error and
  // hand back an empty list, which is the whole bug `failed` exists to stop.
  const [
    { fetchChallengesResult, fetchExperiencesResult, fetchPostsResult, getWallSettingsResult },
    { listCardsResult },
  ] = await Promise.all([import('./db'), import('./cards')]);
  const [challenges, experiences, posts, wall, cards] = await Promise.all([
    fetchChallengesResult(meta.slug),
    fetchExperiencesResult(meta.slug),
    fetchPostsResult(meta.slug, { includeHidden: true }),
    getWallSettingsResult(meta.slug),
    listCardsResult(meta.slug),
  ]);
  return {
    ...meta,
    // ANY failed read poisons the whole snapshot: a host asking "what's in my
    // event?" gets one answer, and half a truth reads exactly like a whole one.
    failed: challenges.failed || experiences.failed || posts.failed || wall.failed || cards.failed,
    postCount: posts.rows.length,
    showChallenges: wall.settings.showChallenges === true,
    challenges: challenges.rows.map((c) => ({
      id: c.id, title: c.title, emoji: c.emoji, points: c.points, active: c.active,
    })),
    experiences: experiences.rows.map((e) => ({
      id: e.id, name: e.name, kind: e.kind, published: e.is_published === true,
    })),
    cards: cards.rows.map((k) => ({
      id: k.id, title: k.title, status: String(k.status), publicId: k.public_id,
    })),
  };
}

/**
 * Make a host-authored string safe to sit inside the prompt's fenced
 * `--- CURRENT EVENT --- … --- END CURRENT EVENT ---` block: newlines and
 * carriage returns collapse to one space (so a title can never open a new
 * line), and any run of three or more hyphens becomes an em dash (so no line
 * can ever read as a fence marker). Ordinary titles pass through unchanged.
 */
export function fenceSafe(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/-{3,}/g, '—').trim();
}

function capped<T>(items: T[], cap: number, line: (t: T) => string): string {
  const shown = items.slice(0, cap).map(line);
  if (items.length > cap) shown.push(`…and ${items.length - cap} more`);
  return shown.length > 0 ? shown.join('\n') : '(none)';
}

/** Render the snapshot as the plain-text block the edge fn injects into the
 *  copilot prompt. Ids are included verbatim — the model must echo them
 *  exactly in update/delete proposals. */
export function formatSnapshot(s: EventSnapshot): string {
  const head = [
    `EVENT: "${fenceSafe(s.name)}" — slug ${s.slug}, uuid ${s.eventUuid}`,
    `status ${s.status} · tier ${s.planTier} · type ${s.eventType}`,
  ];
  // A failed read must never render as "(none)" — that is a confident claim the
  // event is empty, and the model repeats it to the host as fact.
  if (s.failed) {
    return [
      ...head,
      'CONTENTS UNAVAILABLE: the challenges / experiences / cards / wall-post reads for this event FAILED just now.',
      'You do NOT know what this event contains. Never state or imply it is empty, and never quote a count.',
      'Do NOT propose updating, deleting, or setting a default for anything by id — you have no ids.',
      'Say the details could not load, and offer to try again in a moment. Adding brand-new things is still fine.',
    ].join('\n');
  }
  return [
    ...head,
    `wall posts: ${s.postCount} · challenges feature ${s.showChallenges ? 'ON' : 'OFF'}`,
    `CHALLENGES (${s.challenges.length}):`,
    capped(s.challenges, SNAPSHOT_CAPS.challenges, (c) =>
      `- [${c.id}] ${fenceSafe(c.emoji)} ${fenceSafe(c.title)} · ${c.points} pts · ${c.active ? 'active' : 'inactive'}`),
    `EXPERIENCES (${s.experiences.length}):`,
    capped(s.experiences, SNAPSHOT_CAPS.experiences, (e) =>
      `- [${e.id}] ${fenceSafe(e.name)} (${e.kind}) · ${e.published ? 'published' : 'draft'}`),
    `CARDS (${s.cards.length}):`,
    capped(s.cards, SNAPSHOT_CAPS.cards, (k) =>
      `- [${k.id}] "${fenceSafe(k.title)}" · ${k.status} · /c/${k.publicId}`),
  ].join('\n');
}
