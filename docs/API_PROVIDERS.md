# AI providers

All provider calls run on the server (worker or server actions). Keys are read from server-only env vars and are never sent to the browser. Provider selection is configuration; handlers depend only on the interfaces in `src/lib/providers/types.ts`.

## What was verified, and how

The official documentation site (`ai.google.dev`) and `supabase.com` were **not reachable from the build environment** (blocked by its network policy). Instead, the integration was verified against the **official Google Gen AI SDK package, `@google/genai` v2.24.0**, which is what the application actually calls:

| Capability | Source checked | Used as |
| --- | --- | --- |
| `ai.models.generateContent({ model, contents, config })` | SDK typings (`dist/genai.d.ts`) | image generation, analysis, QC |
| `config.responseModalities`, `config.imageConfig.{aspectRatio,imageSize}` | `ImageConfig` typings: aspect ratios `1:1 2:3 3:2 3:4 4:3 9:16 16:9 21:9`; sizes `1K 2K 4K` | shoot settings (`IMAGE_ASPECT_RATIOS`, `IMAGE_SIZES`) |
| Output parsing: `candidates[0].content.parts[].inlineData{mimeType,data}` / `.text` / `.thought` | `Part` typings | `parseImageResponse` (thought parts are skipped) |
| `usageMetadata.{promptTokenCount,candidatesTokenCount,thoughtsTokenCount,candidatesTokensDetails[].modality}`, `responseId`, `modelVersion`, `promptFeedback.blockReason`, `FinishReason` values incl. `IMAGE_SAFETY` | typings | usage ledger, request IDs, error classification |
| `config.responseMimeType` + `config.responseJsonSchema` | typings | structured analysis/QC output (always re-validated with zod) |
| `httpOptions.timeout`, `httpOptions.retryOptions.attempts` | typings | per-request timeout; SDK retries disabled (the queue owns retries) |
| `ai.models.generateVideos({ model, source:{prompt,image}, config })` with `durationSeconds`, `aspectRatio` (`16:9`,`9:16`), `resolution` (`720p`,`1080p`), `personGeneration` (`allow_adult`), `negativePrompt`, `referenceImages[{image, referenceType: ASSET}]` | `GenerateVideosConfig` typings | video jobs |
| `ai.operations.getVideosOperation({ operation })`, `ai.files.download({ file, downloadPath })` | typings + SDK's own `generateVideos` doc example (polling loop) | video polling + download |
| `ai.models.get` / `ai.models.list` → `supportedActions` | typings | `npm run providers:models`, Settings → Verify provider models |
| Model ID `gemini-3-pro-image-preview`, alias `gemini-flash-latest` | SDK README examples | `.env.example` suggestions |
| `gemini-3.1-flash-image-preview` ignores `imageSize` | googleapis/js-genai issue #1461 | `GEMINI_SEND_IMAGE_SIZE` switch |

**Not verified from here — operators must check before production use:**

1. Which model IDs are currently available/GA/deprecated for your key → run `npm run providers:models` (calls the live API) and use **Settings → Verify provider models now**.
2. Current pricing → [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing); update `src/config/pricing.ts` or `PRICING_OVERRIDES_JSON` and set `verifiedAt` (see [COSTS.md](COSTS.md)).
3. Maximum reference images per request for your image model → set `GEMINI_MAX_REFERENCE_IMAGES` (default 6).
4. Veo: supported durations, resolutions and whether reference images are supported for your model → `VIDEO_ALLOWED_DURATIONS`, `VIDEO_SUPPORTS_REFERENCE_IMAGES`.
5. Rate limits/quotas for your project tier (AI Studio → usage) → tune `WORKER_MAX_CONCURRENCY`.
6. Commercial-use terms and content policies for generated images/videos (Gemini API Additional Terms, Generative AI Prohibited Use Policy), and the disclosure/watermark (SynthID) behaviour relevant to your market.

