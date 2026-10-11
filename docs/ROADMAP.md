# Roadmap

This is a working document. The frontend MVP is done; the backend and infrastructure are still open questions to plan together.

## ✅ Phase 0: Frontend MVP

- [x] Grocery input with amounts and units
- [x] Client-side recipe matching and ranking
- [x] Recipe detail view with shopping list
- [x] Grocery list saved in `localStorage`
- [x] CI (lint + build)

## 🚧 Phase 1: Backend API (in progress)

Decided:

- **Framework:** Python + FastAPI, SQLAlchemy 2.0
- **Database and auth:** Supabase (Postgres + Supabase Auth). The schema lives in `supabase/migrations`, and the API verifies Supabase JWTs.
- **Recipe source:** start with our own seeded data
- **Matching:** move to the server (port `lib/match.ts`)

Progress:

- [x] FastAPI skeleton, settings, DB session, health check
- [x] Supabase schema with row level security, plus seed data
- [x] JWT verification and pantry `GET`/`PUT`
- [x] Recipe list/detail endpoints
- [x] Vite dev proxy `/api` → `:8000`
- [ ] Connect a real Supabase project and verify end to end (login, pantry sync, match, AI routes)
- [x] Frontend reads recipes from the API (`src/lib/api.ts`; mock dataset removed)
- [x] Port matching to `POST /api/recipes/match`
- [x] Frontend login with `supabase-js` (email magic link) and pantry sync
- [x] Paste-a-list: `POST /api/pantry/parse` plus a review UI
- [x] CI for the backend (ruff + pytest)
- [x] AI recipe generation: `POST /api/recipes/generate` plus "Cook something from my pantry"
- [x] Dietary/tag filter on recipe list and match; servings scaling in the recipe view

AI (Claude API, server-side only, `backend/app/services/ai.py`):

- Model `claude-sonnet-5-5` by default (`ANTHROPIC_MODEL`), structured outputs validated with Pydantic.
- AI routes require sign-in and have an in-memory per-user rate limit (`AI_RATE_LIMIT_PER_MINUTE`).
  It's per API process; move it to Redis/Postgres before running several workers.
- Generated recipes aren't stored yet. Saving favourites would need a `user_recipes` table (with RLS).

Draft endpoints:

| Method | Path                   | Purpose                                     |
| ------ | ---------------------- | ------------------------------------------- |
| GET    | `/api/recipes`         | List/search recipes                         |
| GET    | `/api/recipes/:id`     | Recipe detail                               |
| POST   | `/api/recipes/match`   | Body: grocery list → ranked matches         |
| POST   | `/api/recipes/generate`| AI recipe from the pantry (requires auth)   |
| GET    | `/api/pantry`          | The user's saved groceries (requires auth)  |
| PUT    | `/api/pantry`          | Replace/update the user's groceries         |
| POST   | `/api/pantry/parse`    | AI: pasted text → items to review (auth)    |

## Phase 2: Data model

Draft entities:

- `users`
- `ingredients`: a canonical name, aliases (to replace the current plural heuristics), and a density for g↔ml conversion
- `recipes`
- `recipe_ingredients`
- `pantry_items`

Likely a relational database (Postgres).

## Phase 3: Accounts & sync

- Authentication (OAuth, or a hosted provider such as Clerk, Auth0 or Supabase)
- Sync the pantry across devices

## Phase 4: Infrastructure

- Hosting
  - Frontend: Vercel, Netlify or S3 + CloudFront
  - API: Fly.io, Render, AWS ECS or Lambda
- Managed Postgres
- Infrastructure as code (Terraform)
- Environments: preview, staging, prod
- Observability: logging, error tracking and uptime checks
- CI/CD: deploy on merge to `main`

## Ideas / later

- Expiry dates on groceries, so items about to expire are used first
- ~~Dietary filters (vegan, gluten-free, …)~~ basic tag filter done; needs richer tagging of seed recipes
- ~~Scale a recipe by servings~~ display scaling done; Have/Low/Need still uses base servings
- Barcode or receipt scanning to add groceries (pasted receipt text is supported; photos are not)
- ~~AI-generated recipes from whatever is left in the pantry~~ done (not persisted yet)
