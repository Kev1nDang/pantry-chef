-- Initial schema: recipes (public, read-only) and per-user pantry items.

create table public.recipes (
  id         text primary key,
  title      text not null,
  emoji      text not null default '',
  minutes    integer not null check (minutes > 0),
  servings   integer not null check (servings > 0),
  tags       text[] not null default '{}',
  steps      text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  recipe_id text not null references public.recipes (id) on delete cascade,
  position  integer not null,
  name      text not null,
  amount    numeric not null check (amount > 0),
  unit      text not null check (unit in ('g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pcs')),
  optional  boolean not null default false,
  primary key (recipe_id, position)
);

create table public.pantry_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  amount     numeric not null check (amount > 0),
  unit       text not null check (unit in ('g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pcs')),
  created_at timestamptz not null default now()
);

create index pantry_items_user_id_idx on public.pantry_items (user_id);

-- Row level security. The FastAPI backend connects as the `postgres` role and bypasses RLS;
-- these policies protect the tables from direct access with the public anon key.
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.pantry_items enable row level security;

create policy "Recipes are readable by everyone"
  on public.recipes for select using (true);

create policy "Recipe ingredients are readable by everyone"
  on public.recipe_ingredients for select using (true);

create policy "Users manage their own pantry"
  on public.pantry_items for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
