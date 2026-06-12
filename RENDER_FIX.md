# Fix “Not Found” on boon-hua-fishery.onrender.com

If **every** URL returns `Not Found` (including `/` and `/recipes/ai-status`), the Python API is **not running**. The deploy is usually pointed at the **wrong folder** in a monorepo.

## Quick check

| URL | Expected (working API) |
|-----|------------------------|
| `https://boon-hua-fishery.onrender.com/` | JSON: `"status":"Online"`, `"aiStatus":"/recipes/ai-status"` |
| `https://boon-hua-fishery.onrender.com/recipes/ai-status` | JSON: `{"enabled":true,...}` or `{"enabled":false,...}` |
| `https://boon-hua-fishery.onrender.com/docs` | FastAPI Swagger page |

If all return **Not Found**, fix Render settings below.

**Render header `x-render-routing: no-server`** means no web process is running (service suspended, crashed, or never deployed). Fix in the dashboard — not in the mobile app.

## Option A — Set Root Directory (recommended)

1. [Render Dashboard](https://dashboard.render.com) → **boon-hua-fishery** → **Settings**
2. **Root Directory:** `boon_hua_backend` (exact spelling, no slash)
3. **Build Command:** `pip install -r requirements.txt`
4. **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. **Health Check Path:** `/`
6. **Save** → **Manual Deploy** → Deploy latest commit

## Option B — Deploy from repo root (fallback)

This repo now includes a root `main.py` + `requirements.txt` shim.

1. **Root Directory:** leave **empty**
2. **Build Command:** `pip install -r requirements.txt`
3. **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Redeploy

## Service type

Must be **Web Service** (Python), **not** Static Site.

## AI key (after API responds)

Environment → `GEMINI_API_KEY` = key from [Google AI Studio](https://aistudio.google.com/apikey) (usually starts with `AIza`).

Redeploy after adding the variable.

## View logs

**Logs** tab → look for:

- `Application startup complete` — good
- `ModuleNotFoundError: No module named 'main'` — wrong root directory
- `No such file: requirements.txt` — wrong root directory
