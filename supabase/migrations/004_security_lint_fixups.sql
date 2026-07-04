-- 004: Security lint fixups after 003.
-- Trigger functions are fired internally and must not be RPC-callable.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_new_org() from public, anon, authenticated;

-- Pre-existing trigger fn: pin search_path (advisor 0011).
alter function public.set_updated_at() set search_path = public;

-- NOTE (documented, intentional):
-- * is_org_member/event_org/event_org_by_id/event_is_public/is_event_member
--   stay executable by anon+authenticated: RLS policies evaluate them as the
--   calling role, so revoking EXECUTE would break table access. They leak at
--   most an event's org uuid and the caller's own membership boolean.
-- * guest_quota / stripe_webhook_events have RLS enabled with no policies:
--   service-role-only tables by design.
-- * Public-bucket listing policies (posts/assets) are grandfathered legacy
--   behavior; hardening is scheduled for when legacy events are archived.
