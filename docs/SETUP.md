# Setup

## Prerequisites

- Node.js ≥ 20.9 (22 LTS recommended), npm
- A Supabase project (cloud) — or a self-hosted Supabase stack
- A Google Gemini API key (Google AI Studio) with billing enabled for image/video models

## 1. Supabase

1. Create a project. In **Project Settings → API Keys** copy the project URL, a **publishable** key and a **secret** key.
   Legacy `anon` / `service_role` JWT keys also work (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
2. **Auth → URL configuration**: set the Site URL to your app URL and add `https://<your-app>/auth/callback` (and `http://localhost:3000/auth/callback`) to the redirect allow list. Email/password sign-in is used; keep email confirmation enabled for production.
3. Apply the migrations (creates tables, RLS, functions, the private `studio-assets` bucket, storage policies and built-in presets):

   ```bash
   # Option A — Supabase CLI
   supabase link --project-ref <ref>
   supabase db push

   # Option B — this repo's script (direct/session connection string from "Connect")
   DATABASE_URL="postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres" npm run db:apply
   ```

   Migrations (in order): `20260927000001_core_schema.sql`, `…02_rls_and_queue.sql`, `…03_storage_and_presets.sql`, `…04_reporting.sql`, `…05_function_search_path.sql`, `…06_job_dismissal.sql`.

## 2. Environment

```bash
cp .env.example .env.local
```

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `BACKGROUND_JOB_SECRET` (`openssl rand -hex 32`), `GEMINI_API_KEY` (analysis/QC; the free tier works), and an image provider:
- **Free:** `IMAGE_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Cloudflare dashboard → Workers AI → *Use REST API* → create a Workers AI token). FLUX.2 [klein] 4B, 10,000 free neurons/day. See [API_PROVIDERS.md](API_PROVIDERS.md).
- **Gemini:** `GEMINI_IMAGE_MODEL` (Gemini image models have no free-tier API quota; enable billing on the key's project).
Recommended: `APP_URL`, `GEMINI_ANALYSIS_MODEL` (pinned), `CRON_SECRET` (Vercel).
Optional: video (`VIDEO_PROVIDER`, `VIDEO_MODEL`, …), tuning, `PRICING_OVERRIDES_JSON`. Every variable is documented in `.env.example`.

Verify model IDs against your key **before** using them:

```bash
npm run providers:models
```

The app validates configuration at the boundary that needs it: missing Supabase config redirects to `/setup`; missing Gemini config disables generation with an explanation instead of failing silently.

## 3. Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run worker     # separate terminal — processes the job queue
```

Sign up → create an organization → **Products → New product** → upload references → **Analyze images** → **New shoot** → watch **Jobs** → approve in **Review** → **Make video** (if configured).

## 4. Deploy (Vercel)

1. Import the repository; framework preset Next.js.
2. Add all environment variables (Production + Preview). Set `APP_URL` to the production URL and `CRON_SECRET` to a random value.
3. `vercel.json` schedules a daily safety-net `GET /api/jobs/run` (valid on every plan). For timely processing add a per-minute trigger: Supabase `pg_cron` + `pg_net`, an external scheduler, or on Vercel Pro change the schedule to `* * * * *` (see [OPERATIONS.md](OPERATIONS.md#scheduling-the-worker)). Point triggers at the production domain: preview/deployment URLs are behind Vercel Authentication by default.
4. `/api/jobs/run` and `/api/export` declare `maxDuration = 300`. Ensure your plan allows it (Fluid compute) or lower `GEMINI_REQUEST_TIMEOUT_MS` accordingly.
5. After deploying, open **Settings → Verify provider models now** as an admin.

Self-hosting: `npm run build && npm start` for the web app and run `npm run worker` as a separate long-lived process (several instances are fine).

## 5. Tests

```bash
npm test                                  # unit tests (DB/E2E suites skip without env)
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
POSTGREST_BIN=/path/to/postgrest npm run test:db   # RLS, queue, PostgREST end-to-end
RUN_PROVIDER_INTEGRATION=1 npm run test:integration # live Gemini (billed)
```

`TEST_DATABASE_URL` must be a superuser connection to a **disposable** Postgres ≥ 15; each run creates and drops its own database. PostgREST binaries: https://github.com/PostgREST/postgrest/releases.
