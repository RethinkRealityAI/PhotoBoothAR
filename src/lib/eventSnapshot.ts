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
import type { HostEventRow } from './host';
import { formatBrief, isEmptyBrief, normalizeBrief, type EventBrief } from './eventBrief';
import { challengeNeedsCheck } from './challengeValidation';

export interface EventSnapshotMeta {
  eventUuid: string;
  slug: string;
  name: string;
  status: string;
  planTier: string;
  eventType: string;
  /** events.starts_at as a local YYYY-MM-DD; null = no date; absent = not read. */
  startsAt?: string | null;
  /** events.config.brief (see eventBrief.ts); null/absent = none. */
  brief?: EventBrief | null;
  /** events.config.copy — the template tagline and the generated-copy stamp
   *  (idempotency for generateEventCopy). null/absent = not read. */
  copy?: { tagline: string | null; generatedAt: string | null } | null;
}

/**
 * The snapshot meta from a HostEventRow (fetchMyEvents / createEvent), so the
 * four screens that build one agree on every field. `statusOverride` covers
 * the go-live flip the caller already knows about before a re-fetch.
 */
export function snapshotMetaFromRow(row: HostEventRow, statusOverride?: string): EventSnapshotMeta {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const copyRaw = (config.copy !== null && typeof config.copy === 'object' ? config.copy : {}) as Record<string, unknown>;
  const brief = config.brief !== null && config.brief !== undefined ? normalizeBrief(config.brief) : null;
  return {
    eventUuid: row.id,
    slug: row.slug,
    name: row.name,
    status: statusOverride ?? row.status,
    planTier: row.plan_tier,
    eventType: row.event_type,
    startsAt: localDateOf(row.starts_at),
    brief: brief !== null && !isEmptyBrief(brief) ? brief : null,
    copy: {
      tagline: typeof copyRaw.tagline === 'string' && copyRaw.tagline.trim() ? copyRaw.tagline.trim() : null,
      generatedAt: typeof copyRaw.generatedAt === 'string' && copyRaw.generatedAt.trim() ? copyRaw.generatedAt.trim() : null,
    },
  };
}

/** starts_at (written by updateEventDate as LOCAL midnight → ISO) back to the
 *  local calendar day. Read in local time because it was written in local
 *  time: '2026-07-12' in UTC+1 is stored as 2026-07-11T23:00Z, and a UTC
 *  slice would hand the model the 11th. Unparseable → null. */
function localDateOf(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  /** wall.settings.defaultExperienceId — what the booth opens with; null =
   *  none pinned; absent = not read (older callers / fixtures). */
  defaultExperienceId?: string | null;
  /** `hasCheck` = an AI photo-check is enabled on the challenge (absent = unknown). */
  challenges: { id: string; title: string; emoji: string; points: number; active: boolean; hasCheck?: boolean }[];
  experiences: { id: string; name: string; kind: string; published: boolean }[];
  cards: { id: string; title: string; status: string; publicId: string }[];
}

/** Hard caps keep the context block small on big events. */
export const SNAPSHOT_CAPS = { challenges: 20, experiences: 30, cards: 10 } as const;

/** The rendered block is cut to this, on a line boundary (see sliceAtLine).
 *  ai-event-designer answers 400 invalid_body above its MAX_CONTEXT_CHARS
 *  (8000) — one over-long event would otherwise take the whole copilot
 *  offline. MEASURED at every cap (20 challenges with AI checks, 30
 *  experiences, 10 cards, a 600-char brief, 36-char uuids): 7788 chars with
 *  30-char experience/card names, 8188 with 40-char names — so the cut is
 *  real on a maxed-out event, which is why the BRIEF renders BEFORE the lists
 *  and the cut lands in the tail of CARDS. */
export const MAX_SNAPSHOT_CHARS = 8000;

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
    defaultExperienceId: typeof wall.settings.defaultExperienceId === 'string' && wall.settings.defaultExperienceId
      ? wall.settings.defaultExperienceId : null,
    challenges: challenges.rows.map((c) => ({
      id: c.id, title: c.title, emoji: c.emoji, points: c.points, active: c.active, hasCheck: challengeNeedsCheck(c),
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

const TRUNCATED_MARK = '…(truncated)';

/** Cut to `max` on a LINE boundary, then mark it. A mid-line cut could leave
 *  half a uuid, and the model echoes ids verbatim into update/delete
 *  proposals — a whole line dropped is a row the model does not know about,
 *  which normalizeActions already handles (unknown_id). */
function sliceAtLine(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n', max - TRUNCATED_MARK.length - 1);
  return `${cut > 0 ? text.slice(0, cut) : ''}\n${TRUNCATED_MARK}`;
}

/** Render the snapshot as the plain-text block the edge fn injects into the
 *  copilot prompt. Ids are included verbatim — the model must echo them
 *  exactly in update/delete proposals. */
export function formatSnapshot(s: EventSnapshot): string {
  const head = [
    `EVENT: "${fenceSafe(s.name)}" — slug ${s.slug}, uuid ${s.eventUuid}`,
    `status ${s.status} · tier ${s.planTier} · type ${s.eventType}`,
  ];
  // Only when the caller READ these (undefined = an older caller or fixture):
  // a known-empty value renders as "not set" so the model can offer to fix it,
  // an unread one renders nothing rather than a false "not set".
  if (s.startsAt !== undefined || s.defaultExperienceId !== undefined) {
    head.push(`date ${s.startsAt ?? 'not set'} · booth default ${s.defaultExperienceId ? `[${s.defaultExperienceId}]` : 'none'}`);
  }
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
  const brief = formatBrief(s.brief);
  return sliceAtLine([
    ...head,
    `wall posts: ${s.postCount} · challenges feature ${s.showChallenges ? 'ON' : 'OFF'}`,
    // The host's brief BEFORE the capped lists: it is what the model must
    // honour (palette, tone, avoid) and name honorees from, it is already
    // fence-safe, and a maxed-out event's cut must land in CARDS, never here.
    ...(brief ? [brief] : []),
    `CHALLENGES (${s.challenges.length}):`,
    capped(s.challenges, SNAPSHOT_CAPS.challenges, (c) =>
      `- [${c.id}] ${fenceSafe(c.emoji)} ${fenceSafe(c.title)} · ${c.points} pts · ${c.active ? 'active' : 'inactive'}${c.hasCheck === true ? ' · AI check' : ''}`),
    `EXPERIENCES (${s.experiences.length}):`,
    capped(s.experiences, SNAPSHOT_CAPS.experiences, (e) =>
      `- [${e.id}] ${fenceSafe(e.name)} (${e.kind}) · ${e.published ? 'published' : 'draft'}`),
    `CARDS (${s.cards.length}):`,
    capped(s.cards, SNAPSHOT_CAPS.cards, (k) =>
      `- [${k.id}] "${fenceSafe(k.title)}" · ${k.status} · /c/${k.publicId}`),
  ].join('\n'), MAX_SNAPSHOT_CHARS);
}
