import { z } from "zod";
import { MAX_SESSION_LOCATIONS, MAX_SESSION_SHOTS, SESSION_LOCATIONS } from "./photo-session";
import { GARMENT_TYPES } from "./outfit";

export const IMAGE_ENGINES = ["auto", "standard", "high"] as const;
export type ImageEngine = (typeof IMAGE_ENGINES)[number];

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------
export const ORG_ROLES = ["viewer", "editor", "admin", "owner"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PRODUCT_STATUSES = ["draft", "ready", "processing", "completed", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const ASSET_ROLES = ["front", "back", "side", "detail", "fabric", "other"] as const;
export type AssetRole = (typeof ASSET_ROLES)[number];

export const JOB_TYPES = [
  "product_analysis",
  "image_generation",
  "quality_review",
  "video_generation",
  "model_portrait",
  "replica_generation",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "processing", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const SHOT_TYPES = ["front", "back", "side", "three_quarter", "detail"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const FRAMINGS = ["full_body", "three_quarter_body", "waist_up", "close_up", "detail_macro"] as const;
export type Framing = (typeof FRAMINGS)[number];

/** Aspect ratios documented for Gemini ImageConfig in @google/genai typings. */
export const IMAGE_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

/** Output sizes documented for Gemini ImageConfig.imageSize. Model support varies. */
export const IMAGE_SIZES = ["1K", "2K", "4K"] as const;

/**
 * Output quality offered in the studio. "eco" renders at 1K and upscales to
 * 2K: about half the provider cost (roughly twice as many images from a free
 * daily allowance), with less fine detail than a native 2K render.
 */
export const OUTPUT_QUALITIES = ["eco", "2K", "4K"] as const;
export type OutputQuality = (typeof OUTPUT_QUALITIES)[number];

/** Provider render size and optional upscale target for a quality choice. */
export function renderPlan(quality: OutputQuality): { imageSize: (typeof IMAGE_SIZES)[number]; upscaleTo: (typeof IMAGE_SIZES)[number] | null } {
  return quality === "eco" ? { imageSize: "1K", upscaleTo: "2K" } : { imageSize: quality, upscaleTo: null };
}
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** Veo aspect ratios / resolutions documented in GenerateVideosConfig typings. */
export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;
export const VIDEO_RESOLUTIONS = ["720p", "1080p"] as const;

export const PRESET_CATEGORIES = ["ecommerce", "editorial", "detail", "campaign"] as const;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const productInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, "skuRequired")
    .max(64)
    .regex(/^[A-Za-z0-9._\-/]+$/, "skuFormat"),
  title: z.string().trim().min(1, "titleRequired").max(200),
  category: optionalText(80),
  color: optionalText(80),
  size: optionalText(80),
  description: optionalText(5000),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      const list = Array.isArray(v) ? v : (v ?? "").split(",");
      return Array.from(new Set(list.map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 30);
    })
    .pipe(z.array(z.string().max(40))),
  status: z.enum(PRODUCT_STATUSES).default("draft"),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  category: z.string().trim().max(80).optional(),
  sort: z.enum(["updated_desc", "created_desc", "sku_asc", "title_asc"]).default("updated_desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

// ---------------------------------------------------------------------------
// Shoot configuration. Creative styling lives here; product reference
// constraints are built separately from the product record (see prompts.ts).
// ---------------------------------------------------------------------------
export const shootStyleSchema = z.object({
  shotType: z.enum(SHOT_TYPES),
  pose: z.string().trim().max(300).default(""),
  cameraAngle: z.string().trim().max(200).default(""),
  framing: z.enum(FRAMINGS),
  background: z.string().trim().max(300).default(""),
  lighting: z.string().trim().max(300).default(""),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS),
  imageSize: z.enum(IMAGE_SIZES),
  variations: z.coerce.number().int().min(1).max(8),
  creativeInstructions: z.string().trim().max(2000).default(""),
});
export type ShootStyle = z.infer<typeof shootStyleSchema>;

export const presetInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(PRESET_CATEGORIES),
  description: optionalText(500),
  config: shootStyleSchema,
});

