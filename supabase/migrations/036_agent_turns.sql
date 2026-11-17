-- 036: agent_turns — per-turn telemetry for the ai-event-designer agent.
--
-- Purpose (agent playbook rule 10 — iterate, measure, collect feedback): one
-- row per Gemini turn in ai-event-designer (create · copilot · scene modes)
-- so latency, retries, token spend, prompt-cache hits, proposal validity and
-- host thumbs can be queried per model/profile instead of guessed.
--
-- Stores NO message text: sizes, tokens, latency, model + generation settings,
-- the proposals JSON (≤ 8 KB, the agent's OUTPUT actions/plan only), error
-- codes and feedback. The host's words and the event snapshot never land here.
--
-- Written ONLY by the ai-event-designer edge function on the service role
-- (insert after every turn — success or error — and two guarded updates:
-- `dropped_count` from the next turn's `lastTurn`, and `feedback` /
-- `feedback_note` from mode 'feedback', both `where id = $1 and user_id = $2`).
-- Service-role only: RLS is enabled with NO policies (exactly like
-- ai_designer_usage in 010), so client sessions can neither read nor write.
--
-- Retention: intended 90 days. The purge job is OUT OF SCOPE here — until it
-- exists, `delete from public.agent_turns where created_at < now() - interval
-- '90 days'` is the manual step.

create table if not exists public.agent_turns (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null,
  org_id uuid,
  event_id uuid,
  mode text not null check (mode in ('create', 'copilot', 'scene')),
  surface text,
  model text not null,
  temperature real,
  thinking_budget int,
  latency_ms int not null,
  attempts smallint not null default 1,
  prompt_tokens int,
  cached_tokens int,
  output_tokens int,
  thoughts_tokens int,
  reply_chars int,
  actions_json text check (actions_json is null or octet_length(actions_json) <= 8192),
  dropped_count int not null default 0,
  error_code text,
  feedback smallint check (feedback is null or feedback in (-1, 1)),
  feedback_note text check (feedback_note is null or char_length(feedback_note) <= 500)
);

create index if not exists agent_turns_created_idx
  on public.agent_turns (created_at desc);

create index if not exists agent_turns_user_time_idx
  on public.agent_turns (user_id, created_at desc);

alter table public.agent_turns enable row level security;
