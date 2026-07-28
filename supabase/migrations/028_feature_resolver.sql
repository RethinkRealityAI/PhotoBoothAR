-- 028_feature_resolver.sql
-- One authority for "what may this customer do", callable from the browser AND
-- from every edge function.
--
-- WHY SQL AND NOT TYPESCRIPT: src/lib/plans.ts ENTITLEMENTS is already mirrored
-- by hand into four Deno functions (stripe-webhook, submit-post, card-publish,
-- card-render), held together by nothing but a comment in each. A TypeScript
-- resolver would have made that six copies. One SQL function is reachable from
-- both runtimes, so there is exactly one implementation of precedence and the
-- Deno constants can be deleted outright.
--
-- PRECEDENCE, highest wins:
--   -1 KILL SWITCH   feature_flags.killed AND killable  → killed_value. Beats
--                    everything, including a paid override. It is the ops valve
--                    for "Gemini is down / costing us money, turn it off now".
--    0 LEGACY        the three frozen coded events are not billed and never
--                    gated (src/lib/plans.ts LEGACY_ENTITLEMENTS: deluxe, but
--                    watermark ALWAYS on). Returns immediately.
--    1 PLAN DEFAULT  for effective_tier = higher of events.plan_tier and the
--                    org's plan_tier (an EXPIRED org plan counts as 'free').
--    2 PRO FLOOR     an active Pro subscription raises each capability to the
--                    better of its own and premium's.
--    3 ORG OVERRIDE  non-expired only.
--    4 EVENT OVERRIDE non-expired only.
--
-- TWO TRAPS THIS FILE MUST NOT GET WRONG, both copied from plans.ts:
--   * `watermark` is the one boolean whose BETTER direction is inverted — false
--     is better. The Pro floor ANDs it. Getting this backwards silently strips
--     the Beamwall signature from every Free event.
--   * For nullable numbers NULL means UNLIMITED, so greatest() is wrong: NULL
--     wins over any number.
--
-- CREDITS ARE NOT A FLAG. A flag says a capability EXISTS for this customer;
-- spend_credits says they can afford this run. Nothing resolved here may bypass
-- the credit ledger.
--
-- Idempotent.

-- Tier ordering, so "the higher of two tiers" is written once.
create or replace function public.tier_rank(p_tier text)
returns int language sql immutable set search_path = public as $$
  select case p_tier
    when 'deluxe' then 3 when 'premium' then 2 when 'essentials' then 1 else 0 end;
$$;

create or replace function public.higher_tier(a text, b text)
returns text language sql immutable set search_path = public as $$
  select case when public.tier_rank(a) >= public.tier_rank(b) then a else b end;
$$;

