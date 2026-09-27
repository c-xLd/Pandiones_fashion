import { describe, expect, it } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import {
  assertImagesPresent,
  buildImageGenerationRequest,
  buildStructuredVisionRequest,
  extractUsage,
  parseImageResponse,
  parseTextResponse,
} from "@/lib/providers/gemini/mapping";
import { ProviderError } from "@/lib/domain/jobs";
import { imageResponseFixture } from "../fixtures/gemini";

const ref = (label: string) => ({ label, mimeType: "image/jpeg", data: Buffer.from("fake-bytes") });

describe("Gemini request construction", () => {
  it("interleaves labelled reference images before the prompt and requests IMAGE output", () => {
    const req = buildImageGenerationRequest(
      "image-model-x",
      { prompt: "PROMPT", references: [ref("product front"), ref("model")], aspectRatio: "3:4", imageSize: "2K" },
      { sendImageSize: true },
    );
    expect(req.model).toBe("image-model-x");
    const parts = (req.contents as { parts: Record<string, unknown>[] }[])[0]!.parts;
    expect(parts.map((p) => Object.keys(p)[0])).toEqual(["text", "inlineData", "text", "inlineData", "text"]);
    expect(parts[0]).toEqual({ text: "Image #1: product front" });
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: Buffer.from("fake-bytes").toString("base64") } });
    expect(parts[4]).toEqual({ text: "PROMPT" });
    expect(req.config?.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(req.config?.imageConfig).toEqual({ aspectRatio: "3:4", imageSize: "2K" });
  });

  it("omits imageSize when the model does not accept it", () => {
    const req = buildImageGenerationRequest("m", { prompt: "p", references: [], aspectRatio: "1:1", imageSize: "4K" }, { sendImageSize: false });
    expect(req.config?.imageConfig).toEqual({ aspectRatio: "1:1" });
  });

  it("requests JSON with a response schema for analysis", () => {
    const schema = { type: "object" };
    const req = buildStructuredVisionRequest("vision-model", { prompt: "analyse", images: [ref("front")], jsonSchema: schema });
    expect(req.config?.responseMimeType).toBe("application/json");
    expect(req.config?.responseJsonSchema).toBe(schema);
  });
});

describe("Gemini response parsing", () => {
  it("extracts only non-thought image parts and text", () => {
    const parsed = parseImageResponse(imageResponseFixture() as unknown as GenerateContentResponse);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]!.mimeType).toBe("image/png");
    expect(parsed.images[0]!.data.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(parsed.text).toBe("Here is the catalog photo.");
    expect(parsed.requestId).toBe("fixture-response-id");
    expect(parsed.resolvedModel).toBe("fixture-image-model-001");
    expect(parsed.finishReason).toBe("STOP");
  });

  it("reads token usage including image-modality output tokens", () => {
    expect(extractUsage(imageResponseFixture() as unknown as GenerateContentResponse)).toEqual({
      inputTokens: 1000,
      outputTokens: 1300,
      outputImageTokens: 1290,
      thoughtsTokens: 200,
      totalTokens: 2500,
    });
    expect(extractUsage({} as GenerateContentResponse).inputTokens).toBeNull();
  });

  it("joins text for structured output and ignores thoughts", () => {
    const res = { candidates: [{ content: { parts: [{ text: "ignored", thought: true }, { text: '{"a":' }, { text: "1}" }] } }] };
    expect(parseTextResponse(res as unknown as GenerateContentResponse)).toBe('{"a":1}');
  });

  it("classifies blocked and empty responses", () => {
    const blocked = parseImageResponse({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, candidates: [] } as unknown as GenerateContentResponse);
    expect(() => assertImagesPresent(blocked)).toThrow(ProviderError);
    try {
      assertImagesPresent(blocked);
    } catch (e) {
      expect((e as ProviderError).classification).toBe("permanent");
      expect((e as ProviderError).code).toBe("blocked");
    }
    const safety = parseImageResponse({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] } as unknown as GenerateContentResponse);
    expect(() => assertImagesPresent(safety)).toThrow(/safety/);
    const empty = parseImageResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "sorry" }] } }] } as unknown as GenerateContentResponse);
    try {
      assertImagesPresent(empty);
      expect.unreachable();
    } catch (e) {
      expect((e as ProviderError).classification).toBe("transient");
      expect((e as ProviderError).code).toBe("no_image");
    }
  });
});
