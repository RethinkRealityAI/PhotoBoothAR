-- 051: security hardening — the 2026-11-21 launch audit (C1 C2 H2 H3 H4 H5).
--
-- NUMBERING: 050 is taken. `050_keepsake_autopilot` was applied to the live
-- database on 2026-11-21 from branch claude/project-thread-uz5qbr, which is not
-- merged into the branch this file was written on. This is therefore 051, and
-- its owner-only companion (everything that needs a statement this file is not
-- allowed to contain) is 051b_security_hardening_editor.sql.
--
-- THIS FILE IS ADDITIVE ONLY. It creates or replaces functions, creates
-- triggers, one table, one index. It removes no policy, no grant, no row.
-- Every existing row is left exactly as it is; the guards only bind writes
-- made after it is applied.
--
-- WHO COUNTS AS "A CLIENT" — the rule 040_events_plan_guard.sql states, reused
-- verbatim in every guard below (inlined rather than shared, so no new
-- callable helper appears at /rest/v1/rpc/):
--   * the PostgREST JWT `role` claim (request.jwt.claim.role, then
--     request.jwt.claims->>'role'); with no JWT at all, the session's SET ROLE;
--   * only 'anon' and 'authenticated' are clients. service_role, postgres,
--     supabase_auth_admin (GoTrue's own session — no JWT GUCs, role 'none')
--     and the SQL editor pass untouched.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- C1 — a host could set their own org's plan, owner and Stripe customer.
--   Verified live (read-only) 2026-11-21: `authenticated` and `anon` hold
--   column INSERT + UPDATE on EVERY orgs column (plan_tier, plan_expires_at,
--   plan_note, plan_source, plan_set_by, plan_set_at, stripe_customer_id,
--   owner_id). RLS is orgs_member_update (USING + CHECK is_org_member(id)) and
--   orgs_owner_insert (CHECK owner_id = auth.uid()). So
--       supabase.from('orgs').update({ plan_tier: 'deluxe' }).eq('id', myOrg)
--   made every event of that org deluxe in resolve_features_raw (028: the
--   effective tier is the higher of event and org). A writable
--   stripe_customer_id additionally let a host point their org at ANOTHER
--   customer's Stripe id: stripe-portal (index.ts:96) would open that
--   customer's billing portal, and stripe-webhook (index.ts:622) resolves an
--   unknown subscription's org BY stripe_customer_id.
--   The browser never writes orgs (grep src: zero .from('orgs') writes). The
--   writers are all service-role edge functions: create-event (INSERT name +
--   owner_id), admin-api set_org_plan (plan_*), admin-api library workshop
--   (INSERT), stripe-checkout (stripe_customer_id). None is affected.
--
-- C2 — every org INSERT minted 25 signup credits (and redeemed the owner's
--   pending promo code) with no limit on orgs per owner, so looping
--   `insert into orgs` from the browser minted credits without end.
--   Live 2026-11-21: 7 orgs, max 1 org per owner, 5 signup_bonus ledger rows,
--   0 owners with two bonuses, 0 users with two promo redemptions, 0 profiles
--   holding a pending code — so every rule below is already true of the data.
--
-- H5 — submit-post finalize can be replayed: one init + N finalizes of the
--   same uploaded object inserted N posts. Live: 112 posts, 0 duplicate
--   image_url values, so the unique index below builds cleanly.
--
-- H3 — a host could write cards.status = 'published' (and the delivery
--   columns) directly over RLS, skipping card-publish's cardsStandard check.
--   The browser writes cards in exactly two places (src/lib/cards.ts
--   createCard / updateCard) and touches only title, recipient_*, template,
--   theme, presentation, contribution_deadline (+ event_id/org_id on create).
--
-- H2 / H4 — anonymous support tickets without a session or event skipped
--   every limit in 024's guard; anonymous guest_contacts inserts had only a
--   500-per-event lifetime cap; neither card nor keepsake email had a
--   database-enforced send ceiling.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- VERIFY AFTER APPLYING (SQL editor; every probe ends in ROLLBACK, nothing
-- persists). `probe.*` settings carry ids between statements.
--
--   -- 0. triggers installed
--   select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where not t.tgisinternal and t.tgname in ('orgs_client_guard_trg', 'orgs_owner_cap_trg',
--      'profiles_promo_guard_trg', 'cards_client_guard_trg', 'email_send_cap_trg')
--    order by 1, 2;
--   -- expect 5 rows
--   select indexname from pg_indexes where indexname = 'posts_image_url_key';
--   -- expect 1 row (a NOTICE at apply time means duplicates blocked it — see §5)
--
--   -- 1. C1 refused: a host raising their own org's plan
--   begin;
--   select set_config('request.jwt.claims',
--            json_build_object('role', 'authenticated', 'sub', o.owner_id)::text, true),
--          set_config('probe.org', o.id::text, true)
--     from public.orgs o where o.owner_id is not null limit 1;
--   set local role authenticated;
--   update public.orgs set plan_tier = 'deluxe' where id = current_setting('probe.org')::uuid;
--   -- expect: ERROR:  orgs_plan_locked
--   rollback;
--   -- 1b. same, stripe_customer_id → ERROR orgs_billing_locked;
--   --     owner_id = gen_random_uuid() → ERROR orgs_owner_locked
--
--   -- 2. C1 positive control: the same host can still rename (proves probe 1
--   --    reached the row rather than being RLS-filtered)
--   begin;
--   (same two set_config lines as probe 1)
--   set local role authenticated;
--   update public.orgs set name = name where id = current_setting('probe.org')::uuid;
--   -- expect: UPDATE 1
--   rollback;
--
--   -- 3. C1 service path (admin-api set_org_plan / stripe-checkout)
--   begin;
--   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   set local role service_role;
--   update public.orgs set plan_tier = plan_tier, stripe_customer_id = stripe_customer_id
--    where id = (select id from public.orgs limit 1);
--   -- expect: UPDATE 1, no error
--   rollback;
--
--   -- 4. C1 + C2: a host-made org INSERT starts free, and gets NO second bonus
--   begin;
--   (same two set_config lines as probe 1)
--   set local role authenticated;
--   insert into public.orgs (name, owner_id, plan_tier, stripe_customer_id)
--   values ('zz-probe', (current_setting('request.jwt.claims')::jsonb ->> 'sub')::uuid,
--           'deluxe', 'cus_someone_else');
--   -- (no RETURNING: orgs_member_read is checked before the AFTER trigger
--   --  enrols the owner, so RETURNING fails RLS — a probe artifact, not a guard)
--   reset role;
--   select plan_tier, stripe_customer_id from public.orgs where name = 'zz-probe';
--   -- expect: free | (null)
--   select count(*) from public.credit_ledger l join public.orgs o on o.id = l.org_id
--    where o.name = 'zz-probe' and l.reason = 'signup_bonus';
--   -- expect: 0  (this owner already owns an org)
--   rollback;
--
--   -- 5. C2 positive control: a brand-new owner's FIRST org still gets the bonus
--   --    (service path = create-event)
--   begin;
--   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   set local role service_role;
--   insert into public.orgs (name, owner_id)
--   select 'zz-first', u.id from auth.users u
--    where not exists (select 1 from public.orgs o where o.owner_id = u.id) limit 1
--   returning id;
--   reset role;
--   select delta, ref from public.credit_ledger l join public.orgs o on o.id = l.org_id
--    where o.name = 'zz-first' and l.reason = 'signup_bonus';
--   -- expect: one row, delta = the configured bonus, ref {"owner_id": ...}
--   --         (zero rows only if every auth user already owns an org)
--   rollback;
--
--   -- 6. C2 owner cap: the 6th org for one owner is refused for EVERY writer
--   begin;
--   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   set local role service_role;
--   insert into public.orgs (name, owner_id)
--   select 'zz-cap-' || g, (select owner_id from public.orgs where owner_id is not null limit 1)
--     from generate_series(1, 5) g;
--   -- expect: ERROR:  org_owner_cap   (the owner already had 1, so the 5th new row is the 6th)
--   rollback;
--
--   -- 7. C2 promo re-arm refused; clearing still allowed
--   begin;
--   select set_config('request.jwt.claims',
--            json_build_object('role', 'authenticated', 'sub', p.id)::text, true),
--          set_config('probe.user', p.id::text, true)
--     from public.profiles p limit 1;
--   set local role authenticated;
--   update public.profiles set pending_promo_code = 'ANYCODE'
--    where id = current_setting('probe.user')::uuid;
--   -- expect: ERROR:  profiles_promo_locked
--   rollback;
--   begin;
--   (same two set_config lines)
--   set local role authenticated;
--   update public.profiles set pending_promo_code = null, display_name = display_name
--    where id = current_setting('probe.user')::uuid;
--   -- expect: UPDATE 1 (positive control)
--   rollback;
--
--   -- 8. H3 refused: a host publishing their own card over REST
--   begin;
--   select set_config('request.jwt.claims',
--            json_build_object('role', 'authenticated', 'sub', m.user_id)::text, true),
--          set_config('probe.card', c.id::text, true)
--     from public.cards c join public.org_members m on m.org_id = c.org_id
--    where c.status = 'collecting' limit 1;
--   set local role authenticated;
--   update public.cards set status = 'published' where id = current_setting('probe.card')::uuid;
--   -- expect: ERROR:  cards_status_locked
--   update public.cards set delivery_state = 'sent' where id = current_setting('probe.card')::uuid;
--   -- (run in its own begin/rollback) expect: ERROR:  cards_delivery_locked
--   rollback;
--   begin;
--   (same two set_config lines)
--   set local role authenticated;
--   update public.cards set title = title, recipient_email = recipient_email
--    where id = current_setting('probe.card')::uuid;
--   -- expect: UPDATE 1 (positive control — updateCard's columns still work)
--   rollback;
--   begin;
--   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   set local role service_role;
--   update public.cards set status = status where id = (select id from public.cards limit 1);
--   -- expect: UPDATE 1 (card-publish's path)
--   rollback;
--
--   -- 9. H5: a second post with the same image_url is refused
--   begin;
--   insert into public.posts (event_id, image_url, session_id)
--   select event_id, image_url, session_id from public.posts where image_url is not null limit 1;
--   -- expect: ERROR:  duplicate key value violates unique constraint "posts_image_url_key"
--   rollback;
--
--   -- 10. email send ceilings (service role is the only writer of the log)
--   begin;
--   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   set local role service_role;
--   insert into public.email_send_log (kind, org_id, ref)
--   select 'card', o.id, 'probe-card' from public.orgs o, generate_series(1, 6) limit 6;
--   -- expect: ERROR:  email_send_cap   (the 6th send of one card inside 24h)
--   rollback;
--   begin;
--   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   set local role service_role;
--   insert into public.email_send_log (kind, org_id, ref, recipients)
--   values ('keepsake', (select id from public.orgs limit 1), 'probe-event', 500);
--   -- expect: INSERT 0 1 (positive control — one full event's send)
--   insert into public.email_send_log (kind, org_id, ref, recipients)
--   values ('keepsake', (select id from public.orgs limit 1), 'probe-event', 501);
--   -- expect: ERROR:  email_send_cap   (500 + 501 > 1000 for the org today)
--   rollback;
--   begin;
--   set local role anon;
--   insert into public.email_send_log (kind, org_id) values ('card', gen_random_uuid());
--   -- expect: ERROR:  new row violates row-level security policy (no client policy)
--   rollback;
--
--   -- 11. H2: the anonymous no-context ticket ceiling (20/h platform-wide)
--   begin;
--   insert into public.support_tickets (source, category, subject, reporter_email)
--   select 'guest_booth', 'other', 'probe ' || g, null from generate_series(1, 21) g;
--   -- expect: ERROR:  support_rate_limited  (the 21st; 'guest_booth' / 'other'
--   --         are valid members of 023's source / category CHECK lists)
--   rollback;
--
--   -- 12. H4: the per-event hourly guest-contact ceiling (150/h)
--   begin;
--   insert into public.guest_contacts (event_id, session_id, email)
--   select (select slug from public.events where status <> 'draft' limit 1),
--          'probe-' || g, 'probe' || g || '@example.com'
--     from generate_series(1, 151) g;
--   -- expect: ERROR:  guest_contact_rate   (unless the event is within 150 of
--   --         the 500 lifetime cap, which raises guest_contact_cap first)
--   rollback;

-- ── §1 C1: orgs — plan, billing and ownership are server-owned ──────────────
-- Plain (security invoker): it reads only NEW/OLD and request settings, so it
-- needs no privilege of its own.
create or replace function public.orgs_client_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('role', true), 'none')
  );

  if v_role is null or v_role not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The only correct values for an org a host made themselves. No error:
    -- the same choice 040 made for events.plan_tier.
    new.plan_tier          := 'free';
    new.plan_expires_at    := null;
    new.plan_note          := null;
    new.plan_source        := 'default';
    new.plan_set_by        := null;
    new.plan_set_at        := null;
    new.stripe_customer_id := null;
    return new;
  end if;

  if new.plan_tier       is distinct from old.plan_tier
  or new.plan_expires_at is distinct from old.plan_expires_at
  or new.plan_note       is distinct from old.plan_note
  or new.plan_source     is distinct from old.plan_source
  or new.plan_set_by     is distinct from old.plan_set_by
  or new.plan_set_at     is distinct from old.plan_set_at then
    raise exception 'orgs_plan_locked'
      using errcode = '42501',
            hint = 'Plans change only through checkout or a platform admin.';
  end if;

  if new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'orgs_billing_locked'
      using errcode = '42501',
            hint = 'The billing customer is set by checkout only.';
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'orgs_owner_locked'
      using errcode = '42501',
            hint = 'Ownership cannot be transferred from the app.';
  end if;

  return new;
end $$;

create or replace trigger orgs_client_guard_trg
  before insert or update on public.orgs
  for each row execute function public.orgs_client_guard();

-- ── §2 C2a: at most 5 orgs per owner, for EVERY writer ──────────────────────
-- Why 5: no legitimate path makes a second org for anyone. create-event
-- (index.ts:136-165) creates one ONLY when the caller has no membership at
-- all; admin-api's library workshop (index.ts:1955-1974) reuses an org the
-- admin already owns. The live maximum is 1. Five leaves room for a platform
-- admin setting up an agency's extra brands by hand without ever letting a
-- loop get anywhere. Binds the service role too, exactly as 032 binds every
-- writer: the guard exists for the case where something upstream misbehaves.
--
-- The advisory lock serializes org creation PER OWNER until the transaction
-- ends, so two concurrent inserts cannot both count 4 — and it is what makes
-- handle_new_org's "first org?" check below race-free (READ COMMITTED gives
-- each statement in the AFTER trigger a fresh snapshot, taken after the lock).
--
-- SECURITY DEFINER because it must count orgs the caller's RLS may not show
-- (an org whose owner's membership row was later removed). A trigger function
-- cannot be called through /rest/v1/rpc/ (Postgres refuses to run it outside
-- a trigger), so it is not an exposed surface; 051b still narrows its EXECUTE
-- grant for hygiene.
create or replace function public.orgs_owner_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing int;
begin
  if new.owner_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('orgs_owner:' || new.owner_id::text, 0));

  select count(*) into existing
    from public.orgs
   where owner_id = new.owner_id;

  if existing >= 5 then
    raise exception 'org_owner_cap' using errcode = 'P0001';
  end if;

  return new;
end $$;

create or replace trigger orgs_owner_cap_trg
  before insert on public.orgs
  for each row execute function public.orgs_owner_cap_guard();

-- ── §3 C2b: the signup bonus and the signup promo, once per OWNER ───────────
-- Same body as 011's handle_new_org with two conditions added:
--   * the bonus and the promo apply only to an owner's FIRST org: no other org
--     is owned by them, AND no signup_bonus ledger row was ever stamped with
--     their id (new rows now carry ref {"owner_id": ...}, so an org later
--     re-homed by an admin still cannot earn its former owner a second bonus);
--   * a promo code is redeemed only if this USER has never redeemed it on any
--     org (redeem_promo's own uniqueness is per (promo, org), not per user).
-- A pending code is cleared whether or not it was used, so a stale or
-- re-armed code can never fire later.
-- `create or replace` keeps the function's existing ACL (live: postgres +
-- service_role only), so no grant changes.
create or replace function public.handle_new_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bonus int;
  v_code  text;
  v_first boolean;
begin
  if new.owner_id is not null then
    insert into public.org_members (org_id, user_id, role)
      values (new.id, new.owner_id, 'owner')
    on conflict do nothing;

    v_first := not exists (
        select 1 from public.orgs o
         where o.owner_id = new.owner_id and o.id <> new.id
      )
      and not exists (
        select 1 from public.credit_ledger l
         where l.reason = 'signup_bonus'
           and l.ref ->> 'owner_id' = new.owner_id::text
      );

    if v_first then
      v_bonus := coalesce((select int_value from public.platform_config
                           where key = 'signup_bonus_credits'), 25);
      if v_bonus > 0 then
        perform public.grant_credits(new.id, v_bonus, 'signup_bonus',
                                     jsonb_build_object('owner_id', new.owner_id));
      end if;
    end if;

    select pending_promo_code into v_code from public.profiles where id = new.owner_id;
    if v_code is not null and btrim(v_code) <> '' then
      if v_first and not exists (
        select 1
          from public.promo_redemptions r
          join public.promo_codes c on c.id = r.promo_id
         where r.user_id = new.owner_id
           and lower(c.code) = lower(btrim(v_code))
      ) then
        perform public.redeem_promo(new.id, v_code, new.owner_id);
      end if;
      update public.profiles set pending_promo_code = null where id = new.owner_id;
    end if;
  end if;
  return new;
end $$;

-- ── §4 C2c: a client may clear its pending promo code, never (re)set it ─────
-- The code is written at signup by handle_new_user (GoTrue's session — not a
-- client) and consumed by handle_new_org above. No browser code writes
-- profiles at all (grep src: zero .from('profiles') writes), so the only
-- client change this permits is the one handle_new_org itself makes when a
-- host's own direct org INSERT fires it: setting the code to NULL.
create or replace function public.profiles_promo_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('role', true), 'none')
  );

  if v_role is null or v_role not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.pending_promo_code is distinct from old.pending_promo_code
     and new.pending_promo_code is not null then
    raise exception 'profiles_promo_locked'
      using errcode = '42501',
            hint = 'A promo code is entered at signup.';
  end if;

  return new;
