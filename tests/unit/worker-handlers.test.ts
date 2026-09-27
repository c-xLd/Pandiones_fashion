import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "../support/fake-supabase";
import { validAnalysisFixture } from "../fixtures/gemini";

const fake = { current: new FakeSupabase() };
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => fake.current }));

const { processJob } = await import("@/server/jobs/worker");
const { setProviderOverrides } = await import("@/lib/providers/registry");
const { ProviderError } = await import("@/lib/domain/jobs");
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  VideoGenerationProvider,
  VideoGenerationRequest,
  VisionProvider,
} from "@/lib/providers/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const WORKER = "worker-test";

async function png(w: number, h: number, color = { r: 20, g: 20, b: 20 }) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}

const usage = { inputTokens: 1000, outputTokens: 1300, outputImageTokens: 1290, thoughtsTokens: 0, totalTokens: 2300 };

class FakeImageProvider implements ImageGenerationProvider {
  readonly name = "gemini";
  readonly model = "gemini-3-pro-image-preview";
  calls: ImageGenerationRequest[] = [];
  constructor(private impl: (req: ImageGenerationRequest) => Promise<Buffer>) {}
  async generateImage(req: ImageGenerationRequest) {
    this.calls.push(req);
    const data = await this.impl(req);
    return {
      provider: this.name,
      model: this.model,
      resolvedModel: "gemini-3-pro-image-preview",
      requestId: "req-123",
      usage,
      latencyMs: 1234,
      images: [{ mimeType: "image/png", data }],
      text: null,
      finishReason: "STOP",
      blockReason: null,
    };
  }
}

async function seedProduct(db: FakeSupabase, org = ORG) {
  const [product] = db.seed("products", [{ organization_id: org, sku: "PX-1", title: "Lace bralette", status: "processing", tags: [] }]);
  const bytes = await png(600, 800);
  const path = `${org}/products/${product!.id}/source/a.png`;
  db.objects.set(path, { data: bytes });
  const [asset] = db.seed("product_assets", [
    { organization_id: org, product_id: product!.id, role: "front", storage_path: path, mime_type: "image/png", size_bytes: bytes.length, sha256: "x" },
  ]);
  return { product: product!, asset: asset! };
}

function seedImageJob(db: FakeSupabase, productId: string, assetIds: string[], extra: Record<string, unknown> = {}) {
  const [job] = db.seed("generation_jobs", [
    {
      organization_id: ORG,
      created_by: USER,
      job_type: "image_generation",
      provider: "gemini",
      model: "gemini-3-pro-image-preview",
      product_id: productId,
      model_profile_id: null,
      video_project_id: null,
      batch_id: "44444444-4444-4444-8444-444444444444",
      source_result_id: null,
      input_asset_refs: assetIds.map((id) => ({ kind: "product_asset", id })),
      config: {
        kind: "product_shot",
        style: {
          shotType: "front",
          pose: "",
          cameraAngle: "",
          framing: "full_body",
          background: "grey",
          lighting: "soft",
          aspectRatio: "3:4",
          imageSize: "2K",
          variations: 1,
          creativeInstructions: "",
        },
        presetId: null,
        productReferenceAssetIds: assetIds,
        modelReferenceAssetIds: [],
        variationIndex: 0,
        regenerationNote: null,
      },
      status: "processing",
      attempts: 1,
      max_attempts: 3,
      cancel_requested: false,
      locked_by: WORKER,
      provider_operation: null,
      idempotency_key: `k-${Math.random()}`,
      ...extra,
    },
  ]);
  return job!;
}

const job = (db: FakeSupabase, id: unknown) => db.table("generation_jobs").find((j) => j.id === id)!;

beforeEach(() => {
  fake.current = new FakeSupabase();
  process.env.GEMINI_ANALYSIS_MODEL = "gemini-2.5-flash";
  delete process.env.AUTO_QUALITY_REVIEW;
});
afterEach(() => setProviderOverrides({}));

