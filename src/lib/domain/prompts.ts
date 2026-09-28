import type { ProductAnalysis } from "./analysis";
import type { AssetRole, ShootStyle, ShotType, Framing } from "./schemas";

/**
 * Prompt construction is pure and deterministic so it can be unit tested and
 * stored verbatim on each result. Product preservation constraints are kept
 * in their own section, separate from creative styling instructions.
 */

export const SAFETY_BASELINE =
  "All people depicted are consenting adults (at least 21 years old). The image must be professional, " +
  "non-explicit, tasteful commercial fashion product photography suitable for an e-commerce store. " +
  "No nudity beyond what the garment itself covers, no sexualised posing, no minors.";

/** Photographic realism cues shared by every people prompt. */
export const REALISM =
  "Hyper-realistic human detail: natural skin texture with fine pores and subtle imperfections, individual hair strands, " +
  "realistic eyes with natural catchlights, natural proportions and anatomically correct hands; " +
  "shot on a full-frame camera with an 85mm lens, true-to-life colours, no plastic or airbrushed look.";

export interface ProductContext {
  sku: string;
  title: string;
  category: string | null;
  color: string | null;
  description: string | null;
  /** Human-verified attributes (authoritative when present). */
  verifiedAttributes: Record<string, unknown> | null;
  /** Unverified AI observations, used only as hints. */
  aiAnalysis: ProductAnalysis | null;
}

export interface ReferenceImageLabel {
  index: number; // 1-based position in the request
  kind: "product" | "model";
  role: AssetRole | "model";
}

export interface ModelContext {
  code: string;
  displayName: string;
  description: string | null;
  appearance: Record<string, string | null>;
  stylingNotes: string | null;
  preferredLighting: string | null;
  photographyStyle: string | null;
}

const SHOT_DESCRIPTIONS: Record<ShotType, string> = {
  front: "front view, the model faces the camera",
  back: "back view, the model faces away from the camera to show the rear of the garment",
  side: "side profile view",
  three_quarter: "three-quarter view, body turned about 45 degrees",
  detail: "close-up detail shot focused on the garment construction and fabric",
};

const FRAMING_DESCRIPTIONS: Record<Framing, string> = {
  full_body: "full-body framing, head to toe",
  three_quarter_body: "three-quarter body framing, head to mid-thigh",
  waist_up: "waist-up framing",
  close_up: "close-up framing",
  detail_macro: "tight macro crop on garment details",
};

export function buildProductConstraints(product: ProductContext, refs: ReferenceImageLabel[]): string {
  const lines: string[] = [];
  lines.push("PRODUCT PRESERVATION REQUIREMENTS (highest priority):");
  const productRefs = refs.filter((r) => r.kind === "product");
  if (productRefs.length) {
    lines.push(
      `- Images ${productRefs.map((r) => `#${r.index} (${r.role})`).join(", ")} show the exact garment to be worn. ` +
        "Reproduce this garment exactly: same colours, fabric, lace and print patterns, straps, seams, closures, trims and silhouette.",
    );
  }
  lines.push("- Show exactly one instance of the garment, worn by one model. Do not add, remove or redesign garment elements.");
  lines.push("- Do not invent details that are not visible in the reference images (for example an unseen back or interior).");
  lines.push(`- Product: ${product.title} (SKU ${product.sku}).`);

  const verified = product.verifiedAttributes;
  if (verified && Object.keys(verified).length) {
    const facts = Object.entries(verified)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    if (facts.length) lines.push(`- Verified product attributes: ${facts.join("; ")}.`);
  } else {
    if (product.category) lines.push(`- Category (from catalog): ${product.category}.`);
    if (product.color) lines.push(`- Colour (from catalog): ${product.color}.`);
  }

  if (product.aiAnalysis) {
    const a = product.aiAnalysis;
    const hints = a.details
      .filter((d) => d.confidence !== "low")
      .slice(0, 8)
      .map((d) => `${d.element}: ${d.description}`);
    if (hints.length) {
      lines.push(`- Observed details (unverified hints, the reference images take precedence): ${hints.join("; ")}.`);
    }
  }
  return lines.join("\n");
}

