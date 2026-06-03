# Deploy Boon Hua API to Render

If `https://boonhua-api.onrender.com` shows **Not Found**, the Python API is **not running** on Render yet. Saving the URL in the admin web app only tells phones where to call — you must deploy this folder first.

## 1. Push code to GitHub

Upload `boon_hua_backend` (include `main.py`, `requirements.txt`, `recipes_data.py`, `themealdb_service.py`).  
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

## 3. Firebase (for inventory routes; optional for Meal Ideas)

Meal Ideas (`/recipes/suggest`) works **without** Firebase. Inventory needs Firebase.

1. Open your service → **Environment**
2. Add variable **`FIREBASE_CREDENTIALS_JSON`**
3. Paste the **entire** contents of `firebase_credentials.json` (one line JSON is fine)

## 4. Test

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

## 5. Admin web app

**Settings → Mobile Recipe API** → save:

`https://boonhua-api.onrender.com`

(no trailing slash)

This is **not** your React admin website URL and **not** TheMealDB.
