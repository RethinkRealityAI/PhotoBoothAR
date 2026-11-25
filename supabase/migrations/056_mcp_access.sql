-- 056_mcp_access.sql
--
-- Access + audit for the Beamwall MCP server (supabase/functions/beamwall-mcp),
-- the remote tool server Claude connects to for routine platform changes
-- (create/configure events, upload assets, attach looks, admin-suite actions)
-- without a code deploy.
--
-- mcp_tokens: one row per key. Only the SHA-256 of the key is stored; the key
--   itself is shown ONCE by mcp_issue_token. A key is bound to the platform
--   admin who minted it, and the edge function re-checks that person is STILL
--   a platform admin on every call, so removing an admin kills their keys.
--   Scopes: read · write · admin (admin-suite passthrough) · destructive.
-- mcp_audit: one row per tool call (reads too), with redacted args and, for
--   writes, the row BEFORE and AFTER, which is what undo_change restores from.
--
-- Access: RLS on, NO client policies. Browsers reach the four admin RPCs
-- below (each asserts is_platform_admin() first); the edge function uses the
-- service role. Every SECURITY DEFINER function is revoked from public before
-- its grant (the 022 lesson: a definer fn is otherwise exposed at /rest/v1/rpc).
--
-- Idempotent.

create table if not exists public.mcp_tokens (
  id             uuid primary key default gen_random_uuid(),
  label          text not null check (char_length(label) between 1 and 80),
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint     text not null check (char_length(token_hint) <= 16),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  scopes         text[] not null default array['read']::text[]
                   check (scopes <@ array['read','write','admin','destructive']::text[] and cardinality(scopes) >= 1),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,
  last_used_at   timestamptz,
  use_count      integer not null default 0,
  revoked_at     timestamptz
);

create table if not exists public.mcp_audit (
  id            bigint generated always as identity primary key,
  token_id      uuid references public.mcp_tokens(id) on delete set null,
  actor_user_id uuid,
  tool          text not null check (char_length(tool) <= 80),
  status        text not null check (status in ('ok', 'error', 'refused', 'dry_run')),
  event_slug    text,
  target_table  text,
  target_id     text,
  args          jsonb check (args is null or pg_column_size(args) <= 65536),
  before        jsonb check (before is null or pg_column_size(before) <= 65536),
  after         jsonb check (after is null or pg_column_size(after) <= 65536),
  error         text check (error is null or char_length(error) <= 2000),
  duration_ms   integer,
  reverted_by   bigint,
  created_at    timestamptz not null default now()
);

create index if not exists mcp_audit_token_time on public.mcp_audit (token_id, created_at desc);
create index if not exists mcp_audit_slug_time on public.mcp_audit (event_slug, created_at desc);
create index if not exists mcp_audit_time on public.mcp_audit (created_at desc);

alter table public.mcp_tokens enable row level security;
alter table public.mcp_audit  enable row level security;

-- Supabase's default privileges grant table rights to anon/authenticated; the
-- RLS above already denies them, this makes the intent explicit.
revoke all on public.mcp_tokens from anon, authenticated;
revoke all on public.mcp_audit  from anon, authenticated;

-- ── Mint a key (platform admins only; the plaintext is returned ONCE) ──────
create or replace function public.mcp_issue_token(
  p_label  text,
  p_scopes text[] default array['read','write']::text[],
  p_days   integer default 90
)
returns table (id uuid, token text, token_hint text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_token text;
  v_id    uuid;
  v_exp   timestamptz;
begin
  if v_user is null or not public.is_platform_admin(v_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_label is null or char_length(trim(p_label)) = 0 or char_length(p_label) > 80 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 365) then
    raise exception 'invalid_days' using errcode = '22023';
  end if;
  if (select count(*) from public.mcp_tokens t
        where t.owner_user_id = v_user and t.revoked_at is null) >= 20 then
    raise exception 'too_many_tokens' using errcode = '54000';
  end if;

  v_token := 'bwmcp_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_exp := case when p_days is null then null else now() + make_interval(days => p_days) end;

  insert into public.mcp_tokens (label, token_hash, token_hint, owner_user_id, scopes, expires_at)
  values (trim(p_label), encode(extensions.digest(v_token, 'sha256'), 'hex'),
          right(v_token, 4), v_user, p_scopes, v_exp)
  returning mcp_tokens.id into v_id;

  insert into public.admin_audit (actor_user_id, action, target_type, target_id, meta)
  values (v_user, 'mcp_issue_token', 'mcp_token', v_id::text,
          jsonb_build_object('label', trim(p_label), 'scopes', p_scopes, 'days', p_days));

  return query select v_id, v_token, right(v_token, 4), v_exp;
end;
$$;

create or replace function public.mcp_list_tokens()
returns table (id uuid, label text, token_hint text, owner_email text, scopes text[],
               created_at timestamptz, expires_at timestamptz, last_used_at timestamptz,
               use_count integer, revoked_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select t.id, t.label, t.token_hint, u.email::text, t.scopes, t.created_at, t.expires_at,
           t.last_used_at, t.use_count, t.revoked_at
      from public.mcp_tokens t
      left join auth.users u on u.id = t.owner_user_id
     order by t.revoked_at nulls first, t.created_at desc
     limit 200;
end;
$$;

create or replace function public.mcp_revoke_token(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_done boolean;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.mcp_tokens set revoked_at = now()
   where id = p_id and revoked_at is null;
  v_done := found;
  if v_done then
    insert into public.admin_audit (actor_user_id, action, target_type, target_id, meta)
    values (auth.uid(), 'mcp_revoke_token', 'mcp_token', p_id::text, null);
  end if;
  return v_done;
end;
$$;

create or replace function public.mcp_list_audit(p_limit integer default 50, p_before bigint default null)
returns table (id bigint, created_at timestamptz, tool text, status text, event_slug text,
               target_table text, target_id text, args jsonb, error text, duration_ms integer,
               reverted_by bigint, token_label text, actor_email text, has_snapshot boolean)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select a.id, a.created_at, a.tool, a.status, a.event_slug, a.target_table, a.target_id,
           a.args, a.error, a.duration_ms, a.reverted_by, t.label, u.email::text,
           (a.before is not null or a.after is not null)
      from public.mcp_audit a
      left join public.mcp_tokens t on t.id = a.token_id
      left join auth.users u on u.id = a.actor_user_id
     where p_before is null or a.id < p_before
     order by a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.mcp_issue_token(text, text[], integer) from public;
revoke all on function public.mcp_list_tokens() from public;
revoke all on function public.mcp_revoke_token(uuid) from public;
revoke all on function public.mcp_list_audit(integer, bigint) from public;
-- Supabase default privileges ALSO grant execute to anon directly (not via
-- public), so revoking from public alone leaves anon able to call these.
revoke all on function public.mcp_issue_token(text, text[], integer) from anon;
revoke all on function public.mcp_list_tokens() from anon;
revoke all on function public.mcp_revoke_token(uuid) from anon;
revoke all on function public.mcp_list_audit(integer, bigint) from anon;
grant execute on function public.mcp_issue_token(text, text[], integer) to authenticated;
grant execute on function public.mcp_list_tokens() to authenticated;
grant execute on function public.mcp_revoke_token(uuid) to authenticated;
grant execute on function public.mcp_list_audit(integer, bigint) to authenticated;
