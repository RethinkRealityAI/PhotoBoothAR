-- 010: per-user rate limiting for the free ai-event-designer endpoint.
--
-- ai-event-designer is JWT-gated but spends no credits, so without a cap any
-- signed-in account could burn Gemini quota. The edge function records one
-- row per call and rejects callers over the hourly window. Service-role only:
-- RLS is enabled with NO policies, so client sessions can neither read nor
-- write usage rows.

create table if not exists public.ai_designer_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_designer_usage_user_time_idx
  on public.ai_designer_usage (user_id, created_at desc);

alter table public.ai_designer_usage enable row level security;
