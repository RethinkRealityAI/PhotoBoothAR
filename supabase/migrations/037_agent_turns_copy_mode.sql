-- 037_agent_turns_copy_mode.sql
-- agent_turns.mode gains 'copy'.
--
-- ai-event-designer v19 adds a fourth mode: the four guest-facing lines
-- (tagline · welcomeIntro · thankYou · keepsakeIntro) written ONCE per event
-- by the client's generateEventCopy (src/lib/eventCopy.ts) at create-success
-- or go-live. Every turn writes one telemetry row (036), and that row's
-- `mode` CHECK only knew create / copilot / scene.
--
-- 036 declared the CHECK inline on the column, so Postgres auto-named it
-- `agent_turns_mode_check` (<table>_<column>_check). It is dropped by that
-- name and re-added under the SAME name, so a re-run is a no-op and the next
-- mode can be added the same way.
--
-- Apply BEFORE deploying ai-event-designer v19. Until it is applied a copy
-- turn still answers (telemetry is never load-bearing — index.ts recordTurn)
-- but every one logs `agent_turns insert failed` and returns turnId null.
--
-- Idempotent. No data change: every existing row already satisfies the wider
-- set, and no row is rewritten.

alter table public.agent_turns
  drop constraint if exists agent_turns_mode_check;

alter table public.agent_turns
  add constraint agent_turns_mode_check
  check (mode in ('create', 'copilot', 'scene', 'copy'));
