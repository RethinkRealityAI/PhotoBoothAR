-- 007: Greeting cards / video guestbook (Phase 5, standard tier).
--
-- Three tables:
--   cards              — one greeting card per recipient, owned by an event.
--   card_contributions — guest photo/video/text messages collected for a card.
--   card_renders       — queued/rendered keepsake films (deluxe; provider rows
--                        written by edge functions only, members read status).
--
-- Media lives in the PRIVATE 'cards' storage bucket (created in 002) under
-- `<event_slug>/<card_id>/<uuid>.<ext>`; guests write only via the
-- card-contribute edge function (signed upload URLs), and public playback URLs
-- are minted by the card-view edge function (1h signed URLs).
--
-- Idempotent + self-contained, same conventions as 001–006.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(slug) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- Public share id (viewer URL /c/<public_id>) — safe to expose once published.
  public_id uuid not null default gen_random_uuid() unique,
  -- Long-lived capability token for the contribute link. NEVER exposed to the
  -- public: see the column-level grants below.
  contribute_token uuid not null default gen_random_uuid() unique,
  title text not null,
  recipient_name text,
  recipient_email text,
  template text not null default 'storybook',
  theme jsonb not null default '{}'::jsonb,
  status text not null default 'collecting'
    check (status in ('collecting', 'published', 'rendered')),
  contribution_deadline timestamptz,
  published_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists cards_event_idx on public.cards (event_id);

create table if not exists public.card_contributions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  contributor_name text,
  message text,
  media_type text check (media_type in ('photo', 'video', 'text')),
  media_path text,
  duration_seconds numeric,
  sort_order int not null default 0,
  approved boolean not null default true,
  hidden boolean not null default false,
  session_id text,
  created_at timestamptz default now()
);
create index if not exists card_contributions_card_idx
  on public.card_contributions (card_id, sort_order, created_at);

create table if not exists public.card_renders (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'rendering', 'done', 'failed')),
  provider text not null default 'remotion_lambda',
  render_id text,
  output_path text,
  error text,
  credits_charged int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists card_renders_card_idx on public.card_renders (card_id);

alter table public.cards enable row level security;
alter table public.card_contributions enable row level security;
alter table public.card_renders enable row level security;

-- ---------------------------------------------------------------------------
-- Helper: card -> owning event slug (for membership checks in policies).
-- Security definer so policies can resolve it regardless of cards RLS.
-- ---------------------------------------------------------------------------

create or replace function public.card_event(p_card uuid)
returns text language sql stable security definer set search_path = public as $$
  select event_id from public.cards where id = p_card;
$$;

-- ---------------------------------------------------------------------------
-- cards policies
-- ---------------------------------------------------------------------------

-- Members manage their event's cards. WITH CHECK also pins org_id to the
-- event's org so a member can't stamp a card onto a foreign org (matters for
-- render billing later).
drop policy if exists cards_member_all on public.cards;
create policy cards_member_all on public.cards for all to authenticated
  using (public.is_event_member(event_id))
  with check (public.is_event_member(event_id) and org_id = public.event_org(event_id));

-- Public (viewer) SELECT of basic card metadata once published/rendered.
-- Defense-in-depth only — the card-view edge function is the real public read
-- path (it also signs media URLs). Combined with the column grants below,
-- anon clients MUST select explicit columns (select('*') is denied because
-- contribute_token/recipient_email are not granted to anon).
drop policy if exists cards_public_read on public.cards;
create policy cards_public_read on public.cards for select
  using (status in ('published', 'rendered'));

-- Column-level security: keep contribute_token (and recipient_email) away
-- from anon. NOTE: a bare `revoke select (contribute_token) ... from anon`
-- would be a NO-OP here — Postgres column revokes don't subtract from a
-- table-level SELECT grant (which Supabase's default privileges give anon).
-- So we revoke the table-level grant and re-grant the safe columns explicitly.
-- `authenticated` keeps its full table grant so member select('*') works
-- unchanged (accepted residual: a signed-in non-member could read tokens of
-- PUBLISHED cards through the public-read policy — hosts are a trusted, small
-- population and the token only allows contributing; revisit if needed with a
-- get_card_token() security-definer helper).
revoke select on public.cards from anon;
grant select (
  id, event_id, public_id, title, recipient_name, template, theme,
  status, contribution_deadline, published_at, created_at
) on public.cards to anon;

-- ---------------------------------------------------------------------------
-- card_contributions policies
-- ---------------------------------------------------------------------------
-- NO public select (playback URLs are signed by card-view) and NO anon insert
-- (card-contribute edge function is the only guest write path, service role).

drop policy if exists card_contributions_member_read on public.card_contributions;
create policy card_contributions_member_read on public.card_contributions
  for select to authenticated
  using (public.is_event_member(public.card_event(card_id)));

drop policy if exists card_contributions_member_update on public.card_contributions;
create policy card_contributions_member_update on public.card_contributions
  for update to authenticated
  using (public.is_event_member(public.card_event(card_id)))
  with check (public.is_event_member(public.card_event(card_id)));

drop policy if exists card_contributions_member_delete on public.card_contributions;
create policy card_contributions_member_delete on public.card_contributions
  for delete to authenticated
  using (public.is_event_member(public.card_event(card_id)));

-- ---------------------------------------------------------------------------
-- card_renders policies (member read; writes are service-role only)
-- ---------------------------------------------------------------------------

drop policy if exists card_renders_member_read on public.card_renders;
create policy card_renders_member_read on public.card_renders
  for select to authenticated
  using (public.is_event_member(public.card_event(card_id)));

-- ---------------------------------------------------------------------------
-- Storage: let event members preview 'cards' bucket objects in the studio
-- (signed URLs / downloads). Object paths start with the event slug, so the
-- first folder maps straight onto is_event_member. Guarded: on hosted stacks
-- where the migration role can't own storage.objects policies, skip with a
-- notice — the studio then falls back to icon placeholders (non-critical).
-- ---------------------------------------------------------------------------

do $$ begin
  drop policy if exists cards_bucket_member_read on storage.objects;
  create policy cards_bucket_member_read on storage.objects
    for select to authenticated
    using (bucket_id = 'cards' and public.is_event_member((storage.foldername(name))[1]));
exception
  when insufficient_privilege then
    raise notice 'skipping cards storage policy (insufficient privilege on storage.objects)';
end $$;
