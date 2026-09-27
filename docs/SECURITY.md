# Security

## Authentication

- Supabase Auth (email + password, email confirmation supported via `/auth/callback` and `/auth/confirm`).
- `src/middleware.ts` refreshes the session and verifies the JWT with `auth.getClaims()` on every request; unauthenticated page requests redirect to `/login`, API requests get `401`. `/api/jobs/run` authenticates with a shared secret instead.
- Sign-in and sign-up are rate limited per IP/email.

## Authorization & tenant isolation

Defence in depth — three independent layers:

1. **Server code** — every server action/route calls `requireOrgContext(minRole)` (membership + role from the database, active org from an httpOnly cookie validated against memberships), then validates input with zod.
2. **Row Level Security** — enabled on every table. Policies use `has_org_role(organization_id, role)` (SECURITY DEFINER, fixed `search_path`). Viewers read; editors create/update/generate/review; admins delete and manage settings/members; owners manage owners.
3. **Grants & constraints** — `anon` has no table access. Column-level grants stop clients from repointing storage paths or writing QC/job state; users can only *insert* queued jobs (policy checks `status`, `attempts`, `created_by`) and cancel via `cancel_job()`. `organization_id` is immutable (trigger). Storage paths must start with the row's organization id (CHECK). Model profiles require `adult_confirmed = true` (CHECK).

The **service role** (`SUPABASE_SECRET_KEY`) is used only in trusted server code: the worker, audit logging, rate limiting, signed upload URL creation (after authorization), and membership management (after an admin check). Service-role queries always filter by `organization_id`; handler tests assert that cross-tenant references are refused before any provider call.

Tenant isolation is covered by `tests/db/rls.test.ts`, `tests/db/queue.test.ts` and the PostgREST end-to-end test.

## Storage

- Single **private** bucket `studio-assets` with MIME allow-list; keys are `<organization_id>/...`.
- Storage RLS allows read for members and write/delete for editors of the org named in the first path segment.
- Browsers receive short-lived (30 min) signed URLs created **with the user's client**, so storage RLS decides access.
- Uploads: server issues a signed upload URL for a server-generated path only after checking role, target ownership, declared MIME and size; after upload, `finalize*` re-downloads the object, sniffs magic bytes (JPEG/PNG/WebP only — SVG/HTML rejected), enforces ≤25 MB and 256–12,000 px, decodes it with sharp (pixel limit), hashes it, and deletes it if invalid. Paths are validated with a strict regex (no traversal, no other org/entity).
- Originals are never modified; generated media is written to separate paths.

## Secrets

- Only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key reach the browser. Gemini keys and the Supabase secret key are server-only (`import "server-only"` guards the modules that read them).
- Error messages stored on jobs and shown to users are passed through `sanitizeErrorMessage` (redacts Google API keys, bearer tokens, Supabase keys, `key=` query params). Unknown errors are logged server-side and replaced by a generic message.
- Logs are structured JSON lines with job/org/provider IDs — no prompts, image data or credentials.
- The worker endpoint compares secrets with `timingSafeEqual`.

## Abuse controls

- Postgres-backed fixed-window rate limits (shared across instances): generation, analysis, uploads, exports, mutations, auth.
- Per-shoot cap (40 images), reference cap, export cap (100 files), optional hard monthly budget.
- Worker concurrency cap across all workers (`claim_jobs(max_active)`).

## Content safety

- Adult-only model profiles enforced in DB and UI; prompts carry a non-explicit commercial baseline; Veo requests use `personGeneration: allow_adult` and a negative prompt; provider safety blocks are surfaced as permanent failures (never retried in a loop).
- All outputs require human approval; exports default to approved items only; nothing is pushed to a storefront.

## Audit

`audit_logs` records organization creation, product/asset/model changes, shoots, analysis requests, reviews, regenerations, retries, cancellations, video actions, exports, settings and membership changes. Readable by admins in **Settings**.

## HTTP hardening

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` on all responses; `robots: noindex`. HSTS is provided by Vercel. A nonce-based Content-Security-Policy is a recommended follow-up.

## Production checklist

- [ ] Email confirmation on; redirect URLs restricted to your domains
- [ ] `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, `BACKGROUND_JOB_SECRET`, `CRON_SECRET` set only in server env
- [ ] Migrations applied; `studio-assets` bucket is private
- [ ] Budget + hard limit configured; provider quota alerts set in Google Cloud
- [ ] Only trusted admins; periodic review of the audit log and members
