# Pandiones AI Fashion Studio

An internal studio for Pandiones that turns product photos into reviewed e‑commerce imagery and product videos:

**upload product → analyse → choose adult model & shoot style → generate variations → automated QC screening → human review → video → export**

Built as a multi‑tenant application from day one (organizations, memberships, Row Level Security), so it can later become a SaaS product.

| Layer | Technology |
| --- | --- |
| App | Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui‑style components (Radix) |
| Data | Supabase Postgres + Auth + private Storage, RLS on every tenant table |
| AI | Google Gen AI SDK (`@google/genai`): Gemini image generation, Gemini vision (analysis + QC), Veo video (optional) |
| Jobs | Durable Postgres queue (`generation_jobs` + `claim_jobs()` with `SKIP LOCKED` leases) processed by `/api/jobs/run` (Vercel Cron) or `npm run worker` |

## Quick start

```bash
npm install
cp .env.example .env.local          # fill in Supabase + Gemini values
npm run db:apply                    # or: supabase db push   (applies supabase/migrations)
npm run providers:models            # verify the Gemini/Veo model IDs you configured
npm run dev                         # http://localhost:3000
npm run worker                      # second terminal: processes background jobs
```

Sign up, create your organization, add a product, upload reference photos, and start a shoot. Full instructions: [docs/SETUP.md](docs/SETUP.md).

## Features

- **Create canvas (photo sessions)** — a Flow-style home: drop garment photos into the prompt bar, pick a random fictional model, an existing profile or upload a model photo (18+ and consent confirmation required), choose locations and a photo count, and start the shoot. The server plans varied shots (commerce views first, then poses, camera angles, framings and locations; seeded so retries are idempotent), one background job per photo, and results drop onto the canvas as they finish. "Cast a new model" first generates a front-facing portrait of a fictional adult female model (random persona, realism cues), shows it for approval and saves it as the model's identity reference so every photo keeps the same face; "Quick random model" skips the preview (text persona only, identity can drift). Sessions render at 2K (native; FLUX max 1920 px) or 4K (2K output upscaled with Lanczos, recorded as `upscaled`).
- **Product library** — SKU/title/category/color/size/tags/status, search (trigram), filters, sorting, pagination; multiple reference images per product with roles (front/back/side/detail/fabric); drag‑and‑drop and **bulk import** by file name (`SKU_role.jpg`) with per‑file progress and errors; content‑hash duplicate detection; originals are never overwritten.
- **AI product analysis** — Gemini vision with a JSON response schema, re‑validated with zod; confidence levels, uncertainties and missing angles; results are shown as *unverified* and a human confirms/corrects **verified attributes**, which are what shoots treat as facts.
- **Model library** — adult‑only profiles (enforced in the database), appearance/styling/lighting, consent notes, uploaded or generated reference portraits (approve → add to references), and a consistency view comparing shots against the primary reference.
- **Shoot presets & configuration** — built‑in catalog/back/side/three‑quarter/detail/editorial/campaign presets, org presets (duplicate/edit), pose, camera angle, framing, background, lighting, aspect ratio, resolution, variations; product constraints are kept separate from creative direction in the prompt.
- **Generation engine** — provider‑independent interfaces; Gemini `generateContent` with labelled reference images, `responseModalities: [TEXT, IMAGE]`, `imageConfig`; usage/cost capture, timeouts, error classification, retries with exponential backoff + jitter, concurrency limits, cancellation.
- **Quality review** — automated QC screening compares each output with the references (colour, missing/altered elements, patterns, silhouette, garment count, artefacts, identity, background/framing) as a *signal*; humans approve/reject with notes, compare source vs output, see settings/prompt/cost, and regenerate with feedback. Nothing is published automatically.
- **Durable queue** — idempotency keys, explicit state machine enforced by a DB trigger, leases for crash recovery, per‑job progress, attempts, provider request IDs, errors and timestamps; live queue UI with cancel/retry.
- **Video studio** — product videos from one approved image, advertising videos from a brief (+ reference images where the model supports it); long‑running Veo operations are submitted and polled by the worker; preview, download, approval. Disabled until a verified provider is configured.
- **Media library** — filters (SKU, type, approval, model, campaign, provider, date), previews, bulk ZIP export with `manifest.csv`/`manifest.json` and safe file names, storage usage report; private bucket with short‑lived signed URLs.
- **Costs** — usage ledger per call (tokens, units, request ID) with *actual* vs *estimated* vs *unknown* kept separate; cost per image/video/product, daily spend, failed‑generation cost, model breakdown, monthly budget with alert threshold and optional hard limit; pricing assumptions are configurable and flagged as unverified until checked.
- **Languages** — full Turkish and English UI (Türkçe / English), chosen per browser (cookie) with `Accept-Language` fallback; server errors, validation messages, dates and currency are localized, and AI-written analysis/QC text follows the requester's language. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#internationalization-i18n).
- **Security** — Supabase Auth, protected routes, server‑side authorization on every action, RLS + column grants, org‑prefixed storage policies, upload sniffing and limits, Postgres‑backed rate limiting, audit log, secret redaction. See [docs/SECURITY.md](docs/SECURITY.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run worker` | Standalone background worker loop (local dev / self‑hosting) |
| `npm run typecheck` · `npm run lint` | Static checks |
| `npm test` | Unit tests; DB/E2E tests run when `TEST_DATABASE_URL` (+ `POSTGREST_BIN`) are set |
| `npm run test:db` | Database RLS/queue tests + PostgREST end‑to‑end tests |
| `npm run test:integration` | Live Gemini tests (needs credentials; billed) |
| `npm run db:apply` | Apply SQL migrations to `DATABASE_URL` |
| `npm run providers:models` | List/verify Gemini & Veo model IDs for your key |
| `npm run check` | typecheck + lint + test + build |

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — Supabase, environment, migrations, local dev, deployment
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data model, job lifecycle
- [docs/API_PROVIDERS.md](docs/API_PROVIDERS.md) — Gemini & Veo integration, model configuration, what was verified
- [docs/SECURITY.md](docs/SECURITY.md) — tenancy, RLS, uploads, secrets
- [docs/COSTS.md](docs/COSTS.md) — usage ledger, estimates, pricing configuration, budgets
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — worker scheduling, monitoring, troubleshooting, limitations
- [AGENTS.md](AGENTS.md) — conventions for contributors and coding agents

## Content policy

All models depicted are adults (the database rejects profiles without adult confirmation and the UI rejects age ranges under 18). Prompts always include a professional, non‑explicit commercial‑photography baseline. Every output requires human approval before use.