end $$;

create or replace trigger profiles_promo_guard_trg
  before update on public.profiles
  for each row execute function public.profiles_promo_guard();

-- ── §5 H5: one post per uploaded object ─────────────────────────────────────
-- submit-post finalize (supabase/functions/submit-post/index.ts) inserts
-- posts.image_url = the public URL of the object init signed, and every other
-- writer builds that URL from a fresh random name (src/lib/db.ts
-- submitPostDirect, the frozen legacy-events db.ts submitPost: `${uid()}.ext`),
-- so a second row with the same URL is only ever a replay. finalize now
-- answers that replay with the existing post (23505 → read it back).
-- Guarded: if duplicates exist at apply time the index is skipped with a
-- NOTICE instead of failing the migration (live had 0 on 2026-11-21); the
-- edge function's pre-insert lookup still dedupes in that case.
do $$
begin
  if exists (
    select 1 from public.posts
     where image_url is not null
     group by image_url having count(*) > 1
  ) then
    raise notice 'posts_image_url_key NOT created: duplicate image_url rows exist. List them with: select image_url, count(*) from public.posts where image_url is not null group by 1 having count(*) > 1;';
  else
    execute 'create unique index if not exists posts_image_url_key on public.posts (image_url) where image_url is not null';
  end if;
end $$;

