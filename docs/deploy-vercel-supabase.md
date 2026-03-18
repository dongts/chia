# Deploy Chia to Vercel + Supabase

This guide deploys Chia as two Vercel projects (frontend + backend API) with Supabase PostgreSQL.

## 1. Set Up Supabase Database

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Name: `chia`, set a **database password** (save it!), pick a region close to you
3. Wait for the project to be provisioned
4. Go to **Project Settings → Database**
5. Copy the **Connection string (URI)** — choose the **Session pooler** (port 5432) mode
6. It looks like: `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-xx-xxxx.pooler.supabase.com:5432/postgres`
7. Replace `postgresql://` with `postgresql+asyncpg://` for our driver

Your final connection string:
```
postgresql+asyncpg://postgres.xxxx:[YOUR-PASSWORD]@aws-0-xx-xxxx.pooler.supabase.com:5432/postgres
```

### Run Migrations

From your local machine, set the Supabase URL and run Alembic:

```bash
cd backend
source venv/bin/activate

# Temporarily set the URL for migration (replace with your actual string)
export CHIA_DATABASE_URL="postgresql+asyncpg://postgres.xxxx:PASSWORD@aws-0-xx-xxxx.pooler.supabase.com:5432/postgres"

alembic upgrade head
```

This creates all tables in Supabase. You only need to do this once (and again when you add new migrations).

## 2. Deploy Backend to Vercel

### Create the Vercel project

```bash
cd backend

# Install Vercel CLI if needed
npm i -g vercel

# Deploy
vercel

# Follow prompts:
# - Link to existing project? No → create new
# - Project name: chia-api
# - Framework: Other
# - Root directory: ./  (keep default)
```

### Set Environment Variables

In the Vercel dashboard for `chia-api`, go to **Settings → Environment Variables** and add:

| Variable | Value |
|----------|-------|
| `CHIA_DATABASE_URL` | `postgresql+asyncpg://postgres.xxxx:PASSWORD@aws-0-xx-xxxx.pooler.supabase.com:5432/postgres` |
| `CHIA_JWT_SECRET` | A random string (generate with: `openssl rand -hex 32`) |
| `CHIA_SERVERLESS` | `true` |
| `CHIA_USE_CONNECTION_POOLER` | `true` |
| `CHIA_CORS_ORIGINS` | `["https://chia-app.vercel.app"]` (replace with your frontend URL) |

Then redeploy:

```bash
vercel --prod
```

Your API is now live at `https://chia-api.vercel.app` (or whatever Vercel assigns).

Test it: `curl https://chia-api.vercel.app/health`

## 3. Deploy Frontend to Vercel

### Create the Vercel project

```bash
cd frontend

vercel

# Follow prompts:
# - Project name: chia-app
# - Framework: Vite (auto-detected)
# - Root directory: ./
```

### Set Environment Variables

In the Vercel dashboard for `chia-app`, go to **Settings → Environment Variables** and add:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://chia-api.vercel.app/api/v1` (your backend URL) |

Then redeploy:

```bash
vercel --prod
```

Your app is now live at `https://chia-app.vercel.app`.

## 4. Update Backend CORS

After you know the frontend URL, update the `CHIA_CORS_ORIGINS` env var on the backend Vercel project:

```
["https://chia-app.vercel.app"]
```

Redeploy the backend: `cd backend && vercel --prod`

## 5. Verify

1. Open `https://chia-app.vercel.app`
2. Register an account or try as guest
3. Create a group, add members, add an expense
4. Check balances

## Updating

After code changes:

```bash
# Backend
cd backend && vercel --prod

# Frontend
cd frontend && vercel --prod
```

Or connect both Vercel projects to your GitHub repo for automatic deploys on push.

## Cost Summary (Free Tier)

| Service | Plan | Cost |
|---------|------|------|
| Vercel (frontend) | Hobby | $0 |
| Vercel (backend) | Hobby | $0 |
| Supabase (database) | Free | $0 |
| **Total** | | **$0/mo** |

Note: Hobby plan is for personal/non-commercial use only.
