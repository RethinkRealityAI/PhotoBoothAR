-- 045_library_taxonomy.sql
--
-- Organises the shared library (/admin/library) like a CMS.
--
-- Model, and why:
--   * CATEGORIES are a two-level tree (top level -> subcategory, e.g.
--     Holidays -> Christmas). Each library item sits in at most ONE category,
--     so "where does this live?" always has one answer and a count per shelf
--     adds up. Picking a top-level category includes its subcategories.
--   * KEYWORDS are free, flat, many per item (e.g. "santa", "gold", "mask").
--     They are for search and cross-cutting groupings that do not deserve a
--     shelf. The fixed occasion / colour / style tags in config.library.tags
--     are unchanged: the host picker's matcher (src/lib/libraryMatch.ts) reads
--     them and must keep working.
--   * Stable SLUGS (lower-kebab, never changed after create) are the API / MCP
--     handle: `?category=christmas` keeps meaning the same thing when Dapo
--     renames "Christmas" to "Christmas & Holidays".
--
-- Security:
--   * library_categories: RLS on. Anyone may READ (a public catalogue an AI
--     agent or the host picker may query; it holds no customer data). No client
--     write policy: admin-api on the service role is the only writer, and it
--     asserts platform-admin first. Default table privileges grant ALL to
--     anon/authenticated, so writes are also REVOKED explicitly.
--   * experiences gains two nullable/defaulted columns. Existing tenant RLS is
--     untouched; a host setting them on their own event rows changes nothing
--     anyone else sees (only global rows are shown in the library).
--
-- Idempotent.

create table if not exists public.library_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 48),
  name        text not null check (char_length(btrim(name)) between 1 and 48),
  description text not null default '' check (char_length(description) <= 280),
  parent_id   uuid references public.library_categories(id) on delete restrict,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create index if not exists library_categories_parent_idx on public.library_categories (parent_id, sort_order);

-- Two levels, never three: a subcategory's parent must be top level, and a
-- category that already has children cannot itself become a subcategory.
create or replace function public.library_categories_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from public.library_categories p where p.id = new.parent_id and p.parent_id is not null) then
      raise exception 'category_too_deep' using errcode = '22023';
    end if;
    if exists (select 1 from public.library_categories c where c.parent_id = new.id) then
      raise exception 'category_has_children' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.slug <> old.slug then
    raise exception 'slug_immutable' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.library_categories) >= 300 then
    raise exception 'too_many_categories' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.library_categories_guard() from public, anon, authenticated;

drop trigger if exists library_categories_guard on public.library_categories;
create trigger library_categories_guard
  before insert or update on public.library_categories
  for each row execute function public.library_categories_guard();

alter table public.library_categories enable row level security;
drop policy if exists library_categories_public_read on public.library_categories;
create policy library_categories_public_read on public.library_categories
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.library_categories from anon, authenticated;
grant select on public.library_categories to anon, authenticated;

-- ── Item columns ──────────────────────────────────────────────────────────
alter table public.experiences
  add column if not exists library_category_id uuid
    references public.library_categories(id) on delete set null;
alter table public.experiences
  add column if not exists library_keywords text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'experiences_library_keywords_cap') then
    alter table public.experiences
      add constraint experiences_library_keywords_cap check (cardinality(library_keywords) <= 24);
  end if;
end $$;

create index if not exists experiences_library_category_idx
  on public.experiences (library_category_id) where is_global;
create index if not exists experiences_library_keywords_idx
  on public.experiences using gin (library_keywords) where is_global;

-- ── Starter tree (insert-if-missing by slug; never overwrites Dapo's edits) ──
insert into public.library_categories (slug, name, description, sort_order) values
  ('holidays',     'Holidays',             'Seasonal and holiday looks.', 10),
  ('celebrations', 'Celebrations',         'Life moments: weddings, birthdays, graduations.', 20),
  ('glam',         'Glam & royalty',       'Crowns, tiaras, gala masks and red-carpet pieces.', 30),
  ('fantasy',      'Fantasy & characters', 'Heroes, magic, creatures and costume characters.', 40),
  ('sports',       'Sports & fan gear',    'Team colours, game day and sporty props.', 50),
  ('fashion',      'Fashion & accessories','Everyday hats, eyewear and face paint.', 60),
  ('business',     'Business & brand',     'Conferences, launches and branded events.', 70)
on conflict (slug) do nothing;

insert into public.library_categories (slug, name, parent_id, sort_order)
select v.slug, v.name, p.id, v.sort_order
from (values
  ('christmas',     'Christmas',          'holidays', 10),
  ('new-year',      'New Year''s',        'holidays', 20),
  ('halloween',     'Halloween',          'holidays', 30),
  ('easter',        'Easter',             'holidays', 40),
  ('valentines',    'Valentine''s Day',   'holidays', 50),
  ('thanksgiving',  'Thanksgiving',       'holidays', 60),
  ('weddings',      'Weddings',           'celebrations', 10),
  ('birthdays',     'Birthdays',          'celebrations', 20),
  ('graduations',   'Graduations',        'celebrations', 30),
  ('baby-showers',  'Baby showers',       'celebrations', 40),
  ('crowns-tiaras', 'Crowns & tiaras',    'glam', 10),
  ('masks',         'Masks & masquerade', 'glam', 20),
  ('superheroes',   'Superheroes & sci-fi','fantasy', 10),
  ('magic',         'Magic & wizards',    'fantasy', 20),
  ('creatures',     'Animals & creatures','fantasy', 30),
  ('team-colours',  'Team colours',       'sports', 10),
  ('hats-caps',     'Hats & caps',        'fashion', 10),
  ('eyewear',       'Eyewear',            'fashion', 20),
  ('face-paint',    'Face paint',         'fashion', 30),
  ('conferences',   'Conferences',        'business', 10),
  ('launches',      'Product launches',   'business', 20)
) as v(slug, name, parent_slug, sort_order)
join public.library_categories p on p.slug = v.parent_slug
on conflict (slug) do nothing;

-- Seed: the Christmas collection already marks its items; file them under
-- Holidays -> Christmas. Only rows with no category yet.
update public.experiences e
set library_category_id = c.id
from public.library_categories c
where c.slug = 'christmas'
  and e.is_global
  and e.library_category_id is null
  and lower(e.config->'library'->>'collection') = 'christmas';
