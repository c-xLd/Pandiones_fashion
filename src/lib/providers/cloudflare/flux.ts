import "server-only";
import sharp from "sharp";
import type { CloudflareConfig } from "@/lib/env";
import { ProviderError, classifyError } from "@/lib/domain/jobs";
import { classifyCloudflareError, fluxCost, fluxDimensions, sniffImageMime, type CloudflareErrorBody } from "@/lib/domain/flux";
import type { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from "../types";

export const CLOUDFLARE_PROVIDER = "cloudflare";
/** Longest edge of reference images sent to the model (keeps input tiles and upload small). */
const REFERENCE_MAX_EDGE = 1024;
const MAX_INPUT_IMAGES = 4;

async function prepareReference(data: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data: out, info } = await sharp(data)
    .rotate()
    .resize({ width: REFERENCE_MAX_EDGE, height: REFERENCE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { data: out, width: info.width, height: info.height };
}

/**
 * FLUX.2 ([klein] 4B by default) on Cloudflare Workers AI via the REST API.
 * Multipart form: prompt, width, height and up to four binary input images
 * (input_image_0..3), referenced in the prompt as "image 0".."image 3".
 * Response: { success, result: { image: base64 } }.
 */
export class CloudflareFluxImageProvider implements ImageGenerationProvider {
  readonly name = CLOUDFLARE_PROVIDER;
  readonly model: string;
  readonly promptFormat = "concise" as const;
  readonly maxReferenceImages = MAX_INPUT_IMAGES;

  constructor(
    private readonly config: CloudflareConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.model = config.imageModel;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (request.references.length > MAX_INPUT_IMAGES) {
      throw new ProviderError(
        `Too many reference images (${request.references.length}); this model accepts at most ${MAX_INPUT_IMAGES}.`,
        "permanent",
        "too_many_references",
      );
    }
    const size = fluxDimensions(request.aspectRatio, request.imageSize);
    const inputs = await Promise.all(request.references.map((r) => prepareReference(r.data)));

    const form = new FormData();
    form.append("prompt", request.prompt);
    form.append("width", String(size.width));
    form.append("height", String(size.height));
    inputs.forEach((img, i) => form.append(`input_image_${i}`, new Blob([new Uint8Array(img.data)], { type: "image/jpeg" }), `reference-${i}.jpg`));

    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/ai/run/${this.model}`;
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${this.config.apiToken}` }, body: form, signal });
    } catch (error) {
      const { classification, code } = classifyError(error);
      throw new ProviderError(`Cloudflare image generation failed: ${error instanceof Error ? error.message : String(error)}`, classification, code);
    }
    const requestId = response.headers.get("cf-ray");
    const body = (await response.json().catch(() => null)) as (CloudflareErrorBody & { result?: { image?: string } }) | null;
    if (!response.ok || !body || body.success === false) {
      const { classification, code, message } = classifyCloudflareError(response.status, body);
      throw new ProviderError(
        `Cloudflare image generation failed: ${message}`,
        classification,
        code,
        { status: response.status, requestId },
        response.status === 429 ? 30_000 : undefined,
      );
    }
    const base64 = body.result?.image;
    if (!base64) throw new ProviderError("Cloudflare returned no image.", "transient", "no_image", { requestId });
    const data = Buffer.from(base64, "base64");
    return {
      provider: this.name,
      model: this.model,
      resolvedModel: null,
      requestId,
      usage: { inputTokens: null, outputTokens: null, outputImageTokens: null, thoughtsTokens: null, totalTokens: null },
      latencyMs: Date.now() - started,
      images: [{ data, mimeType: sniffImageMime(data) }],
      text: null,
      finishReason: null,
      blockReason: null,
      cost: fluxCost(this.model, size, inputs),
    };
  }
}