export function buildCreativeDirection(style: ShootStyle): string {
  const lines: string[] = ["CREATIVE DIRECTION:"];
  lines.push(`- Shot: ${SHOT_DESCRIPTIONS[style.shotType]}.`);
  lines.push(`- Framing: ${FRAMING_DESCRIPTIONS[style.framing]}.`);
  if (style.pose) lines.push(`- Pose: ${style.pose}.`);
  if (style.cameraAngle) lines.push(`- Camera angle: ${style.cameraAngle}.`);
  if (style.background) lines.push(`- Background: ${style.background}.`);
  if (style.lighting) lines.push(`- Lighting: ${style.lighting}.`);
  if (style.creativeInstructions) lines.push(`- Additional styling notes: ${style.creativeInstructions}`);
  lines.push("- Photorealistic, high-end e-commerce fashion photography, sharp focus on the garment.");
  lines.push(`- ${REALISM}`);
  return lines.join("\n");
}

export function buildModelDirection(model: ModelContext | null, refs: ReferenceImageLabel[], persona?: string | null): string {
  if (!model && persona) {
    return [
      "MODEL:",
      `- A fictional, photorealistic adult fashion model (21+) suited to the garment: ${persona}.`,
      "- This is the same person in every image of this photo session: keep face, hair and body consistent with this description.",
      "- Do not resemble any real or famous person.",
    ].join("\n");
  }
  if (!model) {
    return "MODEL:\n- A photorealistic adult fashion model (21+) with a natural, professional look.";
  }
  const lines = [`MODEL (${model.displayName}, profile ${model.code}):`];
  const modelRefs = refs.filter((r) => r.kind === "model");
  if (modelRefs.length) {
    lines.push(
      `- Images ${modelRefs.map((r) => `#${r.index}`).join(", ")} show the model. Keep the same face, hair and overall identity as closely as possible.`,
    );
  }
  const appearance = Object.entries(model.appearance)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  if (appearance.length) lines.push(`- Appearance: ${appearance.join("; ")}.`);
  if (model.description) lines.push(`- Description: ${model.description}`);
  if (model.stylingNotes) lines.push(`- Styling: ${model.stylingNotes}`);
  if (model.photographyStyle) lines.push(`- Photography style: ${model.photographyStyle}`);
  lines.push("- The model is an adult (21+).");
  return lines.join("\n");
}

export function buildProductShotPrompt(input: {
  product: ProductContext;
  model: ModelContext | null;
  style: ShootStyle;
  refs: ReferenceImageLabel[];
  regenerationNote?: string | null;
  modelPersona?: string | null;
  styling?: string | null;
}): string {
  const sections = [
    "Create one photorealistic fashion e-commerce photograph.",
    buildProductConstraints(input.product, input.refs),
    buildModelDirection(input.model, input.refs, input.modelPersona),
    buildCreativeDirection(input.style),
  ];
  if (input.styling) {
    sections.push(`OUTFIT (identical in every photo of this shoot; must not cover or change the main garment):\n- ${input.styling}`);
  }
  if (input.regenerationNote) {
    sections.push(`REVIEWER FEEDBACK TO ADDRESS:\n- ${input.regenerationNote}`);
  }
  sections.push(`SAFETY:\n- ${SAFETY_BASELINE}`);
  return sections.join("\n\n");
}

/**
 * Short natural-language prompt for models such as FLUX.2 that take input
 * images by 0-based index ("image 0"). Same constraints as the detailed
 * prompt, condensed: garment fidelity first, then model, then direction.
 */
