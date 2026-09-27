# Architecture

## Overview

```
Browser ──(Supabase Auth cookie)──► Next.js (App Router, Vercel)
  │  direct upload via signed URL           │ server components: reads with the user's Supabase client (RLS)
  ▼                                         │ server actions: authz + zod + rate limit + audit → enqueue jobs
Supabase Storage (private bucket)           ▼
  ▲                                   Postgres (Supabase) ── generation_jobs (durable queue)
  │ service role (worker only)              ▲      │ claim_jobs(): SKIP LOCKED + leases
  └──────────── Worker ─────────────────────┘      ▼
        /api/jobs/run (Vercel Cron, POST kick after enqueue)   or   `npm run worker`
                │
                ├─ Gemini generateContent (image generation, vision analysis, QC)
                └─ Veo generateVideos + operations.getVideosOperation (polling)
```

## Modules

| Module | Code | Notes |
| --- | --- | --- |
| Auth & tenancy | `src/middleware.ts`, `src/server/context.ts`, `src/server/actions/auth.ts` | `getClaims()` verification, active org cookie, roles viewer < editor < admin < owner |
| Products | `src/app/(studio)/products/**`, `src/server/actions/products.ts` | CRUD, uploads, bulk import, analysis request, verified attributes |
| Uploads | `components/studio/upload-client.ts`, `server/storage.ts` | signed upload URL → browser upload → server `finalize*` sniffs bytes, checks size/dimensions, hashes, builds WebP thumbnail |
| Analysis | `handlers/analysis.ts`, `lib/domain/analysis.ts` | JSON schema + zod; stored in `products.ai_analysis` (unverified); humans save `verified_attributes` |
| Models | `src/app/(studio)/models/**`, `server/actions/models.ts`, `handlers/model-portrait.ts` | reference images, portrait generation, promote approved portraits |
| Shoots | `src/app/(studio)/shoots/new`, `server/actions/generation.ts#createShoot` | one job per shot type × variation (max 40 per submission) |
| Image generation | `handlers/image-generation.ts`, `lib/providers/gemini/*` | labelled references, prompt from `lib/domain/prompts.ts`, stores result + thumbnail, enqueues QC |
| QC | `handlers/quality-review.ts` | vision comparison vs references; flags + `qc_status` (screening only) |
| Review | `review/`, `results/[id]` | approve / reject / notes / regenerate with feedback |
| Video | `video/**`, `server/actions/video.ts`, `handlers/video-generation.ts` | submit → poll → download → store; approval |
| Library & export | `library/`, `api/export` | filters, signed URLs, streamed ZIP with manifests |
| Costs | `costs/`, `lib/domain/costs.ts`, `config/pricing.ts`, `jobs/usage.ts` | ledger + SQL aggregation functions |
| Settings | `settings/`, `server/actions/settings.ts` | budget, members, live provider verification, queue health, audit log |

## Data model

All tables use UUID primary keys, `created_at`, foreign keys and indexes; every tenant table carries `organization_id` (immutable via trigger).

| Table | Purpose |
| --- | --- |
| `organizations`, `organization_members` | tenants, roles, budget settings |
| `products`, `product_assets` | catalog items and original reference images (`role`, `sha256`, dimensions, thumbnail) |
| `model_profiles`, `model_profile_assets` | adult model profiles (`adult_confirmed` CHECK) and their references |
| `shoot_presets` | `organization_id NULL` = built-in (read-only) |
| `generation_jobs` | durable queue; status, progress, attempts, lease, provider request/operation, errors, config snapshot, `idempotency_key` (unique per org) |
| `generation_results` | generated images/videos, prompt, settings, review and QC fields, lineage (`parent_result_id`) |
| `video_projects` | video briefs, specs, status, approval |
| `usage_ledger` | one row per provider call; tokens, units, cost amount, `cost_source` (`provider_reported`/`estimated`/`unknown`), pricing reference |
| `audit_logs` | important actions (service-role writes, admin reads) |
| `rate_limits` | fixed-window counters (service-role only) |

SQL functions: `has_org_role`, `create_organization`, `cancel_job`, `claim_jobs`, `rate_limit_hit`, `org_month_spend`, `usage_breakdown`, `usage_daily`, `usage_by_product`, `org_storage_usage`, `queue_health`.