export const shootRequestSchema = z.object({
  productId: z.uuid(),
  modelProfileId: z.uuid().nullable(),
  presetId: z.uuid().nullable(),
  productReferenceAssetIds: z.array(z.uuid()).min(1, "selectProductRef").max(14),
  modelReferenceAssetIds: z.array(z.uuid()).max(14).default([]),
  /** One shoot can request several shot types; each becomes its own jobs. */
  shotTypes: z.array(z.enum(SHOT_TYPES)).min(1).max(5),
  style: shootStyleSchema.omit({ shotType: true }),
  idempotencyKey: z.string().min(8).max(100),
});
export type ShootRequest = z.infer<typeof shootRequestSchema>;

/** One-click photo session: the server plans varied shots (see photo-session.ts). */
export const photoSessionRequestSchema = z.object({
  productId: z.uuid(),
  /** null + randomModel=true → fictional model; null + false → generic model. */
  modelProfileId: z.uuid().nullable(),
  randomModel: z.boolean().default(true),
  locations: z.array(z.enum(SESSION_LOCATIONS)).min(1, "selectLocation").max(MAX_SESSION_LOCATIONS),
  count: z.coerce.number().int().min(1).max(MAX_SESSION_SHOTS),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS),
  /** 2K is generated natively; 4K is the 2K output upscaled when the model cannot produce 4K; eco is 1K upscaled to 2K. */
  imageSize: z.enum(OUTPUT_QUALITIES).default("2K"),
  /** What the uploaded product is; "auto" infers it from the category/title. */
  garmentType: z.enum(["auto", ...GARMENT_TYPES]).default("auto"),
  /** Generation engine: auto/standard = the configured model; high = higher-quality model when available. */
  engine: z.enum(IMAGE_ENGINES).default("auto"),
  instructions: z.string().trim().max(1500).default(""),
  idempotencyKey: z.string().min(8).max(100),
});
export type PhotoSessionRequest = z.input<typeof photoSessionRequestSchema>;

/** Up to four reference photos, each recreated 1:1 with the chosen model and product. */
export const MAX_REPLICA_SCENES = 4;

export const replicaRequestSchema = z.object({
  productId: z.uuid(),
  /** null keeps the person from each reference photo and only swaps the garment. */
  modelProfileId: z.uuid().nullable(),
  scenePaths: z.array(z.string().max(300)).min(1, "selectReference").max(MAX_REPLICA_SCENES),
  imageSize: z.enum(OUTPUT_QUALITIES).default("2K"),
  engine: z.enum(IMAGE_ENGINES).default("auto"),
  instructions: z.string().trim().max(1000).default(""),
  idempotencyKey: z.string().min(8).max(100),
});
export type ReplicaRequest = z.input<typeof replicaRequestSchema>;

/** Snapshot stored on each replica_generation job. */
export const replicaJobConfigSchema = z.object({
  kind: z.literal("replica"),
  scenePath: z.string().max(300),
  sceneThumbnailPath: z.string().max(300).nullable(),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS),
  imageSize: z.enum(IMAGE_SIZES),
  /** Upscale the render to this size afterwards (eco quality). */
  upscaleTo: z.enum(IMAGE_SIZES).nullable().default(null),
  productReferenceAssetIds: z.array(z.uuid()).min(1),
  modelReferenceAssetIds: z.array(z.uuid()),
  instructions: z.string().max(1000).default(""),
  language: z.enum(["en", "tr"]).default("en"),
});
export type ReplicaJobConfig = z.infer<typeof replicaJobConfigSchema>;