-- ── §6 H3: card publish + delivery state is server-owned ────────────────────
create or replace function public.cards_client_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('role', true), 'none')
  );

  if v_role is null or v_role not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- createCard sends none of these; a new card always starts collecting,
    -- unscheduled, with tokens the database chose.
    new.status            := 'collecting';
    new.published_at      := null;
    new.deliver_at        := null;
    new.deliver_time_zone := null;
    new.delivery_state    := null;
    new.delivery_attempts := 0;
    new.delivery_retry_at := null;
    new.delivery_error    := null;
    new.delivered_at      := null;
    new.public_id         := gen_random_uuid();
    new.contribute_token  := gen_random_uuid();
    return new;
  end if;

  if new.status is distinct from old.status
  or new.published_at is distinct from old.published_at then
    raise exception 'cards_status_locked'
      using errcode = '42501',
            hint = 'Publish and unpublish through card-publish.';
  end if;

  if new.deliver_at        is distinct from old.deliver_at
  or new.deliver_time_zone is distinct from old.deliver_time_zone
  or new.delivery_state    is distinct from old.delivery_state
  or new.delivery_attempts is distinct from old.delivery_attempts
  or new.delivery_retry_at is distinct from old.delivery_retry_at
  or new.delivery_error    is distinct from old.delivery_error
  or new.delivered_at      is distinct from old.delivered_at then
    raise exception 'cards_delivery_locked'
      using errcode = '42501',
            hint = 'Schedule delivery through card-publish.';
  end if;

  if new.public_id is distinct from old.public_id
  or new.contribute_token is distinct from old.contribute_token then
    raise exception 'cards_token_locked' using errcode = '42501';
  end if;

  return new;
