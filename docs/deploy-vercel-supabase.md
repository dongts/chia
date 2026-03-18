# Deploy Chia: Vercel (Frontend) + Railway (Backend) + Supabase (Database)

**Cost: ~$5/mo** (Railway $5 with $5 credit, Vercel free, Supabase free)

## Architecture

```
[Vercel - Frontend]  →  [Railway - FastAPI Backend]  →  [Supabase - PostgreSQL]
    (free)                    ($5/mo)                       (free)
```

---

## 1. Supabase — Database

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Name: `chia`, set a **database password** (save it!), pick a region
3. Once provisioned, go to **Project Settings → Database**
4. Under **Connection string**, select **URI** and copy it
5. Choose **Session mode** (port 5432) — better for persistent connections
6. Replace `postgresql://` with `postgresql+asyncpg://` in the URL

Your connection string should look like:
```
postgresql+asyncpg://postgres.xxxx:[PASSWORD]@aws-0-xx-xxx.pooler.supabase.com:5432/postgres
```

### Run Migrations

```bash
cd backend
source venv/bin/activate
export CHIA_DATABASE_URL="postgresql+asyncpg://postgres.xxxx:PASSWORD@aws-0-xx-xxx.pooler.supabase.com:5432/postgres"
export CHIA_USE_CONNECTION_POOLER=true
alembic upgrade head
```

You should see all migrations applied. The default categories are seeded automatically when the backend starts.

---

## 2. Railway — Backend API

### Option A: Deploy via CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Create project
cd backend
railway init

# Add PostgreSQL is NOT needed — we use Supabase

# Set environment variables
railway variables set CHIA_DATABASE_URL="postgresql+asyncpg://postgres.xxxx:PASSWORD@aws-0-xx-xxx.pooler.supabase.com:5432/postgres"
railway variables set CHIA_JWT_SECRET="$(openssl rand -hex 32)"
railway variables set CHIA_USE_CONNECTION_POOLER=true
railway variables set CHIA_CORS_ORIGINS='["https://chia-app.vercel.app"]'

# Deploy
railway up
```

### Option B: Deploy via GitHub

1. Go to [railway.com](https://railway.com) → **New Project → Deploy from GitHub Repo**
2. Select your repo, set the **Root Directory** to `backend`
3. Railway auto-detects the Dockerfile and deploys
4. Go to **Variables** tab and add the env vars listed above
5. Go to **Settings → Networking → Generate Domain** to get a public URL

### Get Your Backend URL

Railway gives you a URL like `https://chia-api-production-xxxx.up.railway.app`.

Test it:
```bash
curl https://chia-api-production-xxxx.up.railway.app/health
# → {"status":"ok"}
```

---

## 3. Vercel — Frontend

### Deploy

```bash
cd frontend

# Install Vercel CLI if needed
npm i -g vercel

# Deploy
vercel

# Follow prompts:
# - Project name: chia-app
# - Framework: Vite (auto-detected)
```

### Set Environment Variables

In the Vercel dashboard for your frontend project → **Settings → Environment Variables**:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://chia-api-production-xxxx.up.railway.app/api/v1` |

Then redeploy to production:
```bash
vercel --prod
```

---

## 4. Connect Everything

### Update Backend CORS

Now that you know the frontend URL, update Railway:

```bash
cd backend
railway variables set CHIA_CORS_ORIGINS='["https://chia-app.vercel.app"]'
railway up
```

Or update it in the Railway dashboard → Variables.

### Verify

1. Open your frontend URL (e.g., `https://chia-app.vercel.app`)
2. Register an account
3. Create a group, add expenses
4. Check that balances calculate correctly

---

## Updating

### With GitHub (recommended)

Connect both Railway and Vercel to your GitHub repo. Every push to `master` auto-deploys both.

- Railway: Settings → Source → connect GitHub repo (root: `backend`)
- Vercel: Already connected if you deployed from GitHub

### Manual

```bash
# Backend
cd backend && railway up

# Frontend
cd frontend && vercel --prod
```

### New Migrations

When you add new database migrations:
```bash
cd backend
source venv/bin/activate
export CHIA_DATABASE_URL="your-supabase-url"
export CHIA_USE_CONNECTION_POOLER=true
alembic upgrade head
```

---

## Cost Breakdown

| Service | Plan | Monthly Cost |
|---------|------|-------------|
| Vercel (frontend) | Hobby | **$0** |
| Railway (backend) | Hobby ($5 includes $5 credit) | **~$5** |
| Supabase (database) | Free (500 MB, 50K MAU) | **$0** |
| **Total** | | **~$5/mo** |

Railway's $5 plan includes $5 usage credit. A FastAPI backend with light traffic typically stays within the credit, so your effective cost may be **$5/mo flat**.

---

## Environment Variables Reference

### Backend (Railway)

| Variable | Required | Description |
|----------|----------|-------------|
| `CHIA_DATABASE_URL` | Yes | Supabase PostgreSQL connection string (asyncpg) |
| `CHIA_JWT_SECRET` | Yes | Random secret for JWT signing |
| `CHIA_CORS_ORIGINS` | Yes | JSON array of allowed frontend origins |
| `CHIA_USE_CONNECTION_POOLER` | Yes | Set to `true` for Supabase |
| `CHIA_ACCESS_TOKEN_EXPIRE_MINUTES` | No | Default: 15 |
| `CHIA_REFRESH_TOKEN_EXPIRE_DAYS` | No | Default: 7 |

### Frontend (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Full backend API URL (e.g., `https://xxx.up.railway.app/api/v1`) |
