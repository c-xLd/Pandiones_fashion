import { z } from "zod";
import { DEFAULT_PRICING, type ModelPricing, type PricingTable } from "@/config/pricing";

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Output tokens of IMAGE modality, when the provider breaks them down. */
  outputImageTokens: number | null;
  /** Thinking tokens are billed as output text. */
  thoughtsTokens: number | null;
  totalTokens: number | null;
}

export interface CostEstimate {
  amount: number | null;
  currency: string;
  source: "provider_reported" | "estimated" | "unknown";
  pricingRef: string | null;
}

const pricingOverrideSchema = z.record(
  z.string(),
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("tokens"),
      currency: z.literal("USD"),
      inputPerMillion: z.number().nonnegative(),
      outputTextPerMillion: z.number().nonnegative(),
      outputImagePerMillion: z.number().nonnegative().optional(),
      source: z.string(),
      verifiedAt: z.string().nullable(),
    }),
    z.object({
      kind: z.literal("per_second"),
      currency: z.literal("USD"),
      perSecond: z.record(z.string(), z.number().nonnegative()),
      source: z.string(),
      verifiedAt: z.string().nullable(),
    }),
  ]),
);

let cachedTable: PricingTable | null = null;

/** Default pricing merged with PRICING_OVERRIDES_JSON (if valid). */
export function pricingTable(env: Record<string, string | undefined> = process.env): PricingTable {
  if (cachedTable && env === process.env) return cachedTable;
  let table: PricingTable = { ...DEFAULT_PRICING };
  const raw = env.PRICING_OVERRIDES_JSON;
  if (raw && raw.trim()) {
    try {
      const parsed = pricingOverrideSchema.parse(JSON.parse(raw));
      table = { ...table, ...parsed };
    } catch (error) {
      console.error("[pricing] PRICING_OVERRIDES_JSON is invalid and was ignored", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (env === process.env) cachedTable = table;
  return table;
}

/** Longest-prefix match of a model ID (or resolved model version) against the table. */
export function findPricing(model: string, table: PricingTable = pricingTable()): { key: string; pricing: ModelPricing } | null {
  const normalized = model.replace(/^models\//, "");
  let best: { key: string; pricing: ModelPricing } | null = null;
  for (const [key, pricing] of Object.entries(table)) {
    if (normalized.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, pricing };
    }
  }
  return best;
}

function pricingRef(key: string, pricing: ModelPricing): string {
  return `${key}@${pricing.verifiedAt ?? "unverified"}`;
}

export function estimateTokenCost(model: string, usage: TokenUsage, table?: PricingTable): CostEstimate {
  const match = findPricing(model, table);
  if (!match || match.pricing.kind !== "tokens" || usage.inputTokens == null || usage.outputTokens == null) {
    return { amount: null, currency: "USD", source: "unknown", pricingRef: match ? pricingRef(match.key, match.pricing) : null };
  }
  const p = match.pricing;
  const imageOut = usage.outputImageTokens ?? 0;
  const textOut = Math.max(0, usage.outputTokens - imageOut) + (usage.thoughtsTokens ?? 0);
  const imageRate = p.outputImagePerMillion ?? p.outputTextPerMillion;
  const amount =
    (usage.inputTokens * p.inputPerMillion + textOut * p.outputTextPerMillion + imageOut * imageRate) / 1_000_000;
  return { amount: roundMoney(amount), currency: p.currency, source: "estimated", pricingRef: pricingRef(match.key, p) };
}

export function estimateVideoCost(
  model: string,
  input: { seconds: number; resolution: string; count: number },
  table?: PricingTable,
): CostEstimate {
  const match = findPricing(model, table);
  if (!match || match.pricing.kind !== "per_second") {
    return { amount: null, currency: "USD", source: "unknown", pricingRef: match ? pricingRef(match.key, match.pricing) : null };
  }
  const rate = match.pricing.perSecond[input.resolution] ?? match.pricing.perSecond.default;
  if (rate == null) return { amount: null, currency: "USD", source: "unknown", pricingRef: pricingRef(match.key, match.pricing) };
  return {
    amount: roundMoney(rate * input.seconds * input.count),
    currency: match.pricing.currency,
    source: "estimated",
    pricingRef: pricingRef(match.key, match.pricing),
  };
}

export function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export interface LedgerLike {
  cost_amount: number | string | null;
  cost_source: "provider_reported" | "estimated" | "unknown";
  job_type: string;
  succeeded: boolean;
  product_id: string | null;
  units: Record<string, unknown> | null;
}

export interface CostSummary {
  actual: number;
  estimated: number;
  unknownCount: number;
  failedCost: number;
  imageCount: number;
  imageCost: number;
  videoCount: number;
  videoCost: number;
  byProduct: Record<string, number>;
}

/** Aggregate ledger rows, keeping actual and estimated amounts separate. */
export function summarizeLedger(rows: LedgerLike[]): CostSummary {
  const s: CostSummary = {
    actual: 0,
    estimated: 0,
    unknownCount: 0,
    failedCost: 0,
    imageCount: 0,
    imageCost: 0,
    videoCount: 0,
    videoCost: 0,
    byProduct: {},
  };
  for (const row of rows) {
    const amount = row.cost_amount == null ? null : Number(row.cost_amount);
    if (amount == null || row.cost_source === "unknown") {
      s.unknownCount++;
    } else if (row.cost_source === "provider_reported") {
      s.actual += amount;
    } else {
      s.estimated += amount;
    }
    const value = amount ?? 0;
    if (!row.succeeded) s.failedCost += value;
    const images = Number((row.units as { images?: unknown } | null)?.images ?? 0) || 0;
    const videos = Number((row.units as { videos?: unknown } | null)?.videos ?? 0) || 0;
    if (row.job_type === "image_generation" || row.job_type === "model_portrait") {
      s.imageCount += images;
      s.imageCost += value;
    }
    if (row.job_type === "video_generation") {
      s.videoCount += videos;
      s.videoCost += value;
    }
    if (row.product_id) s.byProduct[row.product_id] = (s.byProduct[row.product_id] ?? 0) + value;
  }
  s.actual = roundMoney(s.actual);
  s.estimated = roundMoney(s.estimated);
  s.failedCost = roundMoney(s.failedCost);
  s.imageCost = roundMoney(s.imageCost);
  s.videoCost = roundMoney(s.videoCost);
  return s;
}

export function budgetState(spend: number, budget: number | null, alertPercent: number) {
  if (budget == null || budget <= 0) return { level: "none" as const, percent: null };
  const percent = (spend / budget) * 100;
  if (percent >= 100) return { level: "exceeded" as const, percent };
  if (percent >= alertPercent) return { level: "warning" as const, percent };
  return { level: "ok" as const, percent };
}