end $$;

create or replace trigger cards_client_guard_trg
  before insert or update on public.cards
  for each row execute function public.cards_client_guard();

-- ── §7 H3 + H4: a database ceiling on outbound email ────────────────────────
-- One row per send (card) or per run (keepsake: `recipients` = how many guests
-- that run will mail). The edge function inserts the row BEFORE it calls
-- Resend and refuses to send when the insert raises — so the ceiling holds
-- across isolates and cold starts, unlike send-keepsakes' in-memory preview
-- Map. No message content, no address: kind, org, a ref (card id / event slug
-- / 'preview'), a count, a time.
--
-- RLS on with NO policy: only the service role (which bypasses RLS) can write
-- or read it — 036_agent_turns' shape. No foreign key on org_id on purpose: an
-- abuse ledger should outlive what it recorded.
--
-- Ceilings, per rolling 24 hours:
--   card              5 sends per card (MAX_DELIVERY_ATTEMPTS is 5, so one
--                     scheduled delivery's full retry chain fits), 50 per org
--   keepsake          1000 recipients per org (two full 500-guest events, or
--                     one event sent twice)
--   keepsake_preview  20 previews per org (the arbitrary-address op)
create table if not exists public.email_send_log (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('card', 'keepsake', 'keepsake_preview')),
  org_id     uuid not null,
  ref        text check (ref is null or char_length(ref) <= 200),
  recipients int  not null default 1 check (recipients between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists email_send_log_org_kind_idx
  on public.email_send_log (org_id, kind, created_at desc);
create index if not exists email_send_log_ref_idx
  on public.email_send_log (ref, created_at desc)
  where kind = 'card';

alter table public.email_send_log enable row level security;

-- Plain (security invoker): its only writer is the service role, which sees
-- every row. The per-org advisory lock makes two concurrent reservations
-- count each other.
create or replace function public.email_send_cap_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  used int;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('email_send:' || new.kind || ':' || new.org_id::text, 0));

  if new.kind = 'card' then
    select count(*) into used
      from public.email_send_log
     where kind = 'card' and ref = new.ref
       and created_at > now() - interval '24 hours';
    if used >= 5 then
      raise exception 'email_send_cap' using errcode = 'P0001', detail = 'card_daily';
    end if;
    select count(*) into used
      from public.email_send_log
     where kind = 'card' and org_id = new.org_id
       and created_at > now() - interval '24 hours';
    if used >= 50 then
      raise exception 'email_send_cap' using errcode = 'P0001', detail = 'org_card_daily';
    end if;

  elsif new.kind = 'keepsake' then
    select coalesce(sum(recipients), 0) into used
      from public.email_send_log
     where kind = 'keepsake' and org_id = new.org_id
       and created_at > now() - interval '24 hours';
    if used + new.recipients > 1000 then
      raise exception 'email_send_cap' using errcode = 'P0001', detail = 'org_keepsake_daily';
    end if;

  elsif new.kind = 'keepsake_preview' then
    select count(*) into used
      from public.email_send_log
     where kind = 'keepsake_preview' and org_id = new.org_id
       and created_at > now() - interval '24 hours';
    if used >= 20 then
      raise exception 'email_send_cap' using errcode = 'P0001', detail = 'org_preview_daily';
    end if;
  end if;

  return new;
end $$;

create or replace trigger email_send_cap_trg
  before insert on public.email_send_log
  for each row execute function public.email_send_cap_guard();

-- ── §8 H4: guest contacts — add an hourly ceiling per event ─────────────────
-- 034's lifetime cap (500/event) is kept byte-for-byte; added: at most 150 new
-- contacts per event per hour. A 300-guest wedding opting in at the send-off
-- screen spreads over hours; a script filling an event with strangers'
-- addresses now needs most of a day per event. This bounds the INSERT side;
-- §7's keepsake ceiling bounds what any filled list can be used to send, and
-- double opt-in (a confirmation link before a contact is mailable) is the real
-- fix — a follow-up, written up in the audit report.
-- `create or replace` keeps the live ACL (postgres + service_role).
create or replace function public.guest_contact_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing int;
begin
  select count(*) into existing
    from public.guest_contacts
   where event_id = new.event_id;

  if existing >= 500 then
    raise exception 'guest_contact_cap' using errcode = 'P0001';
  end if;

  select count(*) into existing
    from public.guest_contacts
   where event_id = new.event_id
     and created_at > now() - interval '1 hour';

  if existing >= 150 then
    raise exception 'guest_contact_rate' using errcode = 'P0001';
  end if;

  return new;
end $$;

-- ── §9 H2: anonymous support tickets — no path around the guard ─────────────
-- 024's per-device (3/h) and per-event (20/h) rules are kept byte-for-byte.
-- Added for ANONYMOUS tickets:
--   * a ticket with neither a session nor an event slug — the shape that
--     skipped every 024 rule — is capped at 20/h platform-wide;
--   * a reporter address can open at most 3 anonymous tickets an hour;
--   * all anonymous tickets together: 100/h platform-wide, so rotating
--     sessions across many events still has a ceiling (the operator notify
--     email fires once per ticket).
-- And for SIGNED-IN tickets: 024 capped only those carrying an org, so an
-- account that never joined one was unlimited — it now gets 20/h on its own
-- created_by. support-api, separately, stops acknowledging guest addresses.
-- Rides support_tickets_session_created_idx / _slug_created_idx (024) for the
-- old rules; the new ones scan an hour of a small table.
-- `create or replace` keeps the live ACL (postgres + service_role).
create or replace function public.support_rate_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  if new.created_by is null then
    if new.session_id is not null and new.session_id <> '' then
      select count(*) into recent
        from public.support_tickets
       where session_id = new.session_id
         and created_at > now() - interval '1 hour';
      if recent >= 3 then
        raise exception 'support_rate_limited' using errcode = 'P0001';
      end if;
    end if;

    if new.event_slug is not null and new.event_slug <> '' then
      select count(*) into recent
        from public.support_tickets
       where event_slug = new.event_slug
         and created_by is null
         and created_at > now() - interval '1 hour';
      if recent >= 20 then
        raise exception 'support_rate_limited' using errcode = 'P0001';
      end if;
    end if;

    if coalesce(new.session_id, '') = '' and coalesce(new.event_slug, '') = '' then
      select count(*) into recent
        from public.support_tickets
       where created_by is null
         and coalesce(session_id, '') = ''
         and coalesce(event_slug, '') = ''
         and created_at > now() - interval '1 hour';
      if recent >= 20 then
        raise exception 'support_rate_limited' using errcode = 'P0001';
      end if;
    end if;

    if new.reporter_email is not null and new.reporter_email <> '' then
      select count(*) into recent
        from public.support_tickets
       where created_by is null
         and lower(reporter_email) = lower(new.reporter_email)
         and created_at > now() - interval '1 hour';
      if recent >= 3 then
        raise exception 'support_rate_limited' using errcode = 'P0001';
      end if;
    end if;

    select count(*) into recent
      from public.support_tickets
     where created_by is null
       and created_at > now() - interval '1 hour';
    if recent >= 100 then
      raise exception 'support_rate_limited' using errcode = 'P0001';
    end if;
  else
    if new.org_id is not null then
      select count(*) into recent
        from public.support_tickets
       where org_id = new.org_id
         and created_at > now() - interval '1 hour';
      if recent >= 20 then
        raise exception 'support_rate_limited' using errcode = 'P0001';
      end if;
    end if;

    -- A signed-in account with no org (signed up, never created an event)
    -- matched no 024 rule at all; it gets the same ceiling, keyed on itself.
    select count(*) into recent
      from public.support_tickets
     where created_by = new.created_by
       and created_at > now() - interval '1 hour';
    if recent >= 20 then
      raise exception 'support_rate_limited' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;
