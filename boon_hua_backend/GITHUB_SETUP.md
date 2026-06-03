# Push all 3 projects to GitHub (monorepo)

Repo: **https://github.com/kesin0414/boon_hua_fishery.git**

Use one repository with three folders:

```text
boon_hua_fishery/
├── README.md
├── .gitignore
├── boon_hua_backend/    ← Render deploys this folder
├── boonhua_web/         ← Admin React app
└── boon_hua_mobile/     ← Flutter consumer app
```

## Step 1 — Create the monorepo folder on your PC

In PowerShell (adjust paths if your folders live elsewhere):

```powershell
mkdir C:\Users\user\boon_hua_fishery
cd C:\Users\user\boon_hua_fishery
git init
```

Copy or move your three project folders **into** `boon_hua_fishery` (names must match Render settings):

```powershell
# If folders are siblings under C:\Users\user\
Copy-Item -Recurse C:\Users\user\boon_hua_backend .\boon_hua_backend
Copy-Item -Recurse C:\Users\user\boonhua_web .\boonhua_web
Copy-Item -Recurse C:\Users\user\boon_hua_mobile .\boon_hua_mobile
```

Do **not** copy `boon_hua_backend\venv` or `node_modules` (gitignore excludes them).

## Step 2 — Root `.gitignore`

Create `boon_hua_fishery\.gitignore` with:

```gitignore
# Python
**/venv/
**/.venv/
**/__pycache__/
**/.env
**/firebase_credentials.json

# Node
**/node_modules/
**/dist/

# Flutter
**/.dart_tool/
**/build/

# OS / IDE
.DS_Store
Thumbs.db
.idea/
.vscode/
```

## Step 3 — First commit and push

```powershell
cd C:\Users\user\boon_hua_fishery
git add .
git status
git commit -m "Add backend, web admin, and mobile app"
git branch -M main
git remote add origin https://github.com/kesin0414/boon_hua_fishery.git
git push -u origin main
```

If the repo already has a README on GitHub:

```powershell
git pull origin main --rebase
# fix conflicts if any, then:
git push -u origin main
```

## Step 4 — Render (backend only)

1. Render → **New Web Service** → connect **boon_hua_fishery**
2. **Root Directory:** `boon_hua_backend`
3. **Build:** `pip install -r requirements.txt`
4. **Start:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. **Health check:** `/`
6. Env var **`FIREBASE_CREDENTIALS_JSON`** = contents of `firebase_credentials.json` (optional for Meal Ideas)

After deploy, test: `https://boonhua-api.onrender.com/`

## Step 5 — Admin web (optional hosting)

`boonhua_web` is Vite + React. Build locally or deploy to Vercel/Netlify/Firebase Hosting:

```powershell
cd boonhua_web
npm install
npm run build
```

Render is for the **Python API**, not usually the React admin (unless you add a static site service).

## Folder name note

Your web folder is **`boonhua_web`** (no underscore). Keep that name in the repo so paths stay consistent.
