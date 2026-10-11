-- Dietary/tag filters (`GET /api/recipes?tag=vegan`, `POST /api/recipes/match` with `tags`)
-- query `recipes.tags @> array[...]`; a GIN index keeps that fast as the recipe table grows.
-- No table or policy changes: row level security from the init migration is unchanged.

create index if not exists recipes_tags_idx on public.recipes using gin (tags);
