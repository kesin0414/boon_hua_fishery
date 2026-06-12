# Deploy Boon Hua API to Render

If `https://boon-hua-fishery.onrender.com` shows **Not Found**, the Python API is **not running** on Render yet. Saving the URL in the admin web app only tells phones where to call — you must deploy this folder first.

## 1. Push code to GitHub

Upload `boon_hua_backend` (include `main.py`, `ai_recipe_service.py`, `requirements.txt`, `recipes_data.py`, `themealdb_service.py`).  
Do **not** commit `firebase_credentials.json` or `venv/`.

## 2. Create a Web Service on Render

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo
3. Settings:

| Field | Value |
|--------|--------|
| **Name** | `boon-hua-fishery` (URL `https://boon-hua-fishery.onrender.com`) |
| **Root Directory** | folder containing `main.py` (e.g. `boon_hua_backend` if monorepo) |
| **Runtime** | Python 3 |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| **Health Check Path** | `/` |

4. **Create Web Service** and wait for deploy to finish (green “Live”).

## 3. Fix “Not Found” on ALL URLs (including `/`)

If even `https://boon-hua-fishery.onrender.com/` returns **Not Found**, FastAPI is **not running** — not an AI-only issue.

**Cause:** Render is building the **monorepo root** without `main.py`, or the service is a **Static Site**.

**Fix (pick one):**

| Setting | Value |
|---------|--------|
| **Root Directory** | `boon_hua_backend` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| **Health Check Path** | `/` |
| **Service type** | Web Service (Python) |

**OR** leave Root Directory empty and use the repo-root shim (`boon_hua_fishery/main.py` + root `requirements.txt`).

See **`RENDER_FIX.md`** at the repo root. After deploy, `/` must return JSON before `/recipes/ai-status` can work.

1. Push latest code → **Manual Deploy** → wait for **Live**.
2. Test `/` then `/recipes/ai-status`.

## 4. AI recipes (required for AI Meal Ideas & chat)

### When the API is online but AI is off

If `https://boon-hua-fishery.onrender.com/` returns JSON like:

```json
"aiRecipes": false,
"ai": { "enabled": false, "provider": "none" }
```

the API is working; you only need the AI key below.

### Enable AI (`aiRecipes: true`)

