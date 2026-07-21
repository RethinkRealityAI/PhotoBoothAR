-- 016: Billing-integrity support for stripe-webhook refund/dispute handling.
--
-- (1) orders.status gains 'disputed' (charge.dispute.created marks the row;
--     'refunded' was already allowed by 010_orders.sql).
-- (2) public.clawback_credits — the refund counterpart of grant_credits
--     (006_grant_credits.sql): removes up to p_amount credits from the org,
--     FLOORING THE BALANCE AT 0 (credit_balances.balance has a >= 0 CHECK and
--     the org may have already spent the granted credits), and always appends
--     a negative credit_ledger row recording what was actually removed —
--     delta 0 still leaves an audit trace that the refund was processed
--     against an empty balance. Returns the amount actually clawed back so
--     the webhook can log a shortfall. Row-locked (FOR UPDATE) → race-safe
--     against concurrent grant/spend.
--
-- Service-role only (stripe-webhook calls it via PostgREST rpc); revoked from
-- all client roles. No RLS change: orders keeps its no-client-policy posture.

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status = any (array['paid', 'refunded', 'disputed']));

create or replace function public.clawback_credits(p_org uuid, p_amount int, p_reason text, p_ref jsonb default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_balance int;
  v_clawed int;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  select balance into v_balance from public.credit_balances where org_id = p_org for update;
  if not found then
    v_balance := 0;
  end if;
  v_clawed := least(v_balance, p_amount);
  if v_clawed > 0 then
    update public.credit_balances set balance = balance - v_clawed where org_id = p_org;
  end if;
  insert into public.credit_ledger (org_id, delta, reason, ref)
    values (p_org, -v_clawed, p_reason, p_ref);
  return v_clawed;
end $$;

revoke all on function public.clawback_credits(uuid, int, text, jsonb) from public, anon, authenticated;
