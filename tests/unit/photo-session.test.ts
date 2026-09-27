import { describe, expect, it } from "vitest";
import {
  LOCATION_PROMPTS,
  MAX_SESSION_SHOTS,
  SESSION_LOCATIONS,
  planPhotoSession,
  randomModelPersona,
  seededRandom,
} from "@/lib/domain/photo-session";
import { buildModelDirection } from "@/lib/domain/prompts";
import { continuationDelayMs } from "@/lib/domain/jobs";
import { photoSessionRequestSchema, shootStyleSchema } from "@/lib/domain/schemas";

describe("planPhotoSession", () => {
  it("is deterministic for the same seed and differs across seeds", () => {
    const a = planPhotoSession({ count: 8, locations: ["studio_white", "beach"], seed: "seed-1" });
    const b = planPhotoSession({ count: 8, locations: ["studio_white", "beach"], seed: "seed-1" });
    const c = planPhotoSession({ count: 8, locations: ["studio_white", "beach"], seed: "seed-2" });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("covers the essential e-commerce views first", () => {
    const shots = planPhotoSession({ count: 4, locations: ["studio_white"], seed: "x" });
    expect(shots.map((s) => s.shotType)).toEqual(["front", "three_quarter", "back", "detail"]);
    expect(shots.find((s) => s.shotType === "detail")?.framing).toBe("detail_macro");
  });

  it("spreads shots across every selected location and varies poses", () => {
    const shots = planPhotoSession({ count: 12, locations: ["cafe", "rooftop", "nature"], seed: "spread" });
    expect(shots).toHaveLength(12);
    expect(new Set(shots.map((s) => s.location))).toEqual(new Set(["cafe", "rooftop", "nature"]));
    for (const s of shots) {
      expect(s.background).toBe(LOCATION_PROMPTS[s.location].background);
      expect(s.lighting).toBe(LOCATION_PROMPTS[s.location].lighting);
    }
    const frontPoses = shots.filter((s) => s.shotType === "front").map((s) => s.pose);
    expect(new Set(frontPoses).size).toBe(frontPoses.length);
  });

  it("never plans a seated pose for back views", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const backs = planPhotoSession({ count: 12, locations: ["loft"], seed }).filter((s) => s.shotType === "back");
      for (const s of backs) expect(s.pose).not.toMatch(/seated/);
    }
  });

  it("clamps the count and produces valid shoot styles", () => {
    const shots = planPhotoSession({ count: 50, locations: ["studio_color"], seed: "clamp" });
    expect(shots).toHaveLength(MAX_SESSION_SHOTS);
    for (const s of shots) {
      const parsed = shootStyleSchema.safeParse({ ...s, aspectRatio: "3:4", imageSize: "1K", variations: 1, creativeInstructions: "" });
      expect(parsed.success).toBe(true);
    }
  });

  it("requires a location", () => {
    expect(() => planPhotoSession({ count: 4, locations: [], seed: "none" })).toThrow();
  });

  it("has a prompt for every location", () => {
    for (const l of SESSION_LOCATIONS) expect(LOCATION_PROMPTS[l].background.length).toBeGreaterThan(10);
  });
});

describe("random model persona", () => {
  it("is stable per seed and describes an adult", () => {
    expect(randomModelPersona("k")).toBe(randomModelPersona("k"));
    expect(randomModelPersona("k")).toMatch(/^age (mid|late|early) (20s|30s)/);
  });

  it("is used in the model direction only when there is no profile", () => {
    const text = buildModelDirection(null, [], "age late 20s, fair skin");
    expect(text).toContain("age late 20s, fair skin");
    expect(text).toContain("same person in every image");
    expect(text).toContain("21+");
    expect(buildModelDirection(null, [])).not.toContain("same person");
  });

  it("seededRandom stays within [0, 1)", () => {
    const r = seededRandom("range");
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("photoSessionRequestSchema", () => {
  const base = {
    productId: "7f1c1e0e-7a4b-4c7e-9a55-0d6c5a1d2b3c",
    modelProfileId: null,
    locations: ["studio_white"],
    count: 6,
    aspectRatio: "3:4",
    idempotencyKey: "abcdefgh-1234",
  };
  it("accepts a valid request and defaults to a random model", () => {
    const parsed = photoSessionRequestSchema.parse(base);
    expect(parsed.randomModel).toBe(true);
    expect(parsed.instructions).toBe("");
  });
  it("rejects unknown locations, empty locations and oversized sessions", () => {
    expect(photoSessionRequestSchema.safeParse({ ...base, locations: ["moon"] }).success).toBe(false);
    expect(photoSessionRequestSchema.safeParse({ ...base, locations: [] }).success).toBe(false);
    expect(photoSessionRequestSchema.safeParse({ ...base, count: 13 }).success).toBe(false);
  });
});

describe("continuationDelayMs", () => {
  const now = 1_000_000;
  it("waits until the next job is due, within bounds", () => {
    expect(continuationDelayMs(now + 5_000, now, 100_000)).toBe(5_000);
    expect(continuationDelayMs(now - 60_000, now, 100_000)).toBe(1_000);
    expect(continuationDelayMs(now + 600_000, now, 100_000)).toBe(15_000);
  });
  it("never sleeps past the invocation's remaining time", () => {
    expect(continuationDelayMs(now + 10_000, now, 8_000)).toBe(3_000);
    expect(continuationDelayMs(now + 10_000, now, 2_000)).toBe(0);
  });
});