1. Open [Google AI Studio → API keys](https://aistudio.google.com/apikey).
2. **Create API key** in AI Studio — may start with **`AIza`** (older) or **`AQ.`** (newer). Both work with this API.
3. Render → **boon-hua-fishery** → **Environment** → add:

   | Key | Value |
   |-----|--------|
   | `GEMINI_API_KEY` | paste your **AIza…** or **AQ.…** key |

4. **Save** → **Manual Deploy** → wait for **Live**.
5. Verify in a browser:
   - `https://boon-hua-fishery.onrender.com/` → `"aiRecipes": true` and `"ai": {"enabled": true, "provider": "gemini"}`
   - `https://boon-hua-fishery.onrender.com/recipes/ai-status` → same `enabled` / `provider`

**Never** commit API keys to GitHub. Revoke any key that was pasted in chat and create a new one.

Without a key, Meal Ideas use TheMealDB / local recipes; AI Chef chat returns 503.

### If users see “429 too many requests”

The free Gemini plan limits requests per minute and per day. All app users share one `GEMINI_API_KEY` on Render.

**Quick fixes**

1. Wait 1–2 minutes between chats (the mobile app shows a **try again in X seconds** countdown after 429).
2. Avoid hammering **Meal Ideas** and **AI Chef** while testing — each tap calls Gemini.

**Upgrade quota (recommended for production)**

1. Open [Google AI Studio](https://aistudio.google.com/) → **Settings** / **Billing** (or Google Cloud console linked to the same project).
2. Enable **billing** on the Google Cloud project tied to your API key.
3. In AI Studio, check **usage & limits** for your key.

**Use a lighter model (free tier, more headroom)**

On Render → **Environment**, add:

| Key | Value |
|-----|--------|
| `GEMINI_MODEL` | `gemini-2.0-flash-lite` |

Save → **Manual Deploy**. Slightly simpler answers, often higher free limits than `gemini-2.0-flash`.

**Backup: OpenAI when Gemini is busy**

The server tries **Gemini first**, then **OpenAI** if Gemini fails.

1. Create a key at [OpenAI API keys](https://platform.openai.com/api-keys).
2. On Render → **Environment**, add:

| Key | Value |
|-----|--------|
| `OPENAI_API_KEY` | `sk-…` your key |

(Optional) `OPENAI_MODEL` = `gpt-4o-mini` (default).

3. **Save** → **Manual Deploy**.

Keep `GEMINI_API_KEY` as primary; OpenAI is used automatically when Gemini returns errors (including rate limits after retries).

## 5. Firebase (`firebase: true` on `/`)

The **web admin** and **mobile app** already use Firebase directly (Auth + Firestore).  
`firebase: true` on the API only enables the **backend REST inventory routes** (`GET/POST /inventory`, etc.). AI recipes work without it.

### Step 1 — Download service account JSON

1. Open [Firebase Console](https://console.firebase.google.com) → project **`boon-hua-fishery`** (same project as your apps).
2. **Project settings** (gear) → **Service accounts**.
3. Click **Generate new private key** → download `firebase_credentials.json`.
4. **Never** commit this file to GitHub (it is in `.gitignore`).

### Step 2 — Add to Render

1. Render → **boon-hua-fishery** → **Environment**.
2. Add:

   | Key | Value |
   |-----|--------|
   | `FIREBASE_CREDENTIALS_JSON` | Paste the **entire** JSON file contents (one line is fine) |

3. **Save** → **Manual Deploy** → wait for **Live**.

### Step 3 — Verify

1. **Logs** should show: `SUCCESS: Connected to Firebase Firestore!`  
   (If you still see `WARN: No Firebase credentials`, the env var name is wrong or empty.)
2. Browser: `https://boon-hua-fishery.onrender.com/` → `"firebase": true`.

### Local development

Place `firebase_credentials.json` in `boon_hua_backend/` **or** set `FIREBASE_CREDENTIALS_JSON` in a local `.env` (see `.env.example`).

## 6. Test

Open in a browser:

- `https://boon-hua-fishery.onrender.com/`  
  Expected when AI + Firebase are configured:

```json
{
  "status": "Online",
  "message": "Boon Hua Fishery API is running",
  "firebase": true,
  "aiRecipes": true,
  "ai": {
    "enabled": true,
    "provider": "gemini",
    "statusPaths": ["/recipes/ai-status", "/recipes/aistatus"]
  },
  "aiStatus": "/recipes/ai-status",
  "docs": "/docs",
  "health": "/health"
}
```

- `aiRecipes: false` → add `GEMINI_API_KEY` (section 4) and redeploy.
- `firebase: false` → add `FIREBASE_CREDENTIALS_JSON` (section 5) and redeploy.

- `https://boon-hua-fishery.onrender.com/docs`  
  Expected: FastAPI Swagger page

If you still see **Not Found**, check:

- Service type is **Web Service**, not Static Site
- **Start Command** is exactly `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Root Directory** points to where `main.py` lives
- Deploy logs show no crash on startup

## 7. ML sales forecast (`/sales/forecast`)

The admin **Overview → Sales prediction** card calls `POST /sales/forecast`. The deployed API must include:

- `sales_forecast_ml.py`
- `numpy` and `scikit-learn` in `requirements.txt`

### Verify production

```powershell
curl.exe -s -X POST "https://boon-hua-fishery.onrender.com/sales/forecast" `
  -H "Content-Type: application/json" `
  -d "{\"daily\":[{\"date\":\"2026-05-01\",\"revenue\":100},{\"date\":\"2026-05-02\",\"revenue\":120},{\"date\":\"2026-05-03\",\"revenue\":90}]}"
```

| Response | Meaning |
|----------|---------|
| JSON with `"source": "ml"` or `"ml-baseline"` | ML endpoint is live |
| `{"detail":"Not Found"}` | **Redeploy** — Render is running an old build without this route |

After redeploy, `GET /` should also include `"salesForecast": "/sales/forecast"`.

### Redeploy steps

1. Push latest `boon_hua_backend` to GitHub (include `sales_forecast_ml.py`).
2. Render → **boon-hua-fishery** → **Manual Deploy** → **Deploy latest commit**.
3. **Logs** → confirm `pip install` includes `scikit-learn` and no import errors.
4. Re-run the `curl` test above.

### Admin dashboard

Record sales under **Sales** for at least **3 different days** with RM totals. Open **Overview** — the prediction card should show **Gradient boosting (scikit-learn)**, not **offline fallback**.

## 8. Admin web app

**Settings → Mobile Recipe API** → save:

`https://boon-hua-fishery.onrender.com`

(no trailing slash)

This URL is used for **recipes** and **sales forecast** (same `app_config/public` field).

This is **not** your React admin website URL and **not** TheMealDB.
