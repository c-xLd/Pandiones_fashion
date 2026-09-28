import { describe, expect, it } from "vitest";
import { SCENE_ANALYSIS_PROMPT, SCENE_FIELDS, sanitizeScene, sceneAnalysisSchema, sceneToPrompt, stripWardrobe } from "@/lib/domain/scene";

describe("stripWardrobe", () => {
  it("drops clauses that mention clothing, fabric, patterns or accessories", () => {
    const text = stripWardrobe(
      "Seated on the floor, leaning on the right arm, wearing a black lace bodysuit with long sleeves. Legs extended to the left, black tights visible. Gold bracelet on the left wrist.",
    );
    expect(text).toContain("Seated on the floor");
    expect(text).toContain("leaning on the right arm");
    expect(text).not.toMatch(/lace|bodysuit|sleeves|tights|bracelet|black/i);
    expect(text).toBe("Seated on the floor, leaning on the right arm. Legs extended to the left.");
  });
  it("keeps photography terms that look like wardrobe words", () => {
    expect(stripWardrobe("Head near the top of the frame.")).toBe("Head near the top of the frame.");
    expect(stripWardrobe("Soft ring light from the front.")).toBe("Soft ring light from the front.");
    expect(stripWardrobe("Kneeling, sitting back on her heels.")).toBe("Kneeling, sitting back on her heels.");
  });
});

describe("scene prompt", () => {
  const scene = Object.fromEntries(SCENE_FIELDS.map((f) => [f, `${f} value`])) as ReturnType<typeof sceneAnalysisSchema.parse>;
  it("sanitizes every field and renders labelled lines", () => {
    const dirty = { ...scene, pose: "Seated, wearing a lace bodysuit.", props: "none" };
    const clean = sanitizeScene(sceneAnalysisSchema.parse(dirty));
    expect(clean.pose).toBe("Seated.");
    const text = sceneToPrompt(clean);
    expect(text).toContain("Camera angle: cameraAngle value.");
    expect(text).not.toMatch(/lace|bodysuit|Props/);
  });
  it("forbids wardrobe in the analysis instructions", () => {
    expect(SCENE_ANALYSIS_PROMPT).toMatch(/STRICTLY FORBIDDEN/);
    expect(SCENE_ANALYSIS_PROMPT).toMatch(/clothing/);
    expect(SCENE_ANALYSIS_PROMPT).toMatch(/jewellery/);
  });
});
