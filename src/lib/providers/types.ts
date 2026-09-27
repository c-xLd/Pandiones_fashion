import type { CostEstimate, TokenUsage } from "@/lib/domain/costs";

/**
 * Provider-independent contracts. The job handlers depend only on these
 * interfaces, so a provider can be replaced without touching the workflow.
 */

export interface BinaryImage {
  mimeType: string;
  data: Buffer;
}

export interface LabelledImage extends BinaryImage {
  /** Human-readable label placed before the image in the request. */
  label: string;
}

export interface CallMetadata {
  provider: string;
  /** Model ID requested. */
  model: string;
  /** Model version reported by the provider, when available. */
  resolvedModel: string | null;
  requestId: string | null;
  usage: TokenUsage;
  latencyMs: number;
}

export interface ImageGenerationRequest {
  prompt: string;
  references: LabelledImage[];
  aspectRatio: string;
  imageSize: string;
  signal?: AbortSignal;
}

export interface ImageGenerationResult extends CallMetadata {
  images: BinaryImage[];
  text: string | null;
  finishReason: string | null;
  blockReason: string | null;
  /** Provider-specific estimate when usage is not token based. */
  cost?: CostEstimate;
}

export interface ImageGenerationProvider {
  readonly name: string;
  readonly model: string;
  /**
   * "detailed": long sectioned prompt with numbered references (Gemini).
   * "concise": short natural-language prompt with 0-based "image N" references (FLUX).
   */
  readonly promptFormat?: "detailed" | "concise";
  /** Hard limit on reference images, when the model has one. */
  readonly maxReferenceImages?: number;
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

export interface StructuredVisionRequest {
  prompt: string;
  images: LabelledImage[];
  jsonSchema: unknown;
  signal?: AbortSignal;
}

export interface StructuredVisionResult extends CallMetadata {
  text: string | undefined;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(request: StructuredVisionRequest): Promise<StructuredVisionResult>;
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------
export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt: string | null;
  /** Starting frame (image-to-video). */
  image: BinaryImage | null;
  /** Additional asset reference images, when the model supports them. */
  referenceImages: BinaryImage[];
  durationSeconds: number;
  aspectRatio: string;
  resolution: string;
}

export interface VideoSubmission {
  operationId: string;
  provider: string;
  model: string;
}

export type VideoPollResult =
  | { done: false; progress: number | null }
  | {
      done: true;
      videos: { data: Buffer; mimeType: string }[];
      filteredCount: number;
      filteredReasons: string[];
    };

export interface VideoGenerationProvider {
  readonly name: string;
  readonly model: string;
  submit(request: VideoGenerationRequest): Promise<VideoSubmission>;
  poll(operationId: string): Promise<VideoPollResult>;
}