/** Snapshot stored on each image_generation job. */
export const imageJobConfigSchema = z.object({
  kind: z.literal("product_shot"),
  style: shootStyleSchema,
  presetId: z.uuid().nullable(),
  productReferenceAssetIds: z.array(z.uuid()).min(1),
  modelReferenceAssetIds: z.array(z.uuid()),
  variationIndex: z.number().int().min(0),
  regenerationNote: z.string().max(2000).nullable().default(null),
  /** Language for AI-written free text (QC summaries); UI locale of the requester. */
  language: z.enum(["en", "tr"]).default("en"),
  /** Fictional model description shared by every shot of a session (no profile). */
  modelPersona: z.string().max(600).nullable().default(null),
  /** Session location id, for display and filtering. */
  location: z.string().max(40).nullable().default(null),
  /** Complementary outfit pieces, identical across a session (see outfit.ts). */
  styling: z.string().max(600).nullable().default(null),
  /** Upscale the render to this size afterwards (eco quality). */
  upscaleTo: z.enum(IMAGE_SIZES).nullable().default(null),
});
export type ImageJobConfig = z.infer<typeof imageJobConfigSchema>;

export const modelPortraitJobConfigSchema = z.object({
  kind: z.literal("model_portrait"),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).default("3:4"),
  imageSize: z.enum(IMAGE_SIZES).default("1K"),
  instructions: z.string().max(2000).default(""),
  modelReferenceAssetIds: z.array(z.uuid()).default([]),
  /** Casting: save the portrait as the profile's primary identity reference. */
  useAsReference: z.boolean().default(false),
});
export type ModelPortraitJobConfig = z.infer<typeof modelPortraitJobConfigSchema>;

// ---------------------------------------------------------------------------
// Model profiles
// ---------------------------------------------------------------------------
export const modelProfileInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,40}$/, "modelCode"),
  displayName: z.string().trim().min(1).max(120),
  description: optionalText(2000),
  hair: optionalText(200),
  eyes: optionalText(200),
  skinTone: optionalText(200),
  build: optionalText(200),
  ageRange: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v == null || (v.match(/\d+/g) ?? []).every((n) => Number(n) >= 18), {
      message: "adultAge",
    }),
  stylingNotes: optionalText(2000),
  preferredLighting: optionalText(300),
  photographyStyle: optionalText(300),
  status: z.enum(["draft", "active", "retired"]).default("draft"),
  adultConfirmed: z.literal(true, { error: "adultConfirm" }),
  consentNotes: optionalText(2000),
});
export type ModelProfileInput = z.infer<typeof modelProfileInputSchema>;

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------
export const reviewInputSchema = z.object({
  resultIds: z.array(z.uuid()).min(1).max(200),
  decision: z.enum(REVIEW_STATUSES),
  notes: z.string().trim().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------
export const videoRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["product", "advertising"]),
  sourceResultIds: z.array(z.uuid()).min(1).max(3),
  brief: z.string().trim().max(3000).optional().default(""),
  prompt: z.string().trim().min(1, "describeVideo").max(2000),
  motionInstructions: z.string().trim().max(1000).optional().default(""),
  durationSeconds: z.coerce.number().int().min(1).max(60),
  aspectRatio: z.enum(VIDEO_ASPECT_RATIOS),
  resolution: z.enum(VIDEO_RESOLUTIONS),
  idempotencyKey: z.string().min(8).max(100),
});
export type VideoRequest = z.infer<typeof videoRequestSchema>;

export const videoJobConfigSchema = z.object({
  kind: z.enum(["product", "advertising"]),
  prompt: z.string(),
  negativePrompt: z.string().nullable(),
  durationSeconds: z.number().int(),
  aspectRatio: z.enum(VIDEO_ASPECT_RATIOS),
  resolution: z.enum(VIDEO_RESOLUTIONS),
  sourceResultIds: z.array(z.uuid()).min(1),
  useReferenceImages: z.boolean(),
});
export type VideoJobConfig = z.infer<typeof videoJobConfigSchema>;
