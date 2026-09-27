# Costs & usage

## What is recorded

Every provider call writes one `usage_ledger` row (service role, from the worker):

| Field | Meaning |
| --- | --- |
| `provider`, `model` | the resolved model version when the provider reports one (`modelVersion`), else the requested ID |
| `request_id` | provider response ID / video operation name |
| `input_tokens`, `output_tokens`, `total_tokens` | from `usageMetadata` (Gemini) |
| `units` | `{images}`, `{videos, seconds}`, `{requests, images_in}` |
| `cost_amount`, `cost_currency` | amount in USD, or `NULL` when unknown |
| `cost_source` | `provider_reported` (charged amount returned by the provider), `estimated` (computed from usage × configured pricing), `unknown` (no usage or no pricing) |
| `pricing_ref` | pricing key and verification date used, e.g. `gemini-3-pro-image@unverified` |
| `succeeded` | whether the call produced a usable result |

Failed calls are recorded too: if the provider returned usage (e.g. a safety-blocked image) the cost is estimated; if the request failed before returning usage, the row has `cost_source = unknown`. QC and analysis calls are recorded with their own job types.

The Gemini API returns token usage but **not** the charged amount, so Gemini and Veo costs are **estimates**. The UI always labels them. Reconcile with your Google Cloud billing export for actual spend.

## Estimation

`src/lib/domain/costs.ts`:

- Token models: `input × inputPerMillion + (text output + thinking) × outputTextPerMillion + image-modality output × outputImagePerMillion`, using `candidatesTokensDetails` to split image vs text output tokens.
- Video models: `seconds × perSecond[resolution | default] × videos`.
- Model lookup is longest-prefix on the model ID (so versioned names like `gemini-3-pro-image-preview-11-2025` match `gemini-3-pro-image`).

## Pricing configuration

Defaults live in `src/config/pricing.ts`, each with a `source` URL and `verifiedAt`. **All defaults are marked `verifiedAt: null` (unverified)** because the official pricing page could not be reached from the build environment; they were entered from list prices known at development time and must be checked.

To update without a deploy, set `PRICING_OVERRIDES_JSON` (merged by key; invalid JSON is ignored and logged):

```json
{
  "gemini-3-pro-image": { "kind": "tokens", "currency": "USD", "inputPerMillion": 2, "outputTextPerMillion": 12, "outputImagePerMillion": 120,
                          "source": "https://ai.google.dev/gemini-api/docs/pricing", "verifiedAt": "2026-09-27" },
  "veo-3.1": { "kind": "per_second", "currency": "USD", "perSecond": { "default": 0.4 }, "source": "https://ai.google.dev/gemini-api/docs/pricing", "verifiedAt": "2026-09-27" }
}
```

Models without a pricing entry (e.g. the `gemini-flash-latest` alias when the response carries no version) are recorded as `unknown`. The **Costs** page lists the active assumptions and their verification state.

## Dashboard

**Costs & usage** (per month): total with actual/estimated split and unknown-call count, cost per image (generation), QC and analysis cost, cost per video, failed-generation cost, daily spend, breakdown by model, top products, current app limits, pricing assumptions and recent ledger entries. Aggregation happens in SQL (`usage_breakdown`, `usage_daily`, `usage_by_product`).

## Budgets

**Settings → Organization & budget** (admins): monthly budget (USD), alert threshold (%), and an optional **hard limit**. The dashboard and cost page warn at the threshold; with the hard limit on, new jobs are refused once month-to-date recorded + estimated spend reaches the budget (`assertWithinBudget`). Jobs already queued continue.

## Provider limits

Provider quotas are per Google Cloud project/tier and are not exposed by the API; configure alerts in Google Cloud. The app protects quotas with `WORKER_MAX_CONCURRENCY` (global in-flight calls), per-user rate limits, per-shoot caps, and 429-aware backoff.
