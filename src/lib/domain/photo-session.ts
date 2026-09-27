import type { Framing, ShotType } from "./schemas";

/**
 * A "photo session" turns one garment + one model into a varied set of shots,
 * like a real shoot: different poses, camera angles, framings and locations.
 * Planning is pure and seeded (by the request's idempotency key) so a retried
 * request produces exactly the same plan.
 */

export const SESSION_LOCATIONS = [
  "studio_white",
  "studio_color",
  "city_street",
  "cafe",
  "luxury_interior",
  "beach",
  "nature",
  "rooftop",
  "loft",
] as const;
export type SessionLocation = (typeof SESSION_LOCATIONS)[number];

export const SESSION_SHOT_COUNTS = [4, 6, 8, 12] as const;
export const MAX_SESSION_SHOTS = 12;
export const MAX_SESSION_LOCATIONS = 6;

/** Prompt text per location (English: this goes to the model, not the UI). */
export const LOCATION_PROMPTS: Record<SessionLocation, { background: string; lighting: string }> = {
  studio_white: { background: "seamless pure white studio backdrop", lighting: "soft, even high-key studio lighting" },
  studio_color: {
    background: "seamless pastel-coloured studio backdrop that complements the garment colours",
    lighting: "soft key light with gentle shadows",
  },
  city_street: {
    background: "stylish European city street with softly blurred storefronts and cobblestones",
    lighting: "natural soft daylight",
  },
  cafe: { background: "bright modern café interior with wooden tables, softly blurred", lighting: "warm natural window light" },
  luxury_interior: {
    background: "elegant luxury interior with marble, brass accents and tall windows",
    lighting: "soft diffused window light",
  },
  beach: { background: "sunny sandy beach with gentle sea waves in the background", lighting: "warm golden-hour sunlight" },
  nature: { background: "lush green park with trees and soft bokeh", lighting: "dappled natural daylight" },
  rooftop: { background: "city rooftop terrace with the skyline at sunset", lighting: "warm sunset backlight with soft fill light" },
  loft: {
    background: "minimal industrial loft with concrete walls and large windows",
    lighting: "cool natural window light",
  },
};

const POSES = {
  relaxed: "standing relaxed with the weight on one leg, arms loosely by the sides",
  walking: "walking toward the camera mid-stride with a natural arm swing",
  hip: "one hand on the hip, confident stance",
  overShoulder: "glancing back over the shoulder",
  leaning: "leaning casually against a wall or surface",
  pockets: "hands lightly in the pockets or at the waist, relaxed posture",
  adjusting: "gently adjusting the sleeve or collar",
  turning: "turning mid-movement so the fabric flows naturally",
  seated: "seated upright on a simple stool or step with the garment clearly visible",
  armsCrossed: "standing tall with arms loosely crossed and a friendly expression",
} as const;
type PoseKey = keyof typeof POSES;

/** Poses that make sense for each shot type (a seated back view does not). */
const POSES_BY_SHOT: Record<ShotType, PoseKey[]> = {
  front: ["relaxed", "walking", "hip", "leaning", "pockets", "adjusting", "seated", "armsCrossed"],
  three_quarter: ["relaxed", "walking", "hip", "leaning", "pockets", "adjusting", "turning"],
  side: ["relaxed", "walking", "turning", "leaning"],
  back: ["relaxed", "overShoulder", "turning"],
  detail: ["relaxed", "adjusting"],
};

const ANGLES = [
  "eye level",
  "slightly low angle for an elongated silhouette",
  "slightly high angle",
  "eye level with a slightly off-centre composition",
] as const;

/** Commerce-first order: the essential views come first, then variety. */
const SHOT_SEQUENCE: ShotType[] = ["front", "three_quarter", "back", "detail", "side", "front", "three_quarter", "front", "back", "three_quarter", "side", "front"];

export interface PlannedShot {
  shotType: ShotType;
  framing: Framing;
  pose: string;
  cameraAngle: string;
  location: SessionLocation;
  background: string;
  lighting: string;
}

/** Small deterministic PRNG (mulberry32) seeded from a string. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function framingFor(shot: ShotType, index: number): Framing {
  if (shot === "detail") return "detail_macro";
  if (shot === "front" || shot === "three_quarter") return index % 3 === 2 ? "three_quarter_body" : "full_body";
  return "full_body";
}

export function planPhotoSession(input: { count: number; locations: readonly SessionLocation[]; seed: string }): PlannedShot[] {
  const count = Math.max(1, Math.min(MAX_SESSION_SHOTS, Math.floor(input.count)));
  const unique = Array.from(new Set(input.locations));
  if (!unique.length) throw new Error("At least one location is required");
  const rand = seededRandom(input.seed);
  const locations = shuffle(unique, rand);
  const usedPoses = new Map<ShotType, PoseKey[]>();
  const shots: PlannedShot[] = [];
  for (let i = 0; i < count; i++) {
    const shotType = SHOT_SEQUENCE[i % SHOT_SEQUENCE.length] as ShotType;
    // Cycle through a shuffled pose list per shot type so poses repeat as late as possible.
    let queue = usedPoses.get(shotType);
    if (!queue || queue.length === 0) queue = shuffle(POSES_BY_SHOT[shotType], rand);
    const poseKey = queue.shift() as PoseKey;
    usedPoses.set(shotType, queue);
    const location = locations[i % locations.length] as SessionLocation;
    shots.push({
      shotType,
      framing: framingFor(shotType, i),
      pose: shotType === "detail" ? `${POSES[poseKey]}, framed so the garment details fill the image` : POSES[poseKey],
      cameraAngle: ANGLES[Math.floor(rand() * ANGLES.length)] as string,
      location,
      ...LOCATION_PROMPTS[location],
    });
  }
  return shots;
}

const PERSONA = {
  age: ["mid 20s", "late 20s", "early 30s"],
  skin: ["fair porcelain", "light olive", "warm golden", "sun-kissed tan", "deep brown", "rich ebony"],
  hair: [
    "long glossy dark brown waves",
    "sleek straight black hair past the shoulders",
    "honey-blonde balayage in soft waves",
    "copper-auburn hair in loose curls",
    "chic chestnut bob",
    "long platinum-blonde hair",
    "voluminous natural dark curls",
  ],
  eyes: ["hazel eyes", "deep brown eyes", "green eyes", "light blue eyes", "grey-blue eyes"],
  face: [
    "high cheekbones and a defined jawline",
    "soft oval face with full lips",
    "delicate features and a warm natural smile",
    "striking symmetrical features",
    "heart-shaped face with a light dusting of freckles",
  ],
  build: ["slim model figure", "tall athletic model figure", "graceful slender figure"],
};

/**
 * A fictional female fashion model reused for every shot of a session so the
 * same person appears throughout (text only: identity can still drift
 * between images without a reference photo — casting a model fixes that).
 */
export function randomModelPersona(seed: string): string {
  const rand = seededRandom(`persona:${seed}`);
  function pick<T>(list: readonly T[]): T {
    return list[Math.floor(rand() * list.length)] as T;
  }
  return `a beautiful professional female fashion model, age ${pick(PERSONA.age)}, ${pick(PERSONA.skin)} skin, ${pick(PERSONA.hair)}, ${pick(PERSONA.eyes)}, ${pick(PERSONA.face)}, ${pick(PERSONA.build)}`;
}
