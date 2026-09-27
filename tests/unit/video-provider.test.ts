import { describe, expect, it } from "vitest";
import { buildVideoRequest } from "@/lib/providers/video/gemini-veo";
import { videoJobConfigSchema } from "@/lib/domain/schemas";

const img = (s: string) => ({ mimeType: "image/jpeg", data: Buffer.from(s) });

describe("Veo request construction", () => {
  it("image-to-video: uses the first image as starting frame with documented config fields", () => {
    const req = buildVideoRequest("video-model", {
      prompt: "slow turn",
      negativePrompt: "nudity",
      image: img("a"),
      referenceImages: [],
      durationSeconds: 8,
      aspectRatio: "9:16",
      resolution: "720p",
    });
    expect(req.model).toBe("video-model");
    expect(req.source?.prompt).toBe("slow turn");
    expect(req.source?.image).toEqual({ imageBytes: Buffer.from("a").toString("base64"), mimeType: "image/jpeg" });
    expect(req.config).toMatchObject({
      numberOfVideos: 1,
      durationSeconds: 8,
      aspectRatio: "9:16",
      resolution: "720p",
      personGeneration: "allow_adult",
      negativePrompt: "nudity",
    });
    expect(req.config?.referenceImages).toBeUndefined();
  });

  it("reference mode: sends ASSET reference images and no starting frame", () => {
    const req = buildVideoRequest("video-model", {
      prompt: "campaign",
      negativePrompt: null,
      image: img("a"),
      referenceImages: [img("a"), img("b")],
      durationSeconds: 8,
      aspectRatio: "16:9",
      resolution: "1080p",
    });
    expect(req.source?.image).toBeUndefined();
    expect(req.config?.referenceImages).toHaveLength(2);
    expect(req.config?.referenceImages?.[0]?.referenceType).toBe("ASSET");
    expect(req.config?.negativePrompt).toBeUndefined();
  });

  it("video job config snapshot validates", () => {
    expect(
      videoJobConfigSchema.safeParse({
        kind: "product",
        prompt: "p",
        negativePrompt: null,
        durationSeconds: 8,
        aspectRatio: "9:16",
        resolution: "720p",
        sourceResultIds: ["4f0b8e0c-1c1a-4c1e-9a7a-2b1d3c4e5f60"],
        useReferenceImages: false,
      }).success,
    ).toBe(true);
  });
});
