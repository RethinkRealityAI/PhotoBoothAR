-- 020: Let /admin/users search and page on the SERVER.
--
-- `list_users` was the last admin list still shipping its whole table to the
-- browser: `auth.admin.listUsers({ page: 1, perPage: 1000 })`, then filtered and
-- paginated in JavaScript. Two problems, and the second is the bad one:
--
--   1. Past 1000 accounts the screen silently stops showing users. Not an
--      error, not a "there are more" note — the 1001st customer to sign up is
--      simply not on the page an operator is searching.
--   2. GoTrue's admin list API has NO search parameter, so "search on the
--      server" is not something the existing call can be asked for at all.
--
-- Hence this function. `auth.users` is not exposed to PostgREST (correctly — it
-- is the credential table), so a SECURITY DEFINER reader is the only way to
-- query it, exactly as `admin_user_emails` in 009_platform_admin.sql already
-- does for the audit log. It follows that function's gate verbatim: EXECUTE
-- revoked from public/anon/authenticated and granted only to service_role, so
-- the sole caller is the admin-api edge function, which asserts
-- `is_platform_admin` before its action switch.
--
-- It returns exactly the five fields the Users screen renders and nothing else
-- — no encrypted_password, no confirmation tokens, no raw app metadata. A
-- SECURITY DEFINER function over the auth schema is a place to be miserly.
--
-- Idempotent.

create or replace function public.admin_list_users(
  p_search text default '',
  p_limit  int  default 100,
  p_offset int  default 0
)
returns table(
  id              uuid,
  email           text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  banned_until    timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with t as (
    select
      btrim(coalesce(p_search, '')) as raw,
      -- `%` and `_` are ILIKE wildcards: an operator searching for "a_b" means
      -- a literal underscore, and "%" alone must not match every account on the
      -- platform. Backslash is Postgres's default LIKE escape character, so
      -- escaping it first (then the two wildcards) is enough — no ESCAPE clause.
      '%' || replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select
    u.id,
    u.email::text,        -- auth.users.email is varchar; the OUT param is text
    u.created_at,
    u.last_sign_in_at,
    u.banned_until
  from auth.users u
  left join public.profiles pr on pr.id = u.id
  cross join t
  where t.raw = ''
     or u.email ilike t.pat
     or pr.display_name ilike t.pat
     -- Org name too: the screen shows it as a column, so operators search it.
     or exists (
       select 1
       from public.org_members m
       join public.orgs o on o.id = m.org_id
       where m.user_id = u.id and o.name ilike t.pat
     )
  -- `id` breaks ties so paging is stable: two accounts created in the same
  -- millisecond could otherwise swap places between page 1 and page 2, showing
  -- one twice and hiding the other entirely.
  order by u.created_at desc, u.id desc
  -- Cap is 1000, deliberately ABOVE admin-api's own 500-row page cap: the caller
  -- asks for `limit + 1` to learn whether more rows exist, and a cap equal to
  -- that page size would clamp the sentinel away — reporting "that's everyone"
  -- at exactly a full page, which is the one lie this whole pattern exists to
  -- prevent. This cap is the backstop against an absurd argument, not the page.
  limit greatest(1, least(coalesce(p_limit, 100), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_list_users(text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, int, int) to service_role;

-- Search hits every row, so give the common orderings an index to land on.
create index if not exists profiles_display_name_idx
  on public.profiles (display_name);