export function buildConciseProductShotPrompt(input: {
  product: ProductContext;
  model: ModelContext | null;
  style: ShootStyle;
  refs: ReferenceImageLabel[];
  regenerationNote?: string | null;
  modelPersona?: string | null;
  styling?: string | null;
}): string {
  const { product, model, style, refs } = input;
  const ref = (r: ReferenceImageLabel) => `image ${r.index - 1}`;
  const productRefs = refs.filter((r) => r.kind === "product");
  const modelRefs = refs.filter((r) => r.kind === "model");
  const parts: string[] = [];
  parts.push(
    `Photorealistic professional e-commerce fashion photograph of one adult fashion model (21+) wearing the exact garment shown in ${productRefs
      .map((r) => `${ref(r)} (${r.role} view)`)
      .join(", ")}.`,
  );
  parts.push(
    "Reproduce the garment exactly as photographed: identical colours, fabric texture, pattern and print placement, lace, straps, seams, buttons, closures, trims, cut and length. Do not redesign, simplify, recolour or restyle it, and do not add pockets, logos, text, embellishments or extra layers to it.",
  );
  const facts = [product.category, product.color].filter(Boolean).join(", ");
  parts.push(`Product: ${product.title}${facts ? ` (${facts})` : ""}.`);
  if (modelRefs.length) {
    parts.push(
      `The model is exactly the woman in ${modelRefs.map(ref).join(" and ")}: keep her face unchanged (same face shape, eyes, eyebrows, nose, lips, skin tone and complexion) and the same hair colour and style; do not beautify, age or alter her features.`,
    );
  } else if (!model && input.modelPersona) {
    parts.push(`The model is a fictional person: ${input.modelPersona}. Do not resemble any real or famous person.`);
  }
  if (model?.description) parts.push(`Model: ${model.description}.`);
  if (model) {
    const look = Object.entries(model.appearance)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`);
    if (look.length) parts.push(`Model appearance: ${look.join(", ")}.`);
  }
  parts.push(`${SHOT_DESCRIPTIONS[style.shotType]}, ${FRAMING_DESCRIPTIONS[style.framing]}.`);
  if (style.pose) parts.push(`Pose: ${style.pose}.`);
  if (style.cameraAngle) parts.push(`Camera: ${style.cameraAngle}.`);
  if (style.background) parts.push(`Setting: ${style.background}.`);
  if (style.lighting) parts.push(`Lighting: ${style.lighting}.`);
  if (input.styling) {
    parts.push(
      `Complete the outfit with exactly these items, identical in every photo of this shoot: ${input.styling}. They must not cover, overlap or change the main garment.`,
    );
  }
  if (style.creativeInstructions) parts.push(style.creativeInstructions);
  if (input.regenerationNote) parts.push(`Fix: ${input.regenerationNote}`);
  parts.push(REALISM);
  parts.push("Tasteful, non-explicit catalogue photo, sharp focus on the garment.");
  return parts.join(" ");
}

/**
 * Replica: apply a reference photo's photographic setup (analysed as text,
 * wardrobe removed — see scene.ts) to the chosen model wearing the exact
 * product. The reference image itself is not an input, so nothing from its
 * clothing can leak. Image numbering follows the provider: 0-based "image N"
 * (FLUX) or "Image #N" (Gemini), positions are 1-based here.
 */
export function buildReplicaPrompt(input: {
  product: ProductContext;
  /** Sanitized scene description (sceneToPrompt). */
  scene: string;
  garments: number[];
  models: number[];
  /** Fictional model description when no model reference is used. */
  persona?: string | null;
  format: "detailed" | "concise";
  instructions?: string;
}): string {
  const img = (n: number) => (input.format === "concise" ? `image ${n - 1}` : `Image #${n}`);
  const list = (ns: number[]) => ns.map(img).join(" and ");
  const parts: string[] = [];
  parts.push("Photorealistic fashion photograph recreating this exact photographic setup:");
  parts.push(input.scene);
  if (input.models.length) {
    parts.push(
      `The model is exactly the woman in ${list(input.models)}: keep her face unchanged (same face shape, eyes, eyebrows, nose, lips, skin tone and complexion) and her hair colour and style; do not beautify, age or alter her features.`,
    );
  } else if (input.persona) {
    parts.push(`The model is a fictional person: ${input.persona}. Do not resemble any real or famous person.`);
  }
  parts.push(
    `She wears ONLY the garment shown in ${list(input.garments)} (${input.product.title}), reproduced exactly as photographed: identical colours, fabric texture, pattern and print placement, lace, straps, seams, closures, trims, cut and length. Do not redesign it, add or remove elements, and do not add any other clothing, hosiery, jewellery or accessories that are not visible in ${list(input.garments)}.`,
  );
  if (input.instructions) parts.push(input.instructions);
  parts.push(REALISM);
  parts.push("Tasteful, non-explicit fashion photograph. The model is an adult (21+).");
  return parts.join(" ");
}

export function buildModelPortraitPrompt(model: ModelContext, instructions: string, hasReferences: boolean): string {
  const parts = [
    "Create a photorealistic studio reference portrait of a fashion model for a model casting card.",
    buildModelDirection(model, []),
    hasReferences
      ? "Use the provided reference images to keep the same identity (face, hair, skin tone)."
      : "This is a new, fictional model. Do not resemble any real or famous person.",
    "Framing: front view facing the camera and looking into the lens, head to waist, natural soft expression, plain light grey seamless background, soft even studio lighting, wearing a simple plain black fitted top.",
    REALISM,
  ];
  if (instructions) parts.push(`Additional instructions: ${instructions}`);
  parts.push(`SAFETY:\n- ${SAFETY_BASELINE}`);
  return parts.join("\n\n");
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", tr: "Turkish" };

/** Instruction for free-text fields; enum values must stay as defined in the schema. */
export function outputLanguageInstruction(language: string | undefined): string | null {
  if (!language || language === "en") return null;
  const name = LANGUAGE_NAMES[language];
  if (!name) return null;
  return `Write every free-text value (descriptions, summaries, issues, uncertainties, colour and category names) in ${name}. Keep enum values exactly as defined in the schema (in English).`;
}

export function buildAnalysisPrompt(images: { index: number; role: AssetRole }[], language?: string): string {
  return [
    "You are a meticulous fashion product analyst preparing data for catalog photography.",
    `You are given ${images.length} product reference image(s): ${images.map((i) => `#${i.index} = ${i.role}`).join(", ")}.`,
    "Describe ONLY what is visible. Never invent the back, interior or construction if it is not shown; record such gaps in `uncertainties` and `missingReferenceAngles`.",
    "Use confidence 'low' for anything ambiguous. Colours should be named as they appear under the given lighting.",
    "Assess image quality issues that would hurt AI reference use (blur, low resolution, heavy shadows, cropping, busy background, watermarks).",
    outputLanguageInstruction(language),
    "Respond with JSON matching the provided schema.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildQualityReviewPrompt(input: {
  productRefCount: number;
  modelRefCount: number;
  shotType: string | null;
  framing: string | null;
  background: string | null;
  language?: string;
}): string {
  const p = input.productRefCount;
  const m = input.modelRefCount;
  return [
    "You are a strict quality-control reviewer for AI-generated fashion product photography.",
    `Images #1..#${p} are the ORIGINAL product reference photos.` +
      (m ? ` Images #${p + 1}..#${p + m} are reference photos of the intended model.` : "") +
      ` The LAST image is the GENERATED result to review.`,
    "Compare the generated garment to the references and flag: colour changes; missing or altered elements (straps, seams, closures, trims); inconsistent lace/fabric/print patterns; silhouette changes; incorrect number of garments; anatomical or rendering artifacts (hands, limbs, fabric merging into skin); identity inconsistency with the model references" +
      (input.shotType ? `; wrong shot type (expected ${input.shotType})` : "") +
      (input.framing ? `; wrong framing (expected ${input.framing})` : "") +
      (input.background ? `; unexpected background (expected ${input.background})` : "") +
      ".",
    "Only flag what you can actually see. Your output is a screening signal for a human reviewer, not a final decision.",
    outputLanguageInstruction(input.language),
    "Respond with JSON matching the provided schema.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildVideoPrompt(input: {
  kind: "product" | "advertising";
  prompt: string;
  motionInstructions: string;
  brief: string;
}): string {
  const parts = [input.prompt.trim()];
  if (input.motionInstructions.trim()) parts.push(`Camera and motion: ${input.motionInstructions.trim()}`);
  if (input.kind === "advertising" && input.brief.trim()) parts.push(`Campaign brief: ${input.brief.trim()}`);
  parts.push(
    "Keep the garment exactly as shown in the source image (colours, fabric, details). Professional, tasteful, non-explicit fashion video featuring an adult model.",
  );
  return parts.join("\n");
}

export const VIDEO_NEGATIVE_PROMPT =
  "nudity, explicit content, distorted garment, changing clothing colours, extra limbs, warped hands, text overlays, watermarks, low quality";
