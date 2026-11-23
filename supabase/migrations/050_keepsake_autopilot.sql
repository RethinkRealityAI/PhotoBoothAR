-- 050_keepsake_autopilot.sql
-- The next-day keepsake: the morning after an event, every guest who opted in
-- at the booth gets the album email automatically, with a short film of the
-- night when the event has one. Before this the only path was a host pressing
-- "Send keepsakes" in Share & Print, and the film existed only for greeting
-- cards (card-render, disabled by default).
--
-- TWO PIECES:
--
--   1. events.ended_at — WHEN the host ended it. `status` stays the authority
--      for WHETHER it ended (031's rule); this column only answers "how long
--      ago", which the next-morning schedule needs and nothing recorded before.
--      Kept by a trigger rather than by every writer (EventsList, admin-api,
--      manager-api, the copilot's go_live path all write `status`), so no
--      writer can forget it. Back to 'live' clears it: a reopened event is not
--      over.
--
--   2. keepsake_runs — one row per event the autopilot has picked up. The row
--      IS the claim (primary key on the event), so two overlapping worker runs
--      cannot both render or both email the same event: the second insert
--      conflicts and is skipped. WRITER: send-keepsakes on the service role,
--      only. READERS: anyone, but only the four columns a public album page
--      needs to play the film, and only once the film is ready — the recap
--      page (/r/:slug) is public and so are the event's photos (posts bucket),
--      so the film beside them discloses nothing new. Run stats and error text
--      stay service-role only via column grants.
--
-- The film itself lives in the PUBLIC posts bucket under the event's own
-- prefix (<slug>/_film/…), so delete-event's prefix sweep and any future
-- retention purge take it with the photos it was made from.
--
-- Idempotent and additive.

-- ── 1. events.ended_at + the trigger that keeps it ───────────────────────────
alter table public.events add column if not exists ended_at timestamptz;

create or replace function public.events_stamp_ended_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('ended', 'archived') then
    -- First time it stops being live: stamp. Archiving an already-ended event
    -- keeps the original end time.
    if new.ended_at is null then
      new.ended_at := now();
    end if;
  elsif new.status = 'live' then
    new.ended_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.events_stamp_ended_at() from public, anon, authenticated;

drop trigger if exists events_stamp_ended_at on public.events;
create trigger events_stamp_ended_at
  before insert or update of status on public.events
  for each row execute function public.events_stamp_ended_at();

-- ── 2. keepsake_runs ─────────────────────────────────────────────────────────
create table if not exists public.keepsake_runs (
  event_id     text primary key references public.events(slug) on delete cascade,
  status       text not null default 'claimed'
                 check (status in ('claimed', 'done', 'failed')),
  film_status  text not null default 'pending'
                 check (film_status in ('pending', 'ready', 'failed', 'skipped')),
  film_path    text check (film_path is null or char_length(film_path) <= 300),
  poster_path  text check (poster_path is null or char_length(poster_path) <= 300),
  attempts     integer not null default 1 check (attempts >= 0),
  claimed_at   timestamptz not null default now(),
  finished_at  timestamptz,
  sent         integer not null default 0 check (sent >= 0),
  failed       integer not null default 0 check (failed >= 0),
  error        text check (error is null or char_length(error) <= 500),
  created_at   timestamptz not null default now()
);

alter table public.keepsake_runs enable row level security;

-- The one client policy: a ready film is public, like the album it sits in.
drop policy if exists keepsake_runs_public_film on public.keepsake_runs;
create policy keepsake_runs_public_film on public.keepsake_runs
  for select to anon, authenticated
  using (film_status = 'ready');

-- No client writes, ever; and clients read only the film columns.
revoke all on public.keepsake_runs from anon, authenticated;
grant select (event_id, film_status, film_path, poster_path)
  on public.keepsake_runs to anon, authenticated;
