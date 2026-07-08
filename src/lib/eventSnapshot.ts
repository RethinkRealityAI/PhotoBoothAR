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
  const [{ fetchChallenges, fetchExperiences, fetchPosts, getWallSettings }, { listCards }] =
    await Promise.all([import('./db'), import('./cards')]);
  const [challenges, experiences, posts, wall, cards] = await Promise.all([
    fetchChallenges(meta.slug),
    fetchExperiences(meta.slug),
    fetchPosts(meta.slug, { includeHidden: true }),
    getWallSettings(meta.slug),
    listCards(meta.slug),
  ]);
  return {
    ...meta,
    postCount: posts.length,
    showChallenges: wall.showChallenges === true,
    challenges: challenges.map((c) => ({
      id: c.id, title: c.title, emoji: c.emoji, points: c.points, active: c.active,
    })),
    experiences: experiences.map((e) => ({
      id: e.id, name: e.name, kind: e.kind, published: e.is_published === true,
    })),
    cards: cards.map((k) => ({
      id: k.id, title: k.title, status: String(k.status), publicId: k.public_id,
    })),
  };
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
  return [
    `EVENT: "${s.name}" — slug ${s.slug}, uuid ${s.eventUuid}`,
    `status ${s.status} · tier ${s.planTier} · type ${s.eventType} · wall posts: ${s.postCount} · challenges feature ${s.showChallenges ? 'ON' : 'OFF'}`,
    `CHALLENGES (${s.challenges.length}):`,
    capped(s.challenges, SNAPSHOT_CAPS.challenges, (c) =>
      `- [${c.id}] ${c.emoji} ${c.title} · ${c.points} pts · ${c.active ? 'active' : 'inactive'}`),
    `EXPERIENCES (${s.experiences.length}):`,
    capped(s.experiences, SNAPSHOT_CAPS.experiences, (e) =>
      `- [${e.id}] ${e.name} (${e.kind}) · ${e.published ? 'published' : 'draft'}`),
    `CARDS (${s.cards.length}):`,
    capped(s.cards, SNAPSHOT_CAPS.cards, (k) =>
      `- [${k.id}] "${k.title}" · ${k.status} · /c/${k.publicId}`),
  ].join('\n');
}