describe("image generation job", () => {
  it("generates, stores the image, records usage and enqueues QC", async () => {
    const db = fake.current;
    const { product, asset } = await seedProduct(db);
    const j = seedImageJob(db, product.id as string, [asset.id as string]);
    const provider = new FakeImageProvider(() => png(768, 1024, { r: 200, g: 10, b: 10 }));
    setProviderOverrides({ image: provider });

    const outcome = await processJob(db as unknown as SupabaseClient, j as never, WORKER, 300);

    expect(outcome).toBe("succeeded");
    expect(job(db, j.id)).toMatchObject({ status: "succeeded", provider_request_id: "req-123", progress: 100 });
    // Request carried the product reference and prompt constraints.
    expect(provider.calls[0]!.references).toHaveLength(1);
    expect(provider.calls[0]!.references[0]!.label).toContain("front");
    expect(provider.calls[0]!.prompt).toContain("PRODUCT PRESERVATION REQUIREMENTS");
    expect(provider.calls[0]!.aspectRatio).toBe("3:4");
    // Result persisted with thumbnail, never overwriting the source.
    const [result] = db.table("generation_results");
    expect(result).toMatchObject({ organization_id: ORG, product_id: product.id, kind: "image", shot_type: "front", width: 768, height: 1024, qc_status: "queued" });
    expect(String(result!.storage_path).startsWith(`${ORG}/results/${j.id}/`)).toBe(true);
    expect(db.objects.has(result!.storage_path as string)).toBe(true);
    expect(db.objects.has(result!.thumbnail_path as string)).toBe(true);
    expect(db.objects.has(asset.storage_path as string)).toBe(true);
    // Usage ledger: estimated from token usage.
    const [ledger] = db.table("usage_ledger");
    expect(ledger).toMatchObject({ organization_id: ORG, job_id: j.id, cost_source: "estimated", succeeded: true, request_id: "req-123" });
    expect(Number(ledger!.cost_amount)).toBeGreaterThan(0);
    // Follow-up QC job, idempotent per result.
    const qc = db.table("generation_jobs").find((x) => x.job_type === "quality_review");
    expect(qc).toMatchObject({ idempotency_key: `qc:${result!.id}`, source_result_id: result!.id, status: "queued" });
    // Product leaves "processing" once no image jobs remain.
    expect(db.table("products")[0]!.status).toBe("completed");
  });

  it("re-queues transient provider failures with backoff and records the failed call", async () => {
    const db = fake.current;
    const { product, asset } = await seedProduct(db);
    const j = seedImageJob(db, product.id as string, [asset.id as string]);
    setProviderOverrides({
      image: new FakeImageProvider(async () => {
        throw new ProviderError("Gemini image generation failed: 503 overloaded", "transient", "http_503");
      }),
    });
    const outcome = await processJob(db as unknown as SupabaseClient, j as never, WORKER, 300);
    expect(outcome).toBe("retried");
    const updated = job(db, j.id);
    expect(updated.status).toBe("queued");
    expect(new Date(updated.run_after as string).getTime()).toBeGreaterThan(Date.now());
    expect(updated.error_code).toBe("http_503");
    expect(db.table("generation_results")).toHaveLength(0);
    expect(db.table("usage_ledger")[0]).toMatchObject({ succeeded: false, cost_source: "unknown" });
  });

  it("fails permanently on safety blocks without retrying", async () => {
    const db = fake.current;
    const { product, asset } = await seedProduct(db);
    const j = seedImageJob(db, product.id as string, [asset.id as string]);
    setProviderOverrides({
      image: new FakeImageProvider(async () => {
        throw new ProviderError("blocked", "permanent", "safety_filtered");
      }),
    });
    expect(await processJob(db as unknown as SupabaseClient, j as never, WORKER, 300)).toBe("failed");
    expect(job(db, j.id)).toMatchObject({ status: "failed", error_code: "safety_filtered" });
    expect(db.table("products")[0]!.status).toBe("completed");
  });

  it("discards output when cancellation is requested during generation", async () => {
    const db = fake.current;
    const { product, asset } = await seedProduct(db);
    const j = seedImageJob(db, product.id as string, [asset.id as string]);
    setProviderOverrides({
      image: new FakeImageProvider(async () => {
        job(db, j.id).cancel_requested = true;
        return png(768, 1024);
      }),
    });
    expect(await processJob(db as unknown as SupabaseClient, j as never, WORKER, 300)).toBe("cancelled");
    expect(job(db, j.id).status).toBe("cancelled");
    expect(db.table("generation_results")).toHaveLength(0);
    expect(db.table("usage_ledger")).toHaveLength(1); // the billed call is still recorded
  });

  it("refuses references from another tenant before calling the provider", async () => {
    const db = fake.current;
    const { product } = await seedProduct(db);
    const { asset: foreign } = await seedProduct(db, OTHER_ORG);
    const j = seedImageJob(db, product.id as string, [foreign.id as string]);
    const provider = new FakeImageProvider(() => png(768, 1024));
    setProviderOverrides({ image: provider });
    expect(await processJob(db as unknown as SupabaseClient, j as never, WORKER, 300)).toBe("failed");
    expect(job(db, j.id)).toMatchObject({ status: "failed", error_code: "reference_missing" });
    expect(provider.calls).toHaveLength(0);
  });

  it("does not overwrite a job whose lease was taken by another worker", async () => {
    const db = fake.current;
    const { product, asset } = await seedProduct(db);
    const j = seedImageJob(db, product.id as string, [asset.id as string]);
    setProviderOverrides({
      image: new FakeImageProvider(async () => {
        job(db, j.id).locked_by = "another-worker";
        return png(768, 1024);
      }),
    });
    await processJob(db as unknown as SupabaseClient, j as never, WORKER, 300);
    expect(job(db, j.id).status).toBe("processing");
  });
});

