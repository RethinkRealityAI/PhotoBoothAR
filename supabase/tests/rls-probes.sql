-- RLS probe suite — run via Supabase SQL editor / MCP execute_sql after
-- migration 003. Everything runs in one transaction and rolls back; the only
-- output is the probe_results table. Each probe asserts the tenant-isolation
-- invariants from docs/superpowers/specs/2026-07-03-saas-platform-strategy.md.

begin;

create temp table probe_results (
  n serial, probe text, expected text, actual text,
  pass boolean
) on commit drop;

-- Fixtures (as postgres, bypassing RLS): one non-legacy org/event pair.
insert into public.orgs (id, name) values
  ('00000000-0000-4000-8000-00000000aaaa', 'Probe Org A'),
  ('00000000-0000-4000-8000-00000000bbbb', 'Probe Org B');
insert into public.events (id, org_id, slug, name, status) values
  ('00000000-0000-4000-8000-00000000eee1', '00000000-0000-4000-8000-00000000aaaa', 'probe-live', 'Probe Live', 'live'),
  ('00000000-0000-4000-8000-00000000eee2', '00000000-0000-4000-8000-00000000aaaa', 'probe-draft', 'Probe Draft', 'draft');
insert into public.posts (id, image_url, event_id, approved, hidden) values
  ('00000000-0000-4000-8000-00000000e0a1'::uuid, 'probe://approved', 'probe-live', true, false),
  ('00000000-0000-4000-8000-00000000e0a2'::uuid, 'probe://hidden', 'probe-live', true, true);

-- Probe 1: anon CAN insert a post into a legacy event (grandfather).
do $$
begin
  set local role anon;
  insert into public.posts (image_url, event_id) values ('probe://legacy', 'hope-gala');
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon insert post → legacy slug', 'allowed', 'allowed', true);
exception when others then
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon insert post → legacy slug', 'allowed', sqlerrm, false);
end $$;

-- Probe 2: anon CANNOT insert a post into a new-tenant event.
do $$
begin
  set local role anon;
  insert into public.posts (image_url, event_id) values ('probe://new', 'probe-live');
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon insert post → new tenant', 'denied', 'allowed', false);
exception when others then
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon insert post → new tenant', 'denied', 'denied ('||sqlerrm||')', true);
end $$;

-- Probe 3: anon sees approved+visible posts of a live event, not hidden ones.
do $$
declare vis int; hid int;
begin
  set local role anon;
  select count(*) into vis from public.posts where event_id = 'probe-live' and image_url = 'probe://approved';
  select count(*) into hid from public.posts where event_id = 'probe-live' and image_url = 'probe://hidden';
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon read posts (live event)', 'visible=1 hidden=0',
            format('visible=%s hidden=%s', vis, hid), vis = 1 and hid = 0);
exception when others then
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon read posts (live event)', 'visible=1 hidden=0', sqlerrm, false);
end $$;

-- Probe 4: anon cannot see draft events.
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.events where slug = 'probe-draft';
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon read draft event', '0 rows', n || ' rows', n = 0);
exception when others then
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon read draft event', '0 rows', sqlerrm, false);
end $$;

-- Probe 5: anon cannot update/moderate new-tenant posts.
do $$
declare n int;
begin
  set local role anon;
  update public.posts set hidden = true
    where id = '00000000-0000-4000-8000-00000000e0a1'::uuid;
  get diagnostics n = row_count;
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon moderate new-tenant post', '0 rows updated', n || ' rows updated', n = 0);
exception when others then
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon moderate new-tenant post', '0 rows updated', 'denied ('||sqlerrm||')', true);
end $$;

-- Probe 6: anon can still update legacy rows (grandfathered moderation path).
do $$
declare n int;
begin
  set local role anon;
  update public.posts set hidden = hidden where event_id = 'hope-gala' and image_url = 'probe://legacy';
  get diagnostics n = row_count;
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon update legacy post', '>=1 row updated', n || ' rows updated', n >= 1);
exception when others then
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon update legacy post', '>=1 row updated', sqlerrm, false);
end $$;

-- Probe 7: anon cannot read billing tables.
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.credit_balances;
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon read credit_balances', '0 rows', n || ' rows', n = 0);
exception when others then
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon read credit_balances', '0 rows', 'denied ('||sqlerrm||')', true);
end $$;

-- Probe 8: anon cannot call spend_credits.
do $$
begin
  set local role anon;
  perform public.spend_credits('00000000-0000-4000-8000-00000000aaaa', 1, 'probe');
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon call spend_credits', 'denied', 'allowed', false);
exception when others then
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('anon call spend_credits', 'denied', 'denied ('||sqlerrm||')', true);
end $$;

-- Probe 9: authenticated non-member cannot read another org's events content
-- (simulated JWT: request.jwt.claims drives auth.uid()).
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-00000000dddd","role":"authenticated"}', true);
  select count(*) into n from public.credit_ledger
    where org_id = '00000000-0000-4000-8000-00000000aaaa';
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('stranger reads org A ledger', '0 rows', n || ' rows', n = 0);
exception when others then
  reset role;
  insert into probe_results (probe, expected, actual, pass)
    values ('stranger reads org A ledger', '0 rows', sqlerrm, false);
end $$;

-- Probe 10: spend_credits is race-safe at the floor (as postgres/service path).
do $$
declare b int; failed boolean := false;
begin
  insert into public.credit_balances (org_id, balance)
    values ('00000000-0000-4000-8000-00000000bbbb', 5)
    on conflict (org_id) do update set balance = 5;
  b := public.spend_credits('00000000-0000-4000-8000-00000000bbbb', 5, 'probe');
  begin
    b := public.spend_credits('00000000-0000-4000-8000-00000000bbbb', 1, 'probe');
  exception when others then
    failed := true;
  end;
  insert into probe_results (probe, expected, actual, pass)
    values ('spend_credits floor', 'second spend denied',
            case when failed then 'denied' else 'allowed' end, failed);
end $$;

select probe, expected, actual, case when pass then 'PASS' else 'FAIL' end as result
from probe_results order by n;

rollback;
