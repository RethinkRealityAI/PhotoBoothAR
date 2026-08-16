-- 035_post_secrets.sql
-- The per-post delete token that makes a guest's "remove my photo" actually
-- theirs.
--
-- WHY THIS TABLE EXISTS — the hole it closes, in full, because the obvious
-- cheaper fixes do not work:
--
-- `submit-post`'s `delete_post` op proved ownership by matching the caller's
-- session id against `posts.session_id`. That pair is NOT a secret:
--
--   * `posts_public_read` (003_rls_hardening.sql) lets anon SELECT every
--     approved, non-hidden post of a public event, and the wall reads
--     `select('*')` (src/lib/db.ts fetchPostsResult) — every column, session_id
--     included.
--   * `fetchLeaderboard` (src/lib/db.ts) selects `session_id` by name.
--   * Realtime `postgres_changes` delivers the WHOLE ROW on insert/update no
--     matter what column list the client asked for.
--
-- So anyone who could see the wall could read any post's session_id and delete
-- that guest's photo. Narrowing the SELECT column list cannot fix it (the
-- realtime payload ignores it), and a column-level REVOKE on posts.session_id
-- would break the leaderboard and every wall read that keys "is this mine?" on
-- it. The proof therefore has to be a secret that never lives on the posts row
-- at all — which is this table.
--
-- ACCESS: RLS ON with ZERO policies. RLS-on-with-no-policy is deny-all to every
-- client role — the shape 030_landing_content.sql uses for its unreviewed draft
-- copy, and the reason 034_guest_contacts.sql needs no column-level revoke:
-- policy ABSENCE is the gate, and service_role bypasses RLS as usual. That also
-- settles realtime: `postgres_changes` only emits rows the subscriber's RLS
-- permits, and this table is deliberately never added to the `supabase_realtime`
-- publication, so there is no second path out.
--
-- No table-grant revoke is added, for 034 §intro's reason running the same way:
-- revoking the grant would silently break the first admin/service read policy
-- anyone adds later, and RLS already denies every client read today.
--
-- Idempotent and additive. Nothing reads this table except the `submit-post`
-- edge function on the service role, which is also its only writer.

-- ── The table ────────────────────────────────────────────────────────────────
-- `post_id` is the PRIMARY KEY, not just a FK: exactly one secret per post, and
-- the lookup `delete_post` performs is by post id, so the PK index is the only
-- index this table can ever need. The cascade means a post removed by ANY path
-- (guest self-delete, host delete, `events` slug cascade) takes its secret with
-- it — a token that outlived its post would be a dangling capability.
--
-- `token` is a v4 uuid from `gen_random_uuid()` (pgcrypto, already relied on by
-- 034's `unsubscribe_token` and by `posts.id` itself) — 122 bits of CSPRNG
-- entropy, unguessable and never derived from anything the client sent. It is
-- returned to the guest EXACTLY ONCE, in the `finalize` response, and stored
-- only in that device's localStorage record. It is deliberately NOT unique-
-- indexed: uniqueness would buy nothing (the lookup is by post_id) and a unique
-- violation on a random uuid can only ever be a false alarm on a hot path.
create table if not exists public.post_secrets (
  post_id    uuid primary key references public.posts(id) on delete cascade,
  token      uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.post_secrets enable row level security;

-- Intentionally NO policies. See the header: absence is the gate. If a future
-- surface needs to read this table, it goes through a service-role edge
-- function — never a client policy, because a policy a guest can satisfy is a
-- policy the wall's viewers can satisfy, which is the bug this file closes.

comment on table public.post_secrets is
  'Per-post delete capability for guest self-deletion. RLS on with zero policies: service-role only (submit-post). Never add this table to the supabase_realtime publication — the token must never reach a client that did not create the post.';
