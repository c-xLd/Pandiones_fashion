import type { GenerateContentParameters, GenerateContentResponse, Part } from "@google/genai";
import type { TokenUsage } from "@/lib/domain/costs";
import { ProviderError } from "@/lib/domain/jobs";
import type { BinaryImage, ImageGenerationRequest, LabelledImage, StructuredVisionRequest } from "../types";

/**
 * Pure request construction and response parsing for the Gemini
 * generateContent API (@google/genai). Kept free of I/O for unit testing.
 */

export function imagePartsWithLabels(images: LabelledImage[]): Part[] {
  const parts: Part[] = [];
  images.forEach((image, i) => {
    parts.push({ text: `Image #${i + 1}: ${image.label}` });
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data.toString("base64") } });
  });
  return parts;
}

export function buildImageGenerationRequest(
  model: string,
  request: ImageGenerationRequest,
  opts: { sendImageSize: boolean },
): GenerateContentParameters {
  return {
    model,
    contents: [
      {
        role: "user",
        parts: [...imagePartsWithLabels(request.references), { text: request.prompt }],
      },
    ],
    config: {
      // Image models return interleaved text and image parts.
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: request.aspectRatio,
        ...(opts.sendImageSize ? { imageSize: request.imageSize } : {}),
      },
      ...(request.signal ? { abortSignal: request.signal } : {}),
    },
  };
}

export function buildStructuredVisionRequest(model: string, request: StructuredVisionRequest): GenerateContentParameters {
  return {
    model,
    contents: [
      {
        role: "user",
        parts: [...imagePartsWithLabels(request.images), { text: request.prompt }],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: request.jsonSchema,
      temperature: 0.2,
      ...(request.signal ? { abortSignal: request.signal } : {}),
    },
  };
}

export function extractUsage(response: Pick<GenerateContentResponse, "usageMetadata">): TokenUsage {
  const u = response.usageMetadata;
  if (!u) {
    return { inputTokens: null, outputTokens: null, outputImageTokens: null, thoughtsTokens: null, totalTokens: null };
  }
  const imageDetail = u.candidatesTokensDetails?.find((d) => d.modality === "IMAGE");
  return {
    inputTokens: u.promptTokenCount ?? null,
    outputTokens: u.candidatesTokenCount ?? null,
    outputImageTokens: imageDetail?.tokenCount ?? null,
    thoughtsTokens: u.thoughtsTokenCount ?? null,
    totalTokens: u.totalTokenCount ?? null,
  };
}

export interface ParsedImageResponse {
  images: BinaryImage[];
  text: string | null;
  finishReason: string | null;
  blockReason: string | null;
  requestId: string | null;
  resolvedModel: string | null;
}

export function parseImageResponse(
  response: Pick<GenerateContentResponse, "candidates" | "promptFeedback" | "responseId" | "modelVersion">,
): ParsedImageResponse {
  const candidate = response.candidates?.[0];
  const images: BinaryImage[] = [];
  const texts: string[] = [];
  for (const part of candidate?.content?.parts ?? []) {
    // Thought parts are the model's intermediate reasoning, not deliverables.
    if (part.thought) continue;
    if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("image/")) {
      images.push({ mimeType: part.inlineData.mimeType, data: Buffer.from(part.inlineData.data, "base64") });
    } else if (part.text) {
      texts.push(part.text);
    }
  }
  return {
    images,
    text: texts.length ? texts.join("\n").slice(0, 4000) : null,
    finishReason: candidate?.finishReason ?? null,
    blockReason: response.promptFeedback?.blockReason ?? null,
    requestId: response.responseId ?? null,
    resolvedModel: response.modelVersion ?? null,
  };
}

export function parseTextResponse(response: Pick<GenerateContentResponse, "candidates">): string | undefined {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  return text || undefined;
}

const SAFETY_FINISH_REASONS = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
]);

/** Turn an image response without images into a classified, non-retryable error. */
export function assertImagesPresent(parsed: ParsedImageResponse): void {
  if (parsed.images.length > 0) return;
  if (parsed.blockReason) {
    throw new ProviderError(`Request blocked by provider safety filters (${parsed.blockReason}).`, "permanent", "blocked", {
      blockReason: parsed.blockReason,
    });
  }
  if (parsed.finishReason && SAFETY_FINISH_REASONS.has(parsed.finishReason)) {
    throw new ProviderError(
      `Image withheld by provider safety filters (${parsed.finishReason}). Adjust the prompt or references.`,
      "permanent",
      "safety_filtered",
      { finishReason: parsed.finishReason },
    );
  }
  throw new ProviderError(
    `Provider returned no image (finish reason: ${parsed.finishReason ?? "unknown"}).`,
    // An empty answer with STOP is usually a one-off; allow a retry.
    parsed.finishReason === "STOP" || parsed.finishReason == null ? "transient" : "permanent",
    "no_image",
    { finishReason: parsed.finishReason, text: parsed.text?.slice(0, 500) ?? null },
  );
}
