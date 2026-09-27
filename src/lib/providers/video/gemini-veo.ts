import "server-only";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GenerateVideosOperation,
  VideoGenerationReferenceType,
  type GenerateVideosParameters,
} from "@google/genai";
import { ProviderError, sanitizeErrorMessage } from "@/lib/domain/jobs";
import { getGeminiClient, toProviderError } from "../gemini/client";
import type { VideoGenerationProvider, VideoGenerationRequest, VideoPollResult, VideoSubmission } from "../types";

export const VEO_PROVIDER = "gemini-veo";

/**
 * Veo through the Gemini API (@google/genai `models.generateVideos`).
 * Generation is a long-running operation; completion is detected by polling
 * `operations.getVideosOperation` from the background worker (no browser
 * tab or in-memory promise is involved).
 */
export function buildVideoRequest(model: string, request: VideoGenerationRequest): GenerateVideosParameters {
  const useReferences = request.referenceImages.length > 0;
  return {
    model,
    source: {
      prompt: request.prompt,
      // Reference-image mode and a starting frame are mutually exclusive.
      ...(!useReferences && request.image
        ? { image: { imageBytes: request.image.data.toString("base64"), mimeType: request.image.mimeType } }
        : {}),
    },
    config: {
      numberOfVideos: 1,
      durationSeconds: request.durationSeconds,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      personGeneration: "allow_adult",
      ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
      ...(useReferences
        ? {
            referenceImages: request.referenceImages.map((img) => ({
              image: { imageBytes: img.data.toString("base64"), mimeType: img.mimeType },
              referenceType: VideoGenerationReferenceType.ASSET,
            })),
          }
        : {}),
    },
  };
}

export class GeminiVeoProvider implements VideoGenerationProvider {
  readonly name = VEO_PROVIDER;

  constructor(readonly model: string) {}

  async submit(request: VideoGenerationRequest): Promise<VideoSubmission> {
    const ai = getGeminiClient();
    try {
      const operation = await ai.models.generateVideos(buildVideoRequest(this.model, request));
      if (!operation.name) {
        throw new ProviderError("Video provider did not return an operation name.", "permanent", "no_operation");
      }
      return { operationId: operation.name, provider: this.name, model: this.model };
    } catch (error) {
      throw toProviderError(error, "Veo video submission failed");
    }
  }

  async poll(operationId: string): Promise<VideoPollResult> {
    const ai = getGeminiClient();
    const handle = new GenerateVideosOperation();
    handle.name = operationId;
    let operation: GenerateVideosOperation;
    try {
      operation = await ai.operations.getVideosOperation({ operation: handle });
    } catch (error) {
      throw toProviderError(error, "Veo operation status check failed");
    }
    if (!operation.done) {
      const progress = Number((operation.metadata as { progressPercent?: unknown } | undefined)?.progressPercent);
      return { done: false, progress: Number.isFinite(progress) ? progress : null };
    }
    if (operation.error) {
      const message = sanitizeErrorMessage(JSON.stringify(operation.error));
      throw new ProviderError(`Video generation failed: ${message}`, "permanent", "operation_failed", {
        error: operation.error,
      });
    }
    const generated = operation.response?.generatedVideos ?? [];
    const videos: { data: Buffer; mimeType: string }[] = [];
    for (const item of generated) {
      if (!item.video) continue;
      if (item.video.videoBytes) {
        videos.push({ data: Buffer.from(item.video.videoBytes, "base64"), mimeType: item.video.mimeType ?? "video/mp4" });
        continue;
      }
      const tmp = path.join(os.tmpdir(), `veo-${randomUUID()}.mp4`);
      try {
        await ai.files.download({ file: item, downloadPath: tmp });
        videos.push({ data: await readFile(tmp), mimeType: item.video.mimeType ?? "video/mp4" });
      } catch (error) {
        throw toProviderError(error, "Downloading the generated video failed");
      } finally {
        await rm(tmp, { force: true });
      }
    }
    return {
      done: true,
      videos,
      filteredCount: operation.response?.raiMediaFilteredCount ?? 0,
      filteredReasons: operation.response?.raiMediaFilteredReasons ?? [],
    };
  }
}
