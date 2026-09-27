# AGENTS.md — working on this repository

Guidance for human contributors and coding agents.

## Ground rules

- **No fake success.** Never add simulated provider responses, placeholder buttons or hardcoded results to application code. Mocks live only in `tests/` (see `tests/fixtures/README.md`).
- **Verify provider APIs** against official docs or the installed SDK typings (`node_modules/@google/genai/dist/genai.d.ts`) before using a model ID, parameter or method. Record what you verified in `docs/API_PROVIDERS.md`.
- **Tenant isolation first.** Every tenant table has `organization_id`, RLS policies, and (where applicable) column grants. Server code using the service role (`getSupabaseAdmin()`) must filter by `organization_id` explicitly.
- **Secrets stay on the server.** Only `NEXT_PUBLIC_*` values may reach the browser. Provider calls happen in the worker or server actions.
- **Long work goes through the queue.** Never call a generation provider inside a request/response cycle; enqueue a job (`enqueueJobs`) and let the worker process it.

## Layout

```
src/app/(auth)        login/signup          src/app/(studio)   studio pages (auth required)
src/app/api           export, worker, health
src/server/actions    "use server" mutations (authz + zod + audit)
src/server/jobs       queue: enqueue/insert, worker, policy (pure), handlers/*
src/server            context (session/org/role), storage, rate-limit, audit, errors
src/lib/domain        pure logic: schemas, prompts, analysis contracts, jobs policy, costs, files
src/lib/providers     provider interfaces + Gemini (image/vision) + Veo (video) + registry
src/config/pricing.ts pricing assumptions (estimates only)
supabase/migrations   schema, RLS, queue functions, storage policies, reporting
tests/                unit, db (real Postgres), e2e (PostgREST), integration (live, opt-in)
```

## Conventions

- **No hardcoded UI text.** Every user-visible string lives in `src/lib/i18n/dictionaries/en.ts` and `tr.ts` (TypeScript + `tests/unit/i18n.test.ts` enforce identical keys and `{placeholders}`). Server components use `await getI18n()`, client components `useI18n()`, page titles `pageMetadata((d) => …)`; format dates/money with the `locale` argument.
- User-facing errors are keys: `throw new UserFacingError("productNotFound", { … })`; custom zod messages are `d.validation` keys. Stored enum values stay English in the database and are translated at render time (`d.enums.*`).
- Validate all input with zod schemas from `src/lib/domain/schemas.ts`.
- Server actions: `requireOrgContext(minRole)` → `enforceRateLimit` → validate → query with the user's client (RLS) → `audit()` → `revalidatePath`. Return `ActionResult` via `runAction`/`toActionError`; only `UserFacingError`, `AuthorizationError`, `ConfigError`, `RateLimitError` messages reach users.
- New job type: add to the `job_type` enum (migration), `JOB_TYPES`, a handler in `src/server/jobs/handlers`, and register it in `HANDLERS`. Handlers throw `ProviderError` with a classification; the worker decides retry vs fail.
- New provider: implement the interface in `src/lib/providers/types.ts` and select it in `registry.ts` via server env.
- Schema changes: add a new timestamped file in `supabase/migrations` (never edit applied migrations), extend `tests/db/*`, re-grant function execute rights (functions default to PUBLIC execute).

## Before you push

```bash
npm run typecheck && npm run lint && npm test && npm run build
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres POSTGREST_BIN=/path/to/postgrest npm run test:db
```
