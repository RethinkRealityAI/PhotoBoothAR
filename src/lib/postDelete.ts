/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The guest self-delete capability: what a delete token looks like, how it is
 * compared, and which Remove affordance an entry in "My moments" has earned.
 *
 * WHY A TOKEN AT ALL. `submit-post`'s `delete_post` op used to prove ownership
 * by matching the caller's session id against `posts.session_id`. That column is
 * public: `posts_public_read` (migration 003) lets anon SELECT every approved
 * post, the wall reads `select('*')` (db.ts `fetchPostsResult`), the leaderboard
 * selects `session_id` by name, and realtime `postgres_changes` delivers the
 * whole row whatever column list the client asked for. So anyone looking at a
 * wall could read any post's session id and delete that guest's photo. Trimming
 * the SELECT list cannot fix the realtime path — the proof has to be a secret
 * that never rides on the posts row, which is `post_secrets` (migration 035).
 *
 * PURE ON PURPOSE. Nothing here imports Supabase or React: `tokensMatch` is
 * MIRRORED into supabase/functions/submit-post/index.ts (Deno cannot import from
 * src/), and postDelete.test.ts is the contract both halves are written against
 * — the same arrangement `publicObjectPath`/`objectKeyForUrl` uses in
 * mediaUrl.ts. Change one half, change the other, and let the test say so.
 */

/**
 * The only shape a delete token ever takes: a uuid, because `post_secrets.token`
 * is `uuid not null default gen_random_uuid()` and Postgres will not hand back
 * anything else. Case-insensitive — uuid equality is, and pinning to lowercase
 * here would make the client's stored copy depend on how a JSON encoder felt.
 */
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a syntactically valid delete token. */
export function isDeleteToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

/**
 * Whether a supplied token proves ownership of the post the stored one belongs
 * to.
 *
 * Constant SHAPE: both operands are validated to the same 36-character form
 * first, then every position of both is read before the answer is returned —
 * there is no early exit on the first differing character, so the time taken
 * does not describe how much of a guess was right. That matters less against a
 * 122-bit random uuid than it would against a short secret, but a comparison
 * that leaks its prefix is a habit worth not having.
 *
 * A missing, malformed or non-string operand is `false`, never a throw: the
 * server half calls this with whatever JSON the client sent.
 */
export function tokensMatch(stored: unknown, supplied: unknown): boolean {
  if (!isDeleteToken(stored) || !isDeleteToken(supplied)) return false;
  const a = stored.toLowerCase();
  const b = supplied.toLowerCase();
  // TOKEN_RE fixes both at 36 chars, so the length term is only ever 0 — it is
  // written out so the loop stays safe if the shape rule is ever widened.
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i % b.length);
  }
  return diff === 0;
}

/** One entry in a guest's gallery, reduced to what the Remove decision needs. */
export interface RemovableEntry {
  /** 'db' = a real wall post; 'local' = a capture that only exists on this device. */
  origin: 'db' | 'local';
  /** The token `finalize` handed back, as stored on this device's record. */
  deleteToken?: string | null;
}

/**
 * What removing this entry would actually do.
 *
 *   'local' — erase this device's copy; it never reached the wall.
 *   'wall'  — a server delete: off the wall, out of storage, then off the device.
 *   'none'  — no Remove control. Either the post predates `post_secrets`
 *             (migration 035) or it was posted from a different phone, so this
 *             device holds no proof of ownership. Showing a button that can only
 *             answer "that isn't yours" is worse than showing none.
 *
 * Note what 'none' costs and why it is still right: a guest's older moments —
 * anything posted before the token shipped — cannot be self-deleted any more.
 * The alternative is to keep honouring the session-id proof for those rows, and
 * that proof is readable by every person looking at the wall. A capability that
 * belongs to everyone is not a capability the owner has.
 */
export function removeKindFor(entry: RemovableEntry): 'wall' | 'local' | 'none' {
  if (entry.origin === 'local') return 'local';
  return isDeleteToken(entry.deleteToken) ? 'wall' : 'none';
}
