-- 049: How a greeting card arrives — the host's presentation choice.
--
-- cards.presentation jsonb: { v, reveal, email, look }
--   reveal — the opening moment on /c/:publicId (envelope | curtain |
--            airplane | stardust | none)
--   email  — the delivery email's style (glow | sealed | spotlight)
--   look   — whose colours the card wears (auto | beamwall | event)
-- The closed sets live in src/lib/cardPresentation.ts; card-view returns the
-- object verbatim and card-publish reads `email`, and BOTH sides normalise it
-- (an unknown value falls back to the default), so the column only needs to be
-- an object of bounded size.
--
-- No new policy: hosts already UPDATE their cards under the existing member
-- RLS (the same path that writes `template` and `theme`), and the public read
-- path is the service-role card-view function.
--
-- Additive and idempotent: existing rows get '{}', which renders exactly as the
-- defaults (envelope reveal, glow email, automatic look).

alter table public.cards
  add column if not exists presentation jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cards'::regclass and conname = 'cards_presentation_shape'
  ) then
    alter table public.cards
      add constraint cards_presentation_shape
      check (jsonb_typeof(presentation) = 'object' and pg_column_size(presentation) <= 2048);
  end if;
end $$;
