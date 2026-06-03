# Deploy Boon Hua API to Render

If `https://boonhua-api.onrender.com` shows **Not Found**, the Python API is **not running** on Render yet. Saving the URL in the admin web app only tells phones where to call — you must deploy this folder first.

## 1. Push code to GitHub

Upload `boon_hua_backend` (include `main.py`, `ai_recipe_service.py`, `requirements.txt`, `recipes_data.py`, `themealdb_service.py`).  
Do **not** commit `firebase_credentials.json` or `venv/`.

## 2. Create a Web Service on Render

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo
3. Settings:

| Field | Value |
|--------|--------|
| **Name** | `boonhua-api` (gives URL `https://boonhua-api.onrender.com`) |
| **Root Directory** | folder containing `main.py` (e.g. `boon_hua_backend` if monorepo) |
| **Runtime** | Python 3 |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| **Health Check Path** | `/` |

4. **Create Web Service** and wait for deploy to finish (green “Live”).

## 3. Deploy the latest backend (fixes `/recipes/ai-status` Not Found)

**Not Found** on `/recipes/ai-status` means Render is still running an **old** build without AI routes.

1. Push the latest `boon_hua_fishery` repo to GitHub (must include `ai_recipe_service.py` and updated `main.py`).
2. Render → your service → **Manual Deploy** → **Deploy latest commit**.
3. Wait until status is **Live**, then open:
   - `https://boonhua-api.onrender.com/` — JSON should include `"aiRecipes": true` after the key is set.
   - `https://boonhua-api.onrender.com/recipes/ai-status` — should return JSON, not Not Found.

**Root Directory** must be the folder that contains `main.py` (e.g. `boon_hua_backend` in a monorepo).

## 4. AI recipes (required for AI Meal Ideas & chat)

Add **one** of these in Render → **Environment** (never commit keys to Git):

| Variable | Where to get it |
|----------|-----------------|
| **`GEMINI_API_KEY`** | [Google AI Studio](https://aistudio.google.com/apikey) — key usually starts with **`AIza`** |
| **`OPENAI_API_KEY`** | [OpenAI API keys](https://platform.openai.com/api-keys) (optional alternative) |

Optional: `GEMINI_MODEL` (default `gemini-2.0-flash`) or `OPENAI_MODEL` (default `gpt-4o-mini`).

After saving the variable, **redeploy** the service.

Check: `GET https://boonhua-api.onrender.com/recipes/ai-status` → `{"enabled":true,"provider":"gemini"}`

If your key does not start with `AIza`, create a new key in **Google AI Studio** (not Cloud Console OAuth tokens).

**Security:** If a key was shared in chat or email, revoke it in Google AI Studio and create a new one.

Without a key, the app falls back to TheMealDB / local recipes only (no AI chat).

## 5. Firebase (for inventory routes; optional for recipes)

Meal Ideas (`/recipes/suggest`, `/recipes/chat`) work **without** Firebase. Inventory needs Firebase.

1. Open your service → **Environment**
2. Add variable **`FIREBASE_CREDENTIALS_JSON`**
3. Paste the **entire** contents of `firebase_credentials.json` (one line JSON is fine)

## 6. Test

Open in a browser:

- `https://boonhua-api.onrender.com/`  
  Expected: `{"status":"Online","message":"Boon Hua Fishery API is running",...}`

- `https://boonhua-api.onrender.com/docs`  
  Expected: FastAPI Swagger page

If you still see **Not Found**, check:

- Service type is **Web Service**, not Static Site
- **Start Command** is exactly `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Root Directory** points to where `main.py` lives
- Deploy logs show no crash on startup

## 7. Admin web app

**Settings → Mobile Recipe API** → save:

`https://boonhua-api.onrender.com`

(no trailing slash)

This is **not** your React admin website URL and **not** TheMealDB.