## Job lifecycle

```
queued ──claim──► processing ──► succeeded
  │                   │  ├──► failed      (permanent error, or attempts exhausted)
  │                   │  ├──► cancelled   (cancel_requested honoured)
  │                   │  └──► queued      (transient error; run_after = now + backoff with jitter)
  └──► cancelled / failed
```

- **Enqueue**: server action inserts with the user's client (RLS: editor, `status='queued'`, `attempts=0`, `created_by=auth.uid()`), `ON CONFLICT (organization_id, idempotency_key) DO NOTHING`. Browser forms generate one idempotency key per submission, so double submits never duplicate work.
- **Claim**: `claim_jobs(worker, limit, lease, max_active)` locks runnable rows with `FOR UPDATE SKIP LOCKED`, sets `locked_by/locked_until`, increments `attempts` (not for polling a submitted operation), and caps concurrent provider calls across all workers. Expired leases are reclaimed; jobs whose lease expired on their last attempt fail with `lease_expired`.
- **Process**: `processJob()` runs the handler with an `AbortSignal` that fires before the lease ends. Every write is guarded by `locked_by = <this worker>`, so a late worker cannot overwrite a reclaimed job.
- **Long-running video**: the handler returns `pending` with the provider operation name; the job stays `processing` with `locked_by = NULL` and `locked_until = next poll time`, so any worker polls it later. Nothing depends on a browser tab or in-memory promise.
- **Transitions** are enforced by `enforce_job_transition()` (DB trigger) and mirrored in `lib/domain/jobs.ts`.

## Provider abstraction

`src/lib/providers/types.ts` defines `ImageGenerationProvider`, `VisionProvider` and `VideoGenerationProvider`. The registry picks implementations from server env (`GEMINI_*`, `VIDEO_PROVIDER`); tests inject fakes via `setProviderOverrides`. Handlers only see the interfaces, so a provider can be swapped without touching the workflow or UI.

## Scale notes

- Pagination everywhere (25–50 per page); thumbnails (512px WebP) for grids; lazy loading.
- Trigram indexes for SKU/title search; composite indexes for org-scoped listings and queue scanning (partial indexes on `queued`/`processing`).
- Cost and storage reporting aggregate in SQL (no row-limit issues).
- Throughput is bounded by `WORKER_MAX_CONCURRENCY` and provider quotas; 1,000 products × ~10 images/month ≈ 10k image jobs + QC ≈ 20k calls/month, i.e. well under one call per minute on average. Increase concurrency and run more worker instances to scale; the claim function is safe for any number of workers.

## Internationalization (i18n)

- Languages: Turkish (`tr`) and English (`en`). `src/lib/i18n/config.ts` resolves the language from the `pfs_locale` cookie, falling back to `Accept-Language`, then English. The language switcher (sidebar, mobile menu, sign-in, onboarding, setup) stores the cookie through the `setLocale` server action.
- Dictionaries: `src/lib/i18n/dictionaries/en.ts` defines the shape; `tr.ts` is typed against it, so a missing key is a compile error. `tests/unit/i18n.test.ts` also checks that `{placeholders}` match and that nothing is left untranslated by accident.
- Rendering: server components call `getI18n()`; the root layout passes the active dictionary to `I18nProvider` for client components (`useI18n()`); `<html lang>` and page titles follow the locale. Dates and money use `Intl` with `tr-TR` / `en-GB`.
- Errors: `UserFacingError` / `AuthorizationError` carry a dictionary key and variables; `toActionError` renders them in the requester's language (English text remains on `error.message` for logs). Zod custom messages are `d.validation` keys; zod's built-in messages are re-rendered with zod's Turkish locale. Upload validation (`lib/domain/files.ts`) returns keys so the browser and server share translations. Job error codes stored in the queue (`safety_filtered`, `reference_missing`, …) are explained in the UI via `d.jobErrors`, with the raw provider message shown as detail.
- AI text: product analysis and QC jobs store the requester's language in their config; prompts ask the model to write free-text fields in that language while keeping schema enum values in English (translated at render time). Image/video generation prompts stay in English for best model adherence; user-entered creative instructions may be in any language.
- Data: enum values in the database (statuses, roles, shot types …) are language-neutral English identifiers; only their labels are translated.
