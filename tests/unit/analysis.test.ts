import { describe, expect, it } from "vitest";
import {
  StructuredOutputError,
  parseStructuredOutput,
  productAnalysisSchema,
  qcStatusFromReview,
  qualityReviewSchema,
} from "@/lib/domain/analysis";
import { validAnalysisFixture } from "../fixtures/gemini";

describe("image analysis schema validation", () => {
  it("parses valid structured output (also inside a code fence)", () => {
    expect(parseStructuredOutput(productAnalysisSchema, JSON.stringify(validAnalysisFixture)).category).toBe("bralette");
    const fenced = "```json\n" + JSON.stringify(validAnalysisFixture) + "\n```";
    expect(parseStructuredOutput(productAnalysisSchema, fenced).missingReferenceAngles).toEqual(["back", "side"]);
  });

  it("rejects non-JSON, empty and schema-violating output", () => {
    expect(() => parseStructuredOutput(productAnalysisSchema, undefined)).toThrow(StructuredOutputError);
    expect(() => parseStructuredOutput(productAnalysisSchema, "not json")).toThrow(/valid JSON/);
    const bad = { ...validAnalysisFixture, categoryConfidence: "certain" };
    expect(() => parseStructuredOutput(productAnalysisSchema, JSON.stringify(bad))).toThrow(/schema validation/);
    const badHex = { ...validAnalysisFixture, dominantColors: [{ name: "red", hex: "red", confidence: "low" }] };
    expect(() => parseStructuredOutput(productAnalysisSchema, JSON.stringify(badHex))).toThrow(StructuredOutputError);
  });
});

describe("quality review mapping", () => {
  it("passes only a clean verdict without medium/high flags", () => {
    const clean = qualityReviewSchema.parse({ verdict: "pass", flags: [{ type: "other", severity: "low", description: "minor" }], summary: "ok" });
    expect(qcStatusFromReview(clean)).toBe("passed");
    const flagged = qualityReviewSchema.parse({ verdict: "pass", flags: [{ type: "color_change", severity: "medium", description: "darker" }], summary: "" });
    expect(qcStatusFromReview(flagged)).toBe("flagged");
    expect(qcStatusFromReview(qualityReviewSchema.parse({ verdict: "needs_review", flags: [], summary: "" }))).toBe("flagged");
  });
});