describe("product analysis job", () => {
  function seedAnalysisJob(db: FakeSupabase, productId: string, assetId: string) {
    return db.seed("generation_jobs", [
      {
        organization_id: ORG,
        created_by: USER,
        job_type: "product_analysis",
        provider: "gemini",
        model: "gemini-2.5-flash",
        product_id: productId,
        input_asset_refs: [{ kind: "product_asset", id: assetId }],
        config: {},
        status: "processing",
        attempts: 1,
        max_attempts: 3,
        cancel_requested: false,
        locked_by: WORKER,
        provider_operation: null,
        idempotency_key: `a-${Math.random()}`,
      },
    ])[0]!;
  }
  const vision = (text: string): VisionProvider => ({
    name: "gemini",
    model: "gemini-2.5-flash",
    generateStructured: async () => ({ provider: "gemini", model: "gemini-2.5-flash", resolvedModel: null, requestId: "r", usage, latencyMs: 1, text }),
  });

  it("stores validated analysis as unverified AI output", async () => {
    const db = fake.current;
    const { product, asset } = await seedProduct(db);
    const j = seedAnalysisJob(db, product.id as string, asset.id as string);
    setProviderOverrides({ vision: vision(JSON.stringify(validAnalysisFixture)) });
    expect(await processJob(db as unknown as SupabaseClient, j as never, WORKER, 300)).toBe("succeeded");
    const p = db.table("products")[0]!;
    expect(p.analysis_status).toBe("completed");
    expect((p.ai_analysis as { category: string }).category).toBe("bralette");
    expect(p.verified_attributes).toBeUndefined();
  });

  it("retries when the model returns output that fails the schema", async () => {
    const db = fake.current;
    const { product, asset } = await seedProduct(db);
    const j = seedAnalysisJob(db, product.id as string, asset.id as string);
    setProviderOverrides({ vision: vision('{"category": 5}') });
    expect(await processJob(db as unknown as SupabaseClient, j as never, WORKER, 300)).toBe("retried");
    expect(job(db, j.id).error_code).toBe("invalid_output");
  });
});

