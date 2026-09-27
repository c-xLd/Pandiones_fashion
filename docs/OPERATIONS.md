# Operations

## Scheduling the worker

Jobs are rows in Postgres; *something* must call the worker regularly. Pick one (they can be combined safely — claims use `SKIP LOCKED` leases):

1. **Vercel Cron** — `vercel.json` ships with a **daily** safety-net run (`17 3 * * *`) so deployments succeed on every plan, including Hobby. On Pro/Enterprise you can change the schedule to `* * * * *` (every minute). Vercel sends `Authorization: Bearer $CRON_SECRET`. Each invocation processes jobs for up to ~150s plus in-flight work. **A daily run alone is not enough for normal use — add option 2 or 3.**
2. **External scheduler** (any plan, e.g. Vercel Hobby, which only allows daily crons):
   ```bash
   curl -fsS -X POST -H "Authorization: Bearer $BACKGROUND_JOB_SECRET" https://<app>/api/jobs/run
   ```
   from GitHub Actions (`schedule: - cron: "*/5 * * * *"`), an uptime monitor, or Supabase `pg_cron` + `pg_net`:
   ```sql
   select cron.schedule('pandiones-worker', '* * * * *', $$
     select net.http_post(url := 'https://<app>/api/jobs/run',
                          headers := jsonb_build_object('Authorization', 'Bearer <BACKGROUND_JOB_SECRET>'));
   $$);
   ```
3. **Long-running process** — `npm run worker` on a VM/container (Railway, Fly.io, ECS…). Loops continuously; handles SIGTERM gracefully. Run several for more throughput.

**Self-continuation:** every `/api/jobs/run` invocation checks, after its tick, whether work is still pending (queued jobs, retries waiting for backoff, video operations to poll). If so it re-triggers itself (after a 1–15s wait, via `after()` + `POST /api/jobs/run`). The chain stops by itself once the queue is empty, so a multi-photo session or a Veo video completes without a per-minute scheduler, even on Vercel Hobby. The create page also nudges the worker if queued jobs have waited more than 45s. Schedulers above remain the safety net if a chain breaks (e.g. a deploy mid-run).

Additionally, after a user enqueues jobs the server makes a best-effort `POST /api/jobs/run` (via `after()`, needs `APP_URL` or `VERCEL_URL`) so work usually starts within seconds. This is only an accelerator: if it fails, the scheduler picks the jobs up. If Vercel Deployment Protection is on for previews, the kick is blocked there; the scheduler still works.

## Monitoring

- **Jobs** page: live status, progress, attempts, errors, provider request IDs; warning banner when runnable jobs wait > 5 minutes (worker not scheduled?).
- **Settings → Queue health**: counts per status for the last 24h and oldest job.
- **Settings → Verify provider models now**: live `models.get` check of configured models.
- `GET /api/health`: liveness + whether config is present (no values).
- Logs: the worker prints one JSON line per event: `job started`, `job succeeded|pending|cancelled`, `job will retry`, `job failed` with `jobId`, `org`, `type`, `attempt`, `provider`, `model`, `code`, `requestId`. Tick summaries from `/api/jobs/run` are returned as JSON.

## Tuning

| Variable | Default | Effect |
| --- | --- | --- |
| `WORKER_MAX_CONCURRENCY` | 4 | provider calls in flight across **all** workers |
| `WORKER_BATCH_SIZE` | 4 | jobs claimed per round |
| `WORKER_LEASE_SECONDS` | 300 | crash-recovery delay; provider calls are aborted 30s before |
| `GEMINI_REQUEST_TIMEOUT_MS` | 120000 | per call; keep < lease − 30s and within `maxDuration` |
| `VIDEO_POLL_INTERVAL_SECONDS` | 15 | Veo polling cadence |

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Jobs stay `queued` | Is the worker scheduled? Call `/api/jobs/run` manually with the secret; look for `503` (config error) in the response. |
| `ConfigError … GEMINI_IMAGE_MODEL` | Set the env var on the **worker** environment too (standalone worker reads `.env.local`/process env). |
| `http_404` / model not found | Model ID retired or not enabled for the key → `npm run providers:models`. |
| `http_400` mentioning `imageSize` | Model does not support `imageConfig.imageSize` → `GEMINI_SEND_IMAGE_SIZE=false`. |
| `too_many_references` | Lower selected references or raise `GEMINI_MAX_REFERENCE_IMAGES` to the model's documented limit. |
| `http_429` retries | Quota reached → lower `WORKER_MAX_CONCURRENCY`, request quota increase. |
| `safety_filtered` / `blocked` | Provider refused the content; adjust prompt/references. Not retried automatically. |
| `lease_expired` | Worker died mid-call repeatedly (timeouts, OOM, platform kill) → check platform limits and `maxDuration`. |
| Upload "File content is not a valid…" | File extension/MIME spoofed or unsupported (e.g. HEIC) → convert to JPEG/PNG/WebP. |
| Budget error on generate | Monthly hard limit reached → Settings. |

## Storage lifecycle

- Originals (`<org>/products/*/source/*`), model references and approved results should be retained.
- Rejected results and failed partial uploads can be purged. Uploads that were never finalized (user closed the tab) are orphan objects without a DB row; clean them periodically, e.g. list objects under `*/source/` older than 24h without a matching `product_assets`/`model_profile_assets.storage_path`.
- Deleting a product removes its source images; generated results are kept and detached.
- Consider moving old videos to cheaper storage; the **Media library** shows usage per category.

## Backups & recovery

Use Supabase point-in-time recovery for the database. Storage objects are not covered by database PITR — replicate the bucket if required. Jobs are idempotent per key; after a restore, jobs left `processing` are reclaimed when their lease expires.

## Current limitations

- Provider documentation and pricing could not be verified from the build environment; see [API_PROVIDERS.md](API_PROVIDERS.md). Pricing defaults are marked unverified.
- Live provider calls were not executed during development (no credentials in the build environment); the integration test suite is ready to run with credentials.
- Automated QC is a model-based screen and will miss issues and raise false positives.
- Identity consistency across generations depends on the model's use of reference images and is not guaranteed.
- Video cancellation stops tracking but cannot cancel the provider operation.
- No storefront publishing integration (by design, exports are manual and approval-gated).
- Members can only be added if they already have an account (no invitation emails yet).
- No automatic purge job for orphaned uploads or rejected media yet (see lifecycle above).
