-- Each user's shopping list, saved like the pantry so it follows them to every device they sign
-- in on. The web app replaces the whole list on each save; `position` keeps the user's order.

create table public.shopping_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  position   integer not null check (position >= 0),
  name       text not null check (char_length(name) between 1 and 100),
  amount     numeric not null check (amount > 0),
  unit       text not null check (unit in ('g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pcs')),
  checked    boolean not null default false,
  -- titles of the recipes this item was added for
  recipes    text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, position)
);

-- As with pantry_items, the API connects as `postgres` and bypasses RLS; this policy guards the
-- table from direct access with the public anon key.
alter table public.shopping_items enable row level security;

create policy "Users manage their own shopping list"
  on public.shopping_items for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
