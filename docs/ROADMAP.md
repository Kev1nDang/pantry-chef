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
- [x] Vite dev proxy `/api` → `:8290`
- [ ] Connect a real Supabase project and verify end to end (login, pantry sync, match, AI routes)
- [x] Frontend reads recipes from the API (`src/lib/api.ts`; mock dataset removed)
- [x] Port matching to `POST /api/recipes/match`
- [x] Frontend login with `supabase-js` (email magic link) and pantry sync
- [x] Google sign-in (Supabase OAuth) with an account menu; the shopping list syncs to the account too (`/api/shopping`)
- [ ] Turn on the Google provider in Supabase and add the deployed site to its redirect URLs (README → Sign-in)
- [x] Paste-a-list: `POST /api/pantry/parse` plus a review UI
- [x] CI for the backend (ruff + pytest)
- [x] AI recipe generation: `POST /api/recipes/generate` plus "Cook something from my pantry"
- [x] Dietary/tag filter on recipe list and match; servings scaling in the recipe view

AI (Claude API, server-side only, `backend/app/services/ai.py`):

- Model `claude-sonnet-5-5` by default (`ANTHROPIC_MODEL`), structured outputs validated with Pydantic.
- AI routes require sign-in and have an in-memory per-user rate limit (`AI_RATE_LIMIT_PER_MINUTE`).
  It's per API process; move it to Postgres before relying on it (Phase 4, item 3).
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

- [x] Authentication: Supabase Auth with Google OAuth and email magic links
- [x] Sync the pantry and shopping list across devices

## Phase 4: Infrastructure

In place: the API on Google Cloud Run (`backend/scripts/deploy_cloud_run.py`: 2 vCPU / 4 GiB, 0–2
instances, secrets in Secret Manager), Postgres, Auth and photo storage on Supabase, CI (lint, tests,
build) on GitHub Actions.

### Latency and reliability pass (2026-11-21)

Measured from a US East machine against the Supabase project (us-west-2): one database round trip is
91 ms, and a request that reads the database makes 4–5 of them (pool pre-ping, BEGIN, the queries,
ROLLBACK).

- [x] Saving the pantry no longer reloads every row after commit: 20 items went from 22 statements
  to 2 (`expire_on_commit=False`; ~1.8 s of round trips at 91 ms each).
- [x] Recipes and their ingredient names come from an in-memory catalog (5-minute TTL), served from
  the old copy while the database is unreachable. `/api/recipes/match` went from 442 ms to ~3 ms of
  server time once warm; scans and pasted lists skip their name lookup (378 ms).
- [x] Connection pool sized for Supabase's session pooler (2 instances × 6 ≤ 15), 5 s connect
  timeout, 10 s pool timeout; connection failures answer `503` + `Retry-After` instead of `500`.
- [x] Scan load shedding: one running and two waiting per instance; more get `429` + `Retry-After`
  at once instead of queueing toward the request timeout.
- [x] Claude calls time out after 75 s with one retry (the SDK default was 10 minutes); Cloud Run's
  request timeout is 180 s so both attempts fit.
- [x] Observability: request ids (`X-Request-ID`), `Server-Timing`, one access log line per request,
  JSON logs on Cloud Run linked to the request trace. `/api/health` reports the scanner's state and
  the deployed commit.
- [x] Web app: wakes the API on load; shows a signed-in user's last-known pantry at once; keeps
  unsaved changes across a closed tab; retries failed loads and saves with backoff; one save at a
  time (two concurrent replace-the-list requests could leave both lists' rows); sends a waiting
  save when the page is hidden.
- [x] Deploy script defaults to `us-west1`, next to the database.

**To do by hand:** run `python scripts/deploy_cloud_run.py` (this creates the service in
`us-west1` with a new URL, and picks up the new DATABASE_URL secret), then delete the old one with
`gcloud run services delete pantry-chef-api --region us-east1`. Check a scan's `seconds` and
`/api/health`'s `version` afterwards.

### Next, in priority order

1. **Deploy the web app** (Vercel), then redeploy the API with `--cors-origin https://<app>`. Add
   the app URL to Supabase's auth redirect list.
2. **Uptime check and alerting.** A Cloud Monitoring uptime check on `/api/health` (free) that
   emails when `status` isn't `ok`, plus a log-based alert on 5xx rate.
3. **Shared, durable AI limits.** The per-minute limit is per instance (so 2× with 2 instances) and
   there's no daily cap on Claude spend. A Postgres `ai_usage (user_id, day, count)` table with an
   upsert per call gives one limit across instances and a daily cap per user.
4. **Lost-update protection for the pantry.** `PUT /api/pantry` replaces the whole list, so two
   devices editing at once lose one side's changes. Send a version (`If-Match`) and answer `409`
   when it's stale, or move to per-item `POST`/`PATCH`/`DELETE`.
5. **CD from `main`.** GitHub Actions with Workload Identity Federation (no stored keys) running the
   deploy on merge, and a `docker build` in CI so a broken Dockerfile fails before deploy day.
6. **Migrations with history.** Migrations were applied by hand with psycopg, so nothing records
   which ran. Use `supabase db push` (or a small runner with a tracking table) from CI.
7. **Error tracking.** Sentry (free tier) on both the API and the web app, with the request id as a
   tag so a user's report leads to the log line.
8. **Faster scans.** First confirm the thread fix on Cloud Run (a scan's `seconds` should drop from
   ~20 s to ~11 s). Then 4 vCPUs (not yet measured; twice the per-second price), or the on-device
   detector already planned (RF-DETR nano via onnxruntime-web), which also takes scans off the
   server.
9. **Smaller uploads.** Photos are encoded at up to 1568 px (sized for Claude, which no longer reads
   them) while OWLv2 looks at 960 px. Encoding scans at 960–1280 px cuts the upload a phone sends
   on a cellular connection; saved photos could keep the larger size.
10. **Transaction pooler.** If traffic grows past the session pooler's connections, switch
    `DATABASE_URL` to Supabase's transaction pooler (port 6543) with prepared statements off.

## Ideas / later

- Expiry dates on groceries, so items about to expire are used first
- ~~Dietary filters (vegan, gluten-free, …)~~ basic tag filter done; needs richer tagging of seed recipes
- ~~Scale a recipe by servings~~ display scaling done; Have/Low/Need still uses base servings
- Barcode or receipt scanning to add groceries (pasted receipt text is supported; photos are not)
- ~~AI-generated recipes from whatever is left in the pantry~~ done (not persisted yet)