The SDK also exposes `generateContent` via a newer "Interactions" API; this app uses `models.generateContent`, which is fully supported by SDK 2.24. If Google retires it, only `src/lib/providers/gemini/*` needs to change.

## Gemini — image generation

- Env: `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` (required, no default), `GEMINI_SEND_IMAGE_SIZE`, `GEMINI_MAX_REFERENCE_IMAGES`, `GEMINI_REQUEST_TIMEOUT_MS`.
- Request (`buildImageGenerationRequest`): one user turn with alternating `text` labels (“Image #1: product reference, front view”) and `inlineData` JPEGs (references downscaled to ≤2048px), then the prompt. `responseModalities: ["TEXT","IMAGE"]`, `imageConfig: { aspectRatio, imageSize? }`.
- Prompt (`lib/domain/prompts.ts`): *Product preservation requirements* (reference images, verified attributes, “do not invent unseen details”) are a separate section from *Model* and *Creative direction*; a safety baseline (adults 21+, non-explicit, commercial) is always appended; reviewer feedback is appended on regeneration.
- Response: first non-thought image part is stored as the result (original bytes) plus a 512px WebP thumbnail. Text parts are stored as `provider_text`.
- Errors: HTTP 408/429/5xx, network errors and timeouts → transient (retry with backoff + jitter; 429 waits ≥30s). Prompt blocks and safety finish reasons → permanent. Empty `STOP` responses → retry once more.
- Identity consistency: model reference images are sent as inputs, which *helps* but does not guarantee identity; use the model page's consistency view and QC `identity_inconsistency` flags.

## Gemini — analysis and QC

- Env: `GEMINI_ANALYSIS_MODEL` (default `gemini-flash-latest`; pin a version for reproducibility and exact pricing), `AUTO_QUALITY_REVIEW`.
- `responseMimeType: application/json` + `responseJsonSchema`; outputs are parsed and validated with zod (`productAnalysisSchema`, `qualityReviewSchema`). Invalid output is retried as transient.
- Analysis is stored as unverified observations; only human-confirmed `verified_attributes` are presented to the image model as facts.
- QC compares all references + the generated image and returns flags; `qc_status` is `passed` only for a `pass` verdict with no medium/high flags. QC never approves anything.

## Veo — video (`VIDEO_PROVIDER=gemini-veo`)

- Env: `VIDEO_PROVIDER`, `VIDEO_MODEL` (verify, e.g. a `veo-3.1-*` model), `VIDEO_ALLOWED_DURATIONS`, `VIDEO_SUPPORTS_REFERENCE_IMAGES`, `VIDEO_POLL_INTERVAL_SECONDS`. Uses `GEMINI_API_KEY`.
- Product video: approved image → `source.image` (starting frame) + prompt + motion. Advertising video: brief + prompt; with reference-image support enabled, up to 3 approved images as `ASSET` references (no starting frame), otherwise exactly one image.
- `personGeneration: "allow_adult"`, a negative prompt excluding explicit content and garment distortion, `numberOfVideos: 1`.
- Lifecycle: submit → store operation name → poll every `VIDEO_POLL_INTERVAL_SECONDS` via worker ticks → download with `files.download` to a temp file → upload to private storage → result + usage. Cancelling stops polling but **cannot cancel the provider operation**; it may still be billed.
- Webhooks: the SDK typings include `webhookConfig` on `GenerateVideosConfig`, but its availability, payload and signature scheme for the Gemini API were not verified, so the app **polls**. If adopted later, add a route that verifies the provider's signature, looks up the job by operation name, and treats duplicate deliveries idempotently (the job state machine already makes a second completion a no-op).

## Adding another provider

1. Implement `ImageGenerationProvider`, `VisionProvider` or `VideoGenerationProvider`.
2. Map provider errors to `ProviderError` with `transient`/`permanent` classification.
3. Return token/unit usage so `recordUsage` can price it; add pricing to `config/pricing.ts`.
4. Select it in `src/lib/providers/registry.ts` via env; add request/response tests with fixtures.