/** The better of two values for one flag. See the inverted-watermark trap above. */
create or replace function public.feature_better(
  p_key text, p_type text, a jsonb, b jsonb
) returns jsonb language plpgsql immutable set search_path = public as $$
begin
  if a is null then return b; end if;
  if b is null then return a; end if;
  if p_type = 'nullable_number' then
    -- NULL means unlimited, so it beats any number rather than losing to it.
    if jsonb_typeof(a) = 'null' or jsonb_typeof(b) = 'null' then return 'null'::jsonb; end if;
    return to_jsonb(greatest((a #>> '{}')::numeric, (b #>> '{}')::numeric));
  end if;
  if p_key = 'watermark' then
    -- Inverted: false is better, so both must be false to clear it.
    return to_jsonb(((a #>> '{}')::boolean) and ((b #>> '{}')::boolean));
  end if;
  return to_jsonb(((a #>> '{}')::boolean) or ((b #>> '{}')::boolean));
end $$;

-- ── The resolver ─────────────────────────────────────────────────────────────
create or replace function public.resolve_features_raw(p_org uuid, p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_slug text; v_event_tier text; v_org uuid;
  v_org_tier text; v_org_expires timestamptz;
  v_tier text; v_has_pro boolean := false;
  v_out jsonb := '{}'::jsonb;
  r record; v_val jsonb; v_tmp jsonb;
begin
  if p_event is not null then
    select e.slug, e.plan_tier, e.org_id
      into v_slug, v_event_tier, v_org
      from public.events e where e.id = p_event;
  end if;
  if v_org is null then v_org := p_org; end if;

  -- Layer 0: legacy coded events are not billed and never gated.
  if v_slug in ('hope-gala', 'jenna-jake', 'detola-wuyi') then
    for r in select * from public.feature_flags loop
      select d.value into v_tmp from public.plan_feature_defaults d
        where d.tier = 'deluxe' and d.flag_key = r.key;
      v_out := v_out || jsonb_build_object(r.key, coalesce(v_tmp, 'null'::jsonb));
    end loop;
    return v_out || jsonb_build_object('watermark', 'true'::jsonb);
  end if;

  if v_org is not null then
    select o.plan_tier, o.plan_expires_at into v_org_tier, v_org_expires
      from public.orgs o where o.id = v_org;
    -- An expired comp is not a plan. This is what stops a 30-day trial from
    -- quietly becoming a permanent free upgrade.
    if v_org_expires is not null and v_org_expires <= now() then
      v_org_tier := 'free';
    end if;
    select exists (
      select 1 from public.subscriptions s
       where s.org_id = v_org and s.status = 'active'
         and (s.current_period_end is null or s.current_period_end > now())
    ) into v_has_pro;
  end if;

  v_tier := public.higher_tier(coalesce(v_event_tier, 'free'), coalesce(v_org_tier, 'free'));

  for r in select * from public.feature_flags order by sort loop
    -- Layer 1: the plan's default.
    select d.value into v_val from public.plan_feature_defaults d
      where d.tier = v_tier and d.flag_key = r.key;
    if v_val is null then v_val := 'null'::jsonb; end if;

    -- Layer 2: Pro raises the floor to premium, per capability.
    if v_has_pro then
      select d.value into v_tmp from public.plan_feature_defaults d
        where d.tier = 'premium' and d.flag_key = r.key;
      if v_tmp is not null then
        v_val := public.feature_better(r.key, r.value_type, v_val, v_tmp);
      end if;
    end if;

    -- Layer 3: org override (an absent row means inherit, so only assign on hit).
    if v_org is not null then
      select o.value into v_tmp from public.org_feature_overrides o
        where o.org_id = v_org and o.flag_key = r.key
          and (o.expires_at is null or o.expires_at > now());
      if found and v_tmp is not null then v_val := v_tmp; end if;
    end if;

    -- Layer 4: event override, the most specific.
    if p_event is not null then
      select ev.value into v_tmp from public.event_feature_overrides ev
        where ev.event_id = p_event and ev.flag_key = r.key
          and (ev.expires_at is null or ev.expires_at > now());
      if found and v_tmp is not null then v_val := v_tmp; end if;
    end if;

    -- Layer -1: the kill switch beats every one of the above.
    if r.killed and r.killable then
      v_val := coalesce(r.killed_value, 'false'::jsonb);
    end if;

    v_out := v_out || jsonb_build_object(r.key, v_val);
  end loop;

  return v_out;
end $$;

-- service_role ONLY. A SECURITY DEFINER function is exposed at /rest/v1/rpc/
-- unless revoked — the exposure 022 had to fix after the fact.
revoke all on function public.resolve_features_raw(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_features_raw(uuid, uuid) to service_role;
revoke all on function public.feature_better(text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.tier_rank(text) from public, anon, authenticated;
revoke all on function public.higher_tier(text, text) from public, anon, authenticated;

-- ── Browser entry points, each authorizing internally ────────────────────────

/** The guest booth. Public events are readable by anyone with the link, which
 *  is exactly the existing event_is_public contract. */
create or replace function public.event_features(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_id uuid; v_org uuid;
begin
  select e.id, e.org_id into v_id, v_org from public.events e where e.slug = p_slug;
  if v_id is null then raise exception 'event_not_found' using errcode = 'P0002'; end if;
  if not (public.event_is_public(p_slug) or public.is_event_member(p_slug)) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return public.resolve_features_raw(v_org, v_id);
end $$;

revoke all on function public.event_features(text) from public;
grant execute on function public.event_features(text) to anon, authenticated, service_role;

/** /host, where there is an org but not always an event in scope. */
create or replace function public.org_features(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return public.resolve_features_raw(p_org, null);
end $$;

revoke all on function public.org_features(uuid) from public, anon;
grant execute on function public.org_features(uuid) to authenticated, service_role;

-- ── Provenance, for the admin UI ─────────────────────────────────────────────
/** Per flag: the effective value AND which layer produced it.
 *
 *  Four layers is a lot to hold in your head at 2am. Without this the admin
 *  screen could show a value but never explain it, and an operator debugging
 *  "why is this customer still on 25 photos" would be guessing. */
create or replace function public.explain_features(p_org uuid, p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_final jsonb := public.resolve_features_raw(p_org, p_event);
  v_out jsonb := '{}'::jsonb;
  r record; v_layer text; v_note text; v_tmp jsonb; v_org uuid; v_slug text;
begin
  if p_event is not null then
    select e.org_id, e.slug into v_org, v_slug from public.events e where e.id = p_event;
  end if;
  if v_org is null then v_org := p_org; end if;

  for r in select * from public.feature_flags order by sort loop
    v_layer := 'plan_default';
    v_note := null;

    if v_org is not null then
      select o.value, o.reason into v_tmp, v_note from public.org_feature_overrides o
        where o.org_id = v_org and o.flag_key = r.key
          and (o.expires_at is null or o.expires_at > now());
      if found then v_layer := 'org_override'; end if;
    end if;

    if p_event is not null then
      select ev.value, ev.reason into v_tmp, v_note from public.event_feature_overrides ev
        where ev.event_id = p_event and ev.flag_key = r.key
          and (ev.expires_at is null or ev.expires_at > now());
      if found then v_layer := 'event_override'; end if;
    end if;

    if v_slug in ('hope-gala', 'jenna-jake', 'detola-wuyi') then
      v_layer := 'legacy'; v_note := 'legacy coded event — never gated';
    end if;

    if r.killed and r.killable then
      v_layer := 'kill_switch'; v_note := r.killed_reason;
    end if;

    v_out := v_out || jsonb_build_object(r.key, jsonb_build_object(
      'value', v_final -> r.key,
      'layer', v_layer,
      'note', to_jsonb(v_note),
      'paid', to_jsonb(r.paid),
      'killable', to_jsonb(r.killable),
      'label', to_jsonb(r.label),
      'category', to_jsonb(r.category),
      'valueType', to_jsonb(r.value_type)
    ));
  end loop;
  return v_out;
end $$;

revoke all on function public.explain_features(uuid, uuid) from public, anon, authenticated;
grant execute on function public.explain_features(uuid, uuid) to service_role;