describe("video generation job", () => {
  class FakeVideo implements VideoGenerationProvider {
    readonly name = "gemini-veo";
    readonly model = "veo-3.1-generate-preview";
    submitted: VideoGenerationRequest[] = [];
    polls = 0;
    constructor(private doneAfter: number, private withVideo = true) {}
    async submit(req: VideoGenerationRequest) {
      this.submitted.push(req);
      return { operationId: "operations/op-1", provider: this.name, model: this.model };
    }
    async poll() {
      this.polls++;
      if (this.polls < this.doneAfter) return { done: false as const, progress: 40 };
      return {
        done: true as const,
        videos: this.withVideo ? [{ data: Buffer.from("fake-mp4-bytes"), mimeType: "video/mp4" }] : [],
        filteredCount: this.withVideo ? 0 : 1,
        filteredReasons: this.withVideo ? [] : ["policy"],
      };
    }
  }

  async function seedVideo(db: FakeSupabase, reviewStatus = "approved") {
    const { product } = await seedProduct(db);
    const bytes = await png(768, 1024);
    const [src] = db.seed("generation_results", [
      { organization_id: ORG, product_id: product.id, kind: "image", review_status: reviewStatus, storage_path: `${ORG}/results/x/src.png`, mime_type: "image/png", size_bytes: bytes.length },
    ]);
    db.objects.set(`${ORG}/results/x/src.png`, { data: bytes });
    const [project] = db.seed("video_projects", [{ organization_id: ORG, name: "v", kind: "product", status: "queued", source_result_ids: [src!.id] }]);
    const [j] = db.seed("generation_jobs", [
      {
        organization_id: ORG,
        created_by: USER,
        job_type: "video_generation",
        provider: "gemini-veo",
        model: "veo-3.1-generate-preview",
        product_id: product.id,
        video_project_id: project!.id,
        input_asset_refs: [],
        config: {
          kind: "product",
          prompt: "slow turn",
          negativePrompt: null,
          durationSeconds: 8,
          aspectRatio: "9:16",
          resolution: "720p",
          sourceResultIds: [src!.id],
          useReferenceImages: false,
        },
        status: "processing",
        attempts: 1,
        max_attempts: 2,
        cancel_requested: false,
        locked_by: WORKER,
        provider_operation: null,
        idempotency_key: `v-${Math.random()}`,
      },
    ]);
    return { project: project!, job: j! };
  }

  it("submits, polls across ticks, then stores the video and estimated cost", async () => {
    const db = fake.current;
    const { project, job: j } = await seedVideo(db);
    const provider = new FakeVideo(2);
    setProviderOverrides({ video: provider });
    const admin = db as unknown as SupabaseClient;

    expect(await processJob(admin, j as never, WORKER, 300)).toBe("pending");
    expect(job(db, j.id)).toMatchObject({ status: "processing", provider_operation: "operations/op-1", locked_by: null });
    expect(provider.submitted[0]!.image).not.toBeNull();
    expect(db.table("video_projects")[0]!.status).toBe("processing");

    // Next tick: a worker reclaims it (claim_jobs sets locked_by).
    job(db, j.id).locked_by = WORKER;
    expect(await processJob(admin, job(db, j.id) as never, WORKER, 300)).toBe("pending");
    expect(job(db, j.id).progress).toBe(40);

    job(db, j.id).locked_by = WORKER;
    expect(await processJob(admin, job(db, j.id) as never, WORKER, 300)).toBe("succeeded");
    expect(provider.submitted).toHaveLength(1); // never resubmitted
    const video = db.table("generation_results").find((r) => r.kind === "video")!;
    expect(video).toMatchObject({ video_project_id: project.id, mime_type: "video/mp4", duration_seconds: 8 });
    expect(db.objects.get(video.storage_path as string)?.data.toString()).toBe("fake-mp4-bytes");
    expect(db.table("video_projects")[0]!.status).toBe("ready");
    const ledger = db.table("usage_ledger")[0]!;
    expect(ledger).toMatchObject({ cost_source: "estimated", succeeded: true, units: { videos: 1, seconds: 8 } });
    expect(Number(ledger.cost_amount)).toBeGreaterThan(0);
  });

  it("refuses unapproved source images", async () => {
    const db = fake.current;
    const { job: j } = await seedVideo(db, "pending");
    const provider = new FakeVideo(1);
    setProviderOverrides({ video: provider });
    expect(await processJob(db as unknown as SupabaseClient, j as never, WORKER, 300)).toBe("failed");
    expect(job(db, j.id).error_code).toBe("source_not_approved");
    expect(provider.submitted).toHaveLength(0);
    expect(db.table("video_projects")[0]!.status).toBe("failed");
  });

  it("fails permanently when the provider filters the video", async () => {
    const db = fake.current;
    const { job: j } = await seedVideo(db);
    setProviderOverrides({ video: new FakeVideo(1, false) });
    const admin = db as unknown as SupabaseClient;
    await processJob(admin, j as never, WORKER, 300);
    job(db, j.id).locked_by = WORKER;
    expect(await processJob(admin, job(db, j.id) as never, WORKER, 300)).toBe("failed");
    expect(job(db, j.id).error_code).toBe("safety_filtered");
  });

  it("honours cancellation between polls", async () => {
    const db = fake.current;
    const { job: j } = await seedVideo(db);
    setProviderOverrides({ video: new FakeVideo(5) });
    const admin = db as unknown as SupabaseClient;
    await processJob(admin, j as never, WORKER, 300);
    Object.assign(job(db, j.id), { locked_by: WORKER, cancel_requested: true });
    expect(await processJob(admin, job(db, j.id) as never, WORKER, 300)).toBe("cancelled");
    expect(db.table("video_projects")[0]!.status).toBe("cancelled");
  });
});
