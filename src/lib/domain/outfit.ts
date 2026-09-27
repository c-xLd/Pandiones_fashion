import { seededRandom } from "./photo-session";

/**
 * Session styling: the uploaded product is one piece of an outfit. The other
 * pieces (e.g. the bottom and shoes for a top) are chosen once per session
 * and repeated verbatim in every shot, so all photos show the same look.
 * Pure and seeded by the request's idempotency key.
 */

export const GARMENT_TYPES = ["top", "bottom", "dress", "outerwear", "shoes", "accessory"] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

const KEYWORDS: Record<GarmentType, RegExp> = {
  // Checked in this order; dress before top so "shirt dress" is a dress.
  dress: /\b(dress|gown|jumpsuit|romper|playsuit|slip dress)\b|elbise|tulum|abiye/i,
  outerwear: /\b(jacket|coat|blazer|parka|trench|cardigan|vest|gilet)\b|ceket|mont|kaban|trenç|hırka|yelek|blazer/i,
  bottom: /\b(pants?|trousers|jeans|skirt|shorts|leggings|joggers)\b|pantolon|etek|şort|tayt|eşofman alt|jean/i,
  shoes: /\b(shoes?|sneakers?|boots?|heels?|sandals?|loafers?|pumps?)\b|ayakkabı|bot|çizme|topuklu|sandalet|terlik/i,
  accessory: /\b(bag|handbag|hat|cap|scarf|belt|necklace|earrings?|bracelet|sunglasses|jewelry|jewellery)\b|çanta|şapka|atkı|şal|kemer|kolye|küpe|bileklik|gözlük|takı/i,
  top: /\b(top|shirt|t-?shirt|tee|blouse|sweater|jumper|hoodie|sweatshirt|tank|camisole|bodysuit|polo|crop|bra|bralette|corset)\b|gömlek|tişört|bluz|kazak|body|atlet|büstiyer|sütyen|crop/i,
};

const ORDER: GarmentType[] = ["dress", "outerwear", "bottom", "shoes", "accessory", "top"];

/** Best-effort garment type from catalog/AI category and title; defaults to "top". */
export function inferGarmentType(...texts: (string | null | undefined)[]): GarmentType {
  const text = texts.filter(Boolean).join(" ");
  for (const type of ORDER) if (KEYWORDS[type].test(text)) return type;
  return "top";
}

const PIECES = {
  bottom: [
    "high-waisted straight-leg light-blue denim jeans",
    "tailored black wide-leg trousers",
    "beige high-waisted pleated trousers",
    "black satin midi slip skirt",
    "white straight-leg jeans",
    "dark indigo slim jeans",
  ],
  top: [
    "a plain white fitted crew-neck t-shirt",
    "a black ribbed fitted tank top",
    "a cream silk camisole",
    "a light-grey fine-knit top",
  ],
  shoes: [
    "white minimal leather sneakers",
    "black pointed-toe heeled pumps",
    "nude strappy heeled sandals",
    "black leather ankle boots",
    "tan leather loafers",
  ],
  accessories: [
    "thin gold hoop earrings",
    "a delicate gold chain necklace",
    "small silver stud earrings",
    "a slim black leather belt",
    "minimal gold rings",
  ],
};

/** Complementary pieces for the uploaded garment type (text, identical across the session). */
export function planOutfit(type: GarmentType, seed: string): string {
  const rand = seededRandom(`outfit:${seed}`);
  function pick(list: readonly string[]): string {
    return list[Math.floor(rand() * list.length)] as string;
  }
  const items: string[] = [];
  if (type === "top" || type === "outerwear") items.push(pick(PIECES.bottom));
  if (type === "outerwear") items.push(pick(PIECES.top));
  if (type === "bottom" || type === "shoes" || type === "accessory") items.push(pick(PIECES.top));
  if (type === "shoes" || type === "accessory") items.push(pick(PIECES.bottom));
  if (type !== "shoes") items.push(pick(PIECES.shoes));
  if (type !== "accessory") items.push(pick(PIECES.accessories));
  return items.join(", ");
}
