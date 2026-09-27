import { describe, expect, it } from "vitest";
import { budgetState, estimateTokenCost, estimateVideoCost, findPricing, pricingTable, summarizeLedger } from "@/lib/domain/costs";
import type { PricingTable } from "@/config/pricing";

const table: PricingTable = {
  "img-model": { kind: "tokens", currency: "USD", inputPerMillion: 2, outputTextPerMillion: 12, outputImagePerMillion: 120, source: "test", verifiedAt: "2026-01-01" },
  "img": { kind: "tokens", currency: "USD", inputPerMillion: 1, outputTextPerMillion: 1, source: "test", verifiedAt: null },
  "vid-model": { kind: "per_second", currency: "USD", perSecond: { default: 0.4, "1080p": 0.5 }, source: "test", verifiedAt: null },
};

describe("cost accounting", () => {
  it("matches the longest model prefix, including versioned model names", () => {
    expect(findPricing("img-model-preview-01", table)?.key).toBe("img-model");
    expect(findPricing("models/img-other", table)?.key).toBe("img");
    expect(findPricing("unknown", table)).toBeNull();
  });

  it("prices image-modality output tokens separately from text/thinking tokens", () => {
    const est = estimateTokenCost(
      "img-model",
      { inputTokens: 1000, outputTokens: 1300, outputImageTokens: 1290, thoughtsTokens: 200, totalTokens: 2500 },
      table,
    );
    // 1000*2 + (10+200)*12 + 1290*120 = 2000 + 2520 + 154800 = 159320 / 1e6
    expect(est.amount).toBeCloseTo(0.15932, 6);
    expect(est.source).toBe("estimated");
    expect(est.pricingRef).toBe("img-model@2026-01-01");
  });

  it("returns unknown (not zero) when pricing or usage is missing", () => {
    const noUsage = estimateTokenCost("img-model", { inputTokens: null, outputTokens: null, outputImageTokens: null, thoughtsTokens: null, totalTokens: null }, table);
    expect(noUsage).toMatchObject({ amount: null, source: "unknown" });
    expect(estimateTokenCost("nope", { inputTokens: 1, outputTokens: 1, outputImageTokens: null, thoughtsTokens: null, totalTokens: 2 }, table).source).toBe("unknown");
  });

  it("estimates video cost per second and resolution", () => {
    expect(estimateVideoCost("vid-model-001", { seconds: 8, resolution: "720p", count: 1 }, table).amount).toBeCloseTo(3.2);
    expect(estimateVideoCost("vid-model-001", { seconds: 8, resolution: "1080p", count: 2 }, table).amount).toBeCloseTo(8);
    expect(estimateVideoCost("img-model", { seconds: 8, resolution: "720p", count: 1 }, table).source).toBe("unknown");
  });

  it("applies valid PRICING_OVERRIDES_JSON and ignores invalid overrides", () => {
    const merged = pricingTable({
      PRICING_OVERRIDES_JSON: JSON.stringify({ "custom-model": { kind: "per_second", currency: "USD", perSecond: { default: 1 }, source: "contract", verifiedAt: "2026-09-01" } }),
    });
    expect(merged["custom-model"]).toBeDefined();
    const invalid = pricingTable({ PRICING_OVERRIDES_JSON: "{not json" });
    expect(invalid["custom-model"]).toBeUndefined();
  });

  it("summarises actual vs estimated vs unknown, per image/video/product and failures", () => {
    const s = summarizeLedger([
      { cost_amount: "0.10", cost_source: "estimated", job_type: "image_generation", succeeded: true, product_id: "p1", units: { images: 1 } },
      { cost_amount: 0.05, cost_source: "estimated", job_type: "image_generation", succeeded: false, product_id: "p1", units: { images: 0 } },
      { cost_amount: 2.0, cost_source: "provider_reported", job_type: "video_generation", succeeded: true, product_id: "p2", units: { videos: 1 } },
      { cost_amount: null, cost_source: "unknown", job_type: "quality_review", succeeded: true, product_id: null, units: {} },
    ]);
    expect(s.estimated).toBeCloseTo(0.15);
    expect(s.actual).toBeCloseTo(2);
    expect(s.unknownCount).toBe(1);
    expect(s.failedCost).toBeCloseTo(0.05);
    expect(s.imageCount).toBe(1);
    expect(s.videoCount).toBe(1);
    expect(s.byProduct).toEqual({ p1: 0.15000000000000002, p2: 2 });
  });

  it("computes budget thresholds", () => {
    expect(budgetState(50, null, 80).level).toBe("none");
    expect(budgetState(50, 100, 80).level).toBe("ok");
    expect(budgetState(85, 100, 80).level).toBe("warning");
    expect(budgetState(100, 100, 80).level).toBe("exceeded");
  });
});
