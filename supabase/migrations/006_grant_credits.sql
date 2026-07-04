-- 006_grant_credits.sql — atomic credit grant for the Stripe webhook.
--
-- Mirror of spend_credits (003_rls_hardening.sql) with a positive delta:
-- a single INSERT ... ON CONFLICT DO UPDATE is race-safe without locks and
-- creates the balance row if the org has never had one. Ledger row appended
-- in the same statement batch (same transaction inside the function).
--
-- Service-role only (stripe-webhook edge function calls it via PostgREST rpc);
-- revoked from all client roles.
--
-- ⚠ Must be applied to the database BEFORE deploying the stripe-webhook
--   function, which calls public.grant_credits(...).

create or replace function public.grant_credits(p_org uuid, p_amount int, p_reason text, p_ref jsonb default null)
returns int language plpgsql security definer set search_path = public as $$
declare new_balance int;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  insert into public.credit_balances (org_id, balance)
    values (p_org, p_amount)
  on conflict (org_id) do update
    set balance = public.credit_balances.balance + excluded.balance
  returning balance into new_balance;
  insert into public.credit_ledger (org_id, delta, reason, ref)
    values (p_org, p_amount, p_reason, p_ref);
  return new_balance;
end $$;

revoke all on function public.grant_credits(uuid, int, text, jsonb) from public, anon, authenticated;
