-- 038_challenge_checks.sql
-- One row per AI photo-check verdict (validate-challenge-photo), so a host can
-- see "N checked · M passed" and the recent fail reasons per challenge, and the
-- owner can compare models by pass rate and latency — instead of guessing from
-- edge-function logs, which is all that existed before this table.
--
-- PRIVACY: NO guest identity. No session id, no IP, no image, no image hash —
-- only the verdict (pass / confidence / the one-sentence reason the guest was
-- shown), the model that judged it and the latency. The reason is MODEL output
-- about the picture, never guest input.
--
-- WRITER: only validate-challenge-photo on the service role, fire-and-forget —
-- an insert failure is logged and never reaches the guest (their answer is
-- already decided before the row is attempted).
--
-- READERS: members of the event's org, through ONE select policy. There is no
-- insert / update / delete policy for any client role, and the table grants
-- below are revoked as well: RLS-on + no-policy already denies every client
-- write, but a permissive policy added later would silently re-open the grant
-- (the 007_cards trap), so the grant is closed too. `agent_turns` (036) is
-- deliberately NOT reused: its `mode` CHECK and `user_id not null` describe a
-- signed-in host's turn, and a guest photo-check has neither.
--
-- KEYS: `event_id` is the event SLUG — `challenges.event_id` keys on the slug
-- (002_platform_tables.sql:25-28) and so does guest_contacts (034) — so
-- `is_event_member(slug)` (003_rls_hardening.sql:38) answers the read policy
-- directly. `challenge_id` is the challenge's uuid primary key (the id
-- validate-challenge-photo gates with UUID_RE). Both FKs cascade: deleting a
-- challenge or an event takes its verdicts with it (delete-event's storage
-- sweep runs first, as today).
--
-- CAP: 2000 verdicts per event per rolling 24 hours. An abuse backstop in the
-- 032 / 034 family — NOT a plan limit, and nothing in the feature resolver
-- (028) may raise it. It sits ABOVE validate-challenge-photo's own per-event
-- daily bucket (VC_DAY_MAX = 1000, guest_quota), so the function's 429 answers
-- first and this guard only ever fires if that counter is bypassed. It RAISES
-- (024's choice over 021's); the function's try/catch turns the raise into a
-- warning, so a guest never sees it.
--
-- Idempotent and additive.

-- ── 1. The table ─────────────────────────────────────────────────────────────
-- `confidence` is numeric(3,2) — the model's 0..1 score, two decimals is all
-- the comparison needs. `reason` mirrors the 240-char slice the function
-- already applies before showing it to the guest.
create table if not exists public.challenge_checks (
  id           bigint generated always as identity primary key,
  event_id     text not null references public.events(slug) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  pass         boolean not null,
  confidence   numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  reason       text not null default '' check (char_length(reason) <= 240),
  model        text not null check (char_length(model) between 1 and 60),
  latency_ms   integer not null check (latency_ms >= 0),
  created_at   timestamptz not null default now()
);

-- Per-event (the host's stats read + the cap count) and per-challenge (the
-- "recent fail reasons" list), both newest-first.
create index if not exists challenge_checks_event_time_idx
  on public.challenge_checks (event_id, created_at desc);

create index if not exists challenge_checks_challenge_time_idx
  on public.challenge_checks (challenge_id, created_at desc);

alter table public.challenge_checks enable row level security;

-- ── 2. The one client policy: members read their own event's verdicts ────────
drop policy if exists challenge_checks_member_read on public.challenge_checks;
create policy challenge_checks_member_read on public.challenge_checks
  for select to authenticated
  using (public.is_event_member(event_id));

-- No client may ever write, and anon may not read even if a policy appears.
revoke insert, update, delete on public.challenge_checks from anon, authenticated;
revoke select on public.challenge_checks from anon;

-- ── 3. Cap: 2000 verdicts per event per rolling 24 hours ─────────────────────
-- SECURITY DEFINER so the count sees every row regardless of the caller's RLS
-- view; execute revoked from every client role — only the trigger calls it.
create or replace function public.challenge_check_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  select count(*) into recent
    from public.challenge_checks
   where event_id = new.event_id
     and created_at >= now() - interval '24 hours';

  if recent >= 2000 then
    raise exception 'challenge_check_cap' using errcode = 'P0001';
  end if;

  return new;
end $$;

revoke all on function public.challenge_check_cap_guard() from public, anon, authenticated;

drop trigger if exists challenge_check_cap_trg on public.challenge_checks;
create trigger challenge_check_cap_trg
  before insert on public.challenge_checks
  for each row execute function public.challenge_check_cap_guard();
