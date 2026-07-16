-- 012_challenge_validation.sql
-- AI photo-challenge validation. A challenge may require the guest's captured
-- photo to pass a Gemini vision check before it counts (e.g. "the photo clearly
-- shows at least one person wearing red"). Config is a single nullable jsonb
-- blob, mirroring the experiences.config / events.config idiom rather than
-- adding four discrete columns:
--   { enabled: boolean, prompt: text, referenceImageUrl?: text|null }
-- NULL / { enabled:false } = no check (today's behaviour, unchanged).
--
-- Additive + idempotent. RLS is row-level on public.challenges (via
-- public.is_event_member(event_id) / event_is_public(event_id)) and already
-- covers every column — no policy change is needed for a new column.
alter table public.challenges
  add column if not exists validation jsonb;
