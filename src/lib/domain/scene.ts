import { z } from "zod";

/**
 * Scene analysis for the replica studio: a reference photo is reduced to its
 * photographic setup (camera, framing, pose, light, background, style) as
 * text. The reference image itself is never sent to the image model, so its
 * clothing, fabrics, colours, patterns and accessories cannot leak into the
 * output. A keyword filter removes any wardrobe mention the vision model lets
 * slip through.
 */

export const SCENE_FIELDS = [
  "cameraAngle",
  "shotDistance",
  "framing",
  "orientation",
  "pose",
  "hands",
  "headAndGaze",
  "expression",
  "lighting",
  "background",
  "surface",
  "props",
  "colorGrading",
  "photographyStyle",
] as const;
export type SceneField = (typeof SCENE_FIELDS)[number];

export const sceneAnalysisSchema = z.object(
  Object.fromEntries(SCENE_FIELDS.map((f) => [f, z.string().max(600)])) as Record<SceneField, z.ZodString>,
);
export type SceneAnalysis = z.infer<typeof sceneAnalysisSchema>;

const FIELD_HELP: Record<SceneField, string> = {
  cameraAngle: "Camera height and angle relative to the subject (e.g. slightly above eye level, looking down 15°).",
  shotDistance: "Shot size and lens feel (e.g. full body, 50mm, moderate distance).",
  framing: "Crop and composition: where the body sits in the frame, what is cut off, headroom, negative space.",
  orientation: "Portrait or landscape and approximate aspect.",
  pose: "Exact body position: seated/standing/lying, torso angle, weight, leg positions and directions. Body only.",
  hands: "Where each hand/arm is and what it rests on.",
  headAndGaze: "Head tilt/turn and where the eyes look.",
  expression: "Facial expression and mood.",
  lighting: "Light direction, softness, contrast, shadows, colour temperature.",
  background: "Background: wall/set, colour and texture of the set only.",
  surface: "Floor or surface the model is on, if any.",
  props: "Non-clothing props or furniture, or 'none'.",
  colorGrading: "Overall colour grade and tonality of the photo (not of clothing).",
  photographyStyle: "Genre and style (e.g. minimal editorial e-commerce, studio, natural).",
};

export const sceneAnalysisJsonSchema = {
  type: "object",
  properties: Object.fromEntries(SCENE_FIELDS.map((f) => [f, { type: "string", description: FIELD_HELP[f] }])),
  required: [...SCENE_FIELDS],
} as const;

export const SCENE_ANALYSIS_PROMPT = [
  "You are a photography director. Analyse the reference photo and describe ONLY its photographic setup so it can be",
  "recreated with a different model wearing a different garment.",
  "Describe: camera angle, shot distance/lens, framing and crop, orientation, the exact body pose, hand and arm",
  "placement, head and gaze, expression, lighting, background set, floor/surface, non-clothing props, colour grading",
  "and photography style.",
  "STRICTLY FORBIDDEN: do not mention or describe any clothing, garment, underwear, hosiery/tights, fabric, material,",
  "lace, pattern, print, garment colour, sleeves, necklines, jewellery, accessories, shoes, bags, hair colour or the",
  "person's identity or physical traits. Describe the body position as if the person wore nothing notable.",
  "Write in English, concise but precise.",
].join(" ");

/**
 * Wardrobe vocabulary that must never reach the generation prompt from a
 * reference. Words with common photography meanings ("top of the frame",
 * "ring light", "sitting on her heels") are deliberately not listed.
 */
const WARDROBE =
  /\b(cloth(es|ing)?|garments?|outfits?|wear(s|ing)?|dress(es|ed)?|gown|shirt|blouse|bodysuit|body ?suit|leotard|lingerie|bra|bralette|briefs?|panties|underwear|tights|stockings?|hosiery|pantyhose|socks?|sleeves?|long-sleeved|neckline|collar|fabric|material|lace|lacy|mesh|sheer|knit|silk|satin|cotton|denim|leather|pattern(ed)?|print(ed)?|floral|stripes?|jewell?ery|earrings?|bracelets?|necklaces?|accessor(y|ies)|shoes?|boots|sneakers|bags?|belt|hat|scarf|brunette|blonde|redhead|hair colou?r)\b/i;

/** Remove every sentence/clause that mentions wardrobe; keep the rest with its punctuation. */
export function stripWardrobe(text: string): string {
  const pieces = text.split(/([.;!?](?:\s+|$)|,\s+(?=[a-z]))/);
  let out = "";
  for (let i = 0; i < pieces.length; i += 2) {
    const part = pieces[i] ?? "";
    const sep = pieces[i + 1] ?? "";
    if (!part.trim()) continue;
    if (WARDROBE.test(part)) {
      // Dropping the end of a sentence: close the sentence we kept so far.
      if (/[.;!?]/.test(sep) && /,\s*$/.test(out)) out = out.replace(/,\s*$/, ". ");
      continue;
    }
    out += part + sep;
  }
  return out.replace(/\s+/g, " ").replace(/[,;]\s*$/, "").trim();
}

export function sanitizeScene(scene: SceneAnalysis): SceneAnalysis {
  return Object.fromEntries(SCENE_FIELDS.map((f) => [f, stripWardrobe(scene[f])])) as SceneAnalysis;
}

const LABELS: Record<SceneField, string> = {
  cameraAngle: "Camera angle",
  shotDistance: "Shot and lens",
  framing: "Framing",
  orientation: "Orientation",
  pose: "Pose",
  hands: "Hands and arms",
  headAndGaze: "Head and gaze",
  expression: "Expression",
  lighting: "Lighting",
  background: "Background",
  surface: "Surface",
  props: "Props",
  colorGrading: "Colour grading",
  photographyStyle: "Style",
};

/** The sanitized setup as prompt lines (empty fields are skipped). */
export function sceneToPrompt(scene: SceneAnalysis): string {
  return SCENE_FIELDS.filter((f) => scene[f] && !/^none\.?$/i.test(scene[f]))
    .map((f) => `${LABELS[f]}: ${scene[f].replace(/\.$/, "")}.`)
    .join(" ");
}
