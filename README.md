# 🥕 Pantry Chef

Pantry Chef suggests recipes based on the groceries you have. Enter what's in your kitchen and how much of it, and it ranks recipes by how much of each one you can already cover. It shows which ingredients you have, which are running low and which you need to buy.

> **Status:** frontend MVP. Recipes come from a local mock dataset for now. The backend and infrastructure are still being planned; see [docs/ROADMAP.md](docs/ROADMAP.md).

## Features

- **Grocery input with amounts and units:** pcs, g, kg, ml, l, tsp, tbsp, cup. If you add the same item twice, the amounts are merged.
- **Smart matching:**
  - Units are converted, so 1 kg of rice covers a recipe that needs 250 g.
  - Simple plurals match their singular ("tomatoes" matches "tomato").
  - Mass and volume are compared approximately (about 1 g per ml).
  - Optional ingredients count for less.
- **Ranked results** with a coverage meter and **Ready now** / **Almost** filters.
- **Recipe detail view:** each ingredient is labelled Have, Low or Need. You also get an auto-generated shopping list and the steps.
- **Saved automatically:** your grocery list is stored in `localStorage`.
- **Responsive and dark-mode aware.**

## Tech stack

| Layer   | Choice                     |
| ------- | -------------------------- |
| UI      | React 19 + TypeScript      |
| Build   | Vite                       |
| Lint    | oxlint                     |
| CI      | GitHub Actions (lint + build) |

## Getting started

Requires **Node.js 20+**.

```bash
git clone https://github.com/Kev1nDang/pantry-chef.git
cd pantry-chef
npm install
npm run dev
```

Then open http://localhost:5173.

| Script            | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the dev server with hot reload |
| `npm run build`   | Type-check and build to `dist/`      |
| `npm run preview` | Serve the production build locally   |
| `npm run lint`    | Lint with oxlint                     |

## Project structure

```
src/
├── App.tsx                 # Page layout, grocery state, filters
├── components/
│   ├── GroceryForm.tsx     # Name / amount / unit input
│   ├── GroceryList.tsx     # Editable grocery list
│   ├── RecipeCard.tsx      # Ranked result card with coverage meter
│   └── RecipeDetail.tsx    # Modal: ingredient status, shopping list, steps
├── data/recipes.ts         # Mock recipe dataset (to be replaced by the API)
├── lib/match.ts            # Unit conversion + recipe scoring/ranking
├── types.ts                # Shared domain types
└── index.css               # Styles and theme tokens
```

## How matching works

For each recipe ingredient, `lib/match.ts`:

1. Finds the grocery item with a matching name. It tries an exact match after normalizing, then a substring match.
2. Converts both amounts to a base unit (g, ml or pieces) and works out *have ÷ need*.
3. Marks the ingredient **enough** (≥ 1), **partial** (< 1), **missing**, or **unknown** when the units can't be compared, such as pieces against grams.

A recipe's score is the weighted coverage across its ingredients, with optional ingredients weighted at 0.25. A recipe is **ready** when every required ingredient is fully covered.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the planned backend, data and infrastructure work.

## License

[MIT](LICENSE)
