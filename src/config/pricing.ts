/**
 * Provider pricing assumptions used ONLY to estimate costs when a provider
 * does not report the charged amount (the Gemini API returns token usage but
 * not a price). Estimates are always stored with cost_source = 'estimated'
 * and the pricing reference, and are labelled as estimates in the UI.
 *
 * IMPORTANT
 * - Prices change. Verify against the official page before relying on them:
 *   https://ai.google.dev/gemini-api/docs/pricing
 * - `verifiedAt: null` means the value has NOT been verified against the
 *   official page by whoever last edited this file. The values below were
 *   entered from published list prices known at development time; the
 *   official page was not reachable from the build environment, so they are
 *   intentionally marked unverified.
 * - Override or extend without a code change via the PRICING_OVERRIDES_JSON
 *   environment variable (same shape as PricingTable, merged by model key).
 */

export interface TokenPricing {
  kind: "tokens";
  currency: "USD";
  /** USD per 1M input tokens (text/image). */
  inputPerMillion: number;
  /** USD per 1M output tokens of text (incl. thinking). */
  outputTextPerMillion: number;
  /** USD per 1M output tokens of image modality (image models). */
  outputImagePerMillion?: number;
  source: string;
  verifiedAt: string | null;
}

export interface PerSecondPricing {
  kind: "per_second";
  currency: "USD";
  /** USD per generated second, keyed by resolution; "default" is the fallback. */
  perSecond: Record<string, number>;
  source: string;
  verifiedAt: string | null;
}

export type ModelPricing = TokenPricing | PerSecondPricing;
export type PricingTable = Record<string, ModelPricing>;

const SOURCE = "https://ai.google.dev/gemini-api/docs/pricing";

/**
 * Keys are model ID prefixes; the longest matching prefix wins, so
 * "gemini-2.5-flash-image" is matched before "gemini-2.5-flash".
 */
export const DEFAULT_PRICING: PricingTable = {
  "gemini-2.5-flash-image": {
    kind: "tokens",
    currency: "USD",
    inputPerMillion: 0.3,
    outputTextPerMillion: 2.5,
    outputImagePerMillion: 30,
    source: SOURCE,
    verifiedAt: null,
  },
  "gemini-3-pro-image": {
    kind: "tokens",
    currency: "USD",
    inputPerMillion: 2,
    outputTextPerMillion: 12,
    outputImagePerMillion: 120,
    source: SOURCE,
    verifiedAt: null,
  },
  "gemini-2.5-flash": {
    kind: "tokens",
    currency: "USD",
    inputPerMillion: 0.3,
    outputTextPerMillion: 2.5,
    source: SOURCE,
    verifiedAt: null,
  },
  "gemini-2.5-pro": {
    kind: "tokens",
    currency: "USD",
    inputPerMillion: 1.25,
    outputTextPerMillion: 10,
    source: SOURCE,
    verifiedAt: null,
  },
  "veo-3.1-fast": {
    kind: "per_second",
    currency: "USD",
    perSecond: { default: 0.15 },
    source: SOURCE,
    verifiedAt: null,
  },
  "veo-3.1": {
    kind: "per_second",
    currency: "USD",
    perSecond: { default: 0.4 },
    source: SOURCE,
    verifiedAt: null,
  },
  "veo-2.0": {
    kind: "per_second",
    currency: "USD",
    perSecond: { default: 0.35 },
    source: SOURCE,
    verifiedAt: null,
  },
};
