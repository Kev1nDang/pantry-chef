# Roadmap

This is a working document. The frontend MVP is done; the backend and infrastructure are still open questions to plan together.

## ✅ Phase 0: Frontend MVP

- [x] Grocery input with amounts and units
- [x] Client-side recipe matching and ranking
- [x] Recipe detail view with shopping list
- [x] Grocery list saved in `localStorage`
- [x] CI (lint + build)

## 🔜 Phase 1: Backend API

Open decisions:

- **Language/framework:** Node (Fastify/Express/NestJS), Python (FastAPI), or Go?
- **Recipe source:** our own curated database, or a third-party API (Spoonacular, Edamam, TheMealDB)?
- **Matching:** keep it on the client, or move it to the server so it can scale to thousands of recipes, for example with an ingredient index or full-text search?

Draft endpoints:

| Method | Path                   | Purpose                                     |
| ------ | ---------------------- | ------------------------------------------- |
| GET    | `/api/recipes`         | List/search recipes                         |
| GET    | `/api/recipes/:id`     | Recipe detail                               |
| POST   | `/api/recipes/match`   | Body: grocery list → ranked matches         |
| GET    | `/api/pantry`          | The user's saved groceries (requires auth)  |
| PUT    | `/api/pantry`          | Replace/update the user's groceries         |

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
- Dietary filters (vegan, gluten-free, …)
- Scale a recipe by servings
- Barcode or receipt scanning to add groceries
- AI-generated recipes from whatever is left in the pantry
