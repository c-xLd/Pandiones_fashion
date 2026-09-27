import { z } from "zod";

/**
 * Structured output contracts for Gemini vision calls. Each contract has a
 * zod validator (authoritative) and a JSON Schema passed to the model via
 * `responseJsonSchema`. The model output is ALWAYS re-validated with zod;
 * model-produced values are screening signals, not verified product facts.
 */

const confidence = z.enum(["high", "medium", "low"]);

export const DETAIL_ELEMENTS = [
  "texture",
  "lace",
  "stitching",
  "straps",
  "seams",
  "closures",
  "trim",
  "print",
  "embellishment",
  "other",
] as const;

export const productAnalysisSchema = z.object({
  category: z.string().min(1).max(80),
  categoryConfidence: confidence,
  dominantColors: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        hex: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable(),
        confidence,
      }),
    )
    .max(8),
  fabricAppearance: z.string().max(500),
  details: z
    .array(
      z.object({
        element: z.enum(DETAIL_ELEMENTS),
        description: z.string().min(1).max(400),
        visibleInImages: z.array(z.number().int().min(1).max(20)).max(20),
        confidence,
      }),
    )
    .max(30),
  silhouette: z.string().max(500),
  construction: z.string().max(800),
  frontBackDistinctions: z.string().max(800),
  imageQuality: z.object({
    overall: z.enum(["good", "acceptable", "poor"]),
    issues: z.array(z.string().max(300)).max(20),
  }),
  missingReferenceAngles: z.array(z.enum(["front", "back", "side", "detail", "fabric"])).max(5),
  uncertainties: z.array(z.string().max(400)).max(20),
});
export type ProductAnalysis = z.infer<typeof productAnalysisSchema>;

const confidenceJson = { type: "string", enum: ["high", "medium", "low"] };

export const productAnalysisJsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", description: "Garment category, e.g. bra, bralette, brief, bodysuit, slip dress." },
    categoryConfidence: confidenceJson,
    dominantColors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          hex: { type: ["string", "null"], description: "Approximate #RRGGBB, or null if unsure." },
          confidence: confidenceJson,
        },
        required: ["name", "hex", "confidence"],
      },
    },
    fabricAppearance: { type: "string" },
    details: {
      type: "array",
      items: {
        type: "object",
        properties: {
          element: { type: "string", enum: [...DETAIL_ELEMENTS] },
          description: { type: "string" },
          visibleInImages: {
            type: "array",
            items: { type: "integer" },
            description: "1-based indexes of the provided images where this detail is visible.",
          },
          confidence: confidenceJson,
        },
        required: ["element", "description", "visibleInImages", "confidence"],
      },
    },
    silhouette: { type: "string" },
    construction: { type: "string", description: "Only what is visible. Do not infer hidden construction." },
    frontBackDistinctions: {
      type: "string",
      description: "Differences between front and back as visible; say 'not visible' if no back view.",
    },
    imageQuality: {
      type: "object",
      properties: {
        overall: { type: "string", enum: ["good", "acceptable", "poor"] },
        issues: { type: "array", items: { type: "string" } },
      },
      required: ["overall", "issues"],
    },
    missingReferenceAngles: {
      type: "array",
      items: { type: "string", enum: ["front", "back", "side", "detail", "fabric"] },
    },
    uncertainties: { type: "array", items: { type: "string" } },
  },
  required: [
    "category",
    "categoryConfidence",
    "dominantColors",
    "fabricAppearance",
    "details",
    "silhouette",
    "construction",
    "frontBackDistinctions",
    "imageQuality",
    "missingReferenceAngles",
    "uncertainties",
  ],
} as const;

// ---------------------------------------------------------------------------
// Quality review (generated output vs. source references)
// ---------------------------------------------------------------------------
export const QC_FLAG_TYPES = [
  "color_change",
  "missing_element",
  "altered_element",
  "pattern_inconsistency",
  "silhouette_change",
  "anatomy_artifact",
  "rendering_artifact",
  "garment_count",
  "identity_inconsistency",
  "background_mismatch",
  "framing_mismatch",
  "other",
] as const;

export const qualityReviewSchema = z.object({
  verdict: z.enum(["pass", "needs_review", "fail"]),
  flags: z
    .array(
      z.object({
        type: z.enum(QC_FLAG_TYPES),
        severity: z.enum(["low", "medium", "high"]),
        description: z.string().min(1).max(500),
      }),
    )
    .max(30),
  summary: z.string().max(1000),
});
export type QualityReview = z.infer<typeof qualityReviewSchema>;

export const qualityReviewJsonSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "needs_review", "fail"] },
    flags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...QC_FLAG_TYPES] },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          description: { type: "string" },
        },
        required: ["type", "severity", "description"],
      },
    },
    summary: { type: "string" },
  },
  required: ["verdict", "flags", "summary"],
} as const;

/** Parse model JSON text; throws a descriptive error when invalid. */
export function parseStructuredOutput<T>(schema: z.ZodType<T>, text: string | undefined): T {
  if (!text) throw new StructuredOutputError("Model returned no text output");
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(text));
  } catch {
    throw new StructuredOutputError("Model output was not valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new StructuredOutputError(
      `Model output failed schema validation: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/** Map a QC verdict to the stored qc_status. */
export function qcStatusFromReview(review: QualityReview): "passed" | "flagged" {
  const hasSerious = review.flags.some((f) => f.severity !== "low");
  return review.verdict === "pass" && !hasSerious ? "passed" : "flagged";
}
