import "server-only";
import { GoogleGenAI } from "@google/genai";
import { geminiConfig, type GeminiConfig } from "@/lib/env";
import { ProviderError, parseRetryHintMs, classifyError, sanitizeErrorMessage } from "@/lib/domain/jobs";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  StructuredVisionRequest,
  StructuredVisionResult,
  VisionProvider,
} from "../types";
import {
  assertImagesPresent,
  buildImageGenerationRequest,
  buildStructuredVisionRequest,
  extractUsage,
  parseImageResponse,
  parseTextResponse,
} from "./mapping";

export const GEMINI_PROVIDER = "gemini";

let client: { key: string; ai: GoogleGenAI } | null = null;

export function getGeminiClient(config: GeminiConfig = geminiConfig()): GoogleGenAI {
  if (client && client.key === config.apiKey) return client.ai;
  const ai = new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: {
      timeout: config.requestTimeoutMs,
      // Retries are owned by the durable job queue (backoff + jitter, attempt
      // accounting), so SDK-level retries are disabled to avoid multiplying them.
      retryOptions: { attempts: 1 },
    },
  });
  client = { key: config.apiKey, ai };
  return ai;
}

/** Normalise any SDK/network failure into a ProviderError without leaking secrets. */
export function toProviderError(error: unknown, context: string): ProviderError {
  if (error instanceof ProviderError) return error;
  const { classification, code, status } = classifyError(error);
  const raw = error instanceof Error ? error.message : String(error);
  const message = sanitizeErrorMessage(raw);
  let retryAfterMs: number | undefined;
  // Honour the provider's retry hint (free-tier per-minute limits).
  if (status === 429) retryAfterMs = parseRetryHintMs(raw) ?? 30_000;
  return new ProviderError(`${context}: ${message}`, classification, code, { status: status ?? null }, retryAfterMs);
}

export class GeminiImageProvider implements ImageGenerationProvider {
  readonly name = GEMINI_PROVIDER;
  readonly model: string;

  constructor(private readonly config: GeminiConfig = geminiConfig()) {
    this.model = config.imageModel;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (request.references.length > this.config.maxReferenceImages) {
      throw new ProviderError(
        `Too many reference images (${request.references.length}); the configured maximum is ${this.config.maxReferenceImages}.`,
        "permanent",
        "too_many_references",
      );
    }
    const ai = getGeminiClient(this.config);
    const params = buildImageGenerationRequest(this.model, request, { sendImageSize: this.config.sendImageSize });
    const started = Date.now();
    let response;
    try {
      response = await ai.models.generateContent(params);
    } catch (error) {
      throw toProviderError(error, "Gemini image generation failed");
    }
    const parsed = parseImageResponse(response);
    const result: ImageGenerationResult = {
      provider: this.name,
      model: this.model,
      resolvedModel: parsed.resolvedModel,
      requestId: parsed.requestId,
      usage: extractUsage(response),
      latencyMs: Date.now() - started,
      images: parsed.images,
      text: parsed.text,
      finishReason: parsed.finishReason,
      blockReason: parsed.blockReason,
    };
    try {
      assertImagesPresent(parsed);
    } catch (error) {
      // Attach usage so the caller can still record a (billed) failed call.
      if (error instanceof ProviderError) {
        Object.assign(error.details, { usage: result.usage, requestId: result.requestId, resolvedModel: result.resolvedModel });
      }
      throw error;
    }
    return result;
  }
}

export class GeminiVisionProvider implements VisionProvider {
  readonly name = GEMINI_PROVIDER;
  readonly model: string;

  constructor(private readonly config: GeminiConfig = geminiConfig()) {
    this.model = config.analysisModel;
  }

  async generateStructured(request: StructuredVisionRequest): Promise<StructuredVisionResult> {
    const ai = getGeminiClient(this.config);
    const started = Date.now();
    let response;
    try {
      response = await ai.models.generateContent(buildStructuredVisionRequest(this.model, request));
    } catch (error) {
      throw toProviderError(error, "Gemini analysis failed");
    }
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      throw new ProviderError(`Analysis blocked by provider (${blockReason}).`, "permanent", "blocked");
    }
    return {
      provider: this.name,
      model: this.model,
      resolvedModel: response.modelVersion ?? null,
      requestId: response.responseId ?? null,
      usage: extractUsage(response),
      latencyMs: Date.now() - started,
      text: parseTextResponse(response),
    };
  }
}

/** Live check that a configured model exists and supports the needed action. */
export async function checkGeminiModel(model: string, action: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const ai = getGeminiClient();
    const info = await ai.models.get({ model });
    const actions = info.supportedActions ?? [];
    if (actions.length && !actions.includes(action)) {
      return { ok: false, detail: `Model found but does not list "${action}" (supports: ${actions.join(", ")}).` };
    }
    return { ok: true, detail: `${info.displayName ?? info.name ?? model}${info.version ? ` (version ${info.version})` : ""}` };
  } catch (error) {
    return { ok: false, detail: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)) };
  }
}
