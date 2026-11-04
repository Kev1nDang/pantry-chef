---
title: Pantry Chef API
emoji: 🥕
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Pantry Chef's API, with an OWLv2 grocery counter
---

# Pantry Chef API

The backend of [Pantry Chef](https://github.com/Kev1nDang/pantry-chef), which suggests recipes from the groceries you have. This Space runs the FastAPI app; its interactive docs are at `/docs`.

**Photo counting** (`POST /api/pantry/detect`) runs [OWLv2](https://huggingface.co/google/owlv2-base-patch16-ensemble) inside this Space. It uses the int8 ONNX export from [Xenova/owlv2-base-patch16-ensemble](https://huggingface.co/Xenova/owlv2-base-patch16-ensemble), run with ONNX Runtime, with OpenCV and NumPy for the image work. The model is baked into the image at build time, and no photo leaves the Space.

Most routes need a Pantry Chef sign-in (a Supabase access token), so this Space is only useful behind the web app.

## Configuration (Settings → Variables and secrets)

| Name | Kind | What |
|---|---|---|
| `DATABASE_URL` | secret | Supabase Postgres connection string (session pooler) |
| `SUPABASE_URL` | variable | `https://<project-ref>.supabase.co`, used to verify sign-in tokens |
| `ANTHROPIC_API_KEY` | secret | Claude API key, only used for recipe generation |
| `CORS_ORIGINS` | variable | JSON list of web app origins, e.g. `["https://your-app.vercel.app"]` |

The source and the deploy script (`backend/scripts/deploy_space.py`) are in the GitHub repo.
