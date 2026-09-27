import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_URL, addMember, createOrg, createTestDatabase, createUser, type TestDb } from "../db/helpers";
import { validAnalysisFixture } from "../fixtures/gemini";

/**
 * End-to-end test through a real PostgREST server (the API layer Supabase
 * uses) on top of the real migrations. Verifies supabase-js query shapes,
 * RLS via JWT claims, the claim_jobs RPC and the full worker loop with
 * mocked AI providers. Storage is served by an in-memory stub.
 *
 * Enabled when TEST_DATABASE_URL and POSTGREST_BIN (path to a postgrest
 * binary, https://github.com/PostgREST/postgrest/releases) are set.
 */
const POSTGREST_BIN = process.env.POSTGREST_BIN;
const JWT_SECRET = "e2e-test-secret-that-is-at-least-32-characters-long";
const BASE = "http://supabase.e2e.test";

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })}`;
  return `${body}.${createHmac("sha256", JWT_SECRET).update(body).digest("base64url")}`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

describe.skipIf(!ADMIN_URL || !POSTGREST_BIN)("end-to-end through PostgREST", () => {
  let db: TestDb;
  let proc: ChildProcess;
  let restUrl: string;
  const storage = new Map<string, Buffer>();
  const realFetch = globalThis.fetch;
  let owner: string, viewer: string, outsider: string;
  let org: string, otherOrg: string;
  let userClient: (sub: string) => SupabaseClient;

  beforeAll(async () => {
    db = await createTestDatabase();
    const dbUrl = new URL(ADMIN_URL!);
    const dbName = (await db.pool.query("select current_database() as d")).rows[0].d as string;
    await db.pool.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login password 'authpw' noinherit; end if; end $$");
    await db.pool.query("grant anon, authenticated, service_role to authenticator");
    const port = await freePort();
    restUrl = `http://127.0.0.1:${port}`;
    proc = spawn(POSTGREST_BIN!, [], {
      env: {
        ...process.env,
        PGRST_DB_URI: `postgres://authenticator:authpw@${dbUrl.hostname}:${dbUrl.port || 5432}/${dbName}`,
        PGRST_DB_SCHEMAS: "public",
        PGRST_DB_ANON_ROLE: "anon",
        PGRST_JWT_SECRET: JWT_SECRET,
        PGRST_SERVER_PORT: String(port),
        PGRST_SERVER_HOST: "127.0.0.1",
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await realFetch(`${restUrl}/`)).ok) break;
      } catch {
        /* not ready */
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    // Route supabase-js traffic: REST -> PostgREST, Storage -> in-memory stub.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== BASE) return realFetch(input, init);
      if (url.pathname.startsWith("/rest/v1")) {
        return realFetch(`${restUrl}${url.pathname.slice("/rest/v1".length)}${url.search}`, init);
      }
      const method = (init?.method ?? "GET").toUpperCase();
      const m = /^\/storage\/v1\/object\/(?:authenticated\/|public\/)?([^/]+)\/(.+)$/.exec(url.pathname);
      if (m && method === "POST") {
        const body = init?.body;
        const buf =
          body instanceof Blob
            ? Buffer.from(await body.arrayBuffer())
            : body instanceof ArrayBuffer
              ? Buffer.from(body)
              : Buffer.from(body as Uint8Array);
        storage.set(decodeURIComponent(m[2]!), buf);
        return new Response(JSON.stringify({ Key: `${m[1]}/${m[2]}` }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (m && method === "GET") {
        const data = storage.get(decodeURIComponent(m[2]!));
        return data ? new Response(new Uint8Array(data), { status: 200 }) : new Response(JSON.stringify({ error: "not found" }), { status: 400 });
      }
      return new Response(JSON.stringify({ error: `unhandled ${method} ${url.pathname}` }), { status: 404 });
    }) as typeof fetch;

    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
    process.env.SUPABASE_SECRET_KEY = jwt({ role: "service_role" });
    process.env.BACKGROUND_JOB_SECRET = "x".repeat(40);
    process.env.GEMINI_ANALYSIS_MODEL = "gemini-2.5-flash";
    userClient = (sub) =>
      createClient(BASE, jwt({ role: "authenticated", sub }), { auth: { persistSession: false, autoRefreshToken: false } });

    owner = await createUser(db.pool, "owner@e2e.test");
    viewer = await createUser(db.pool, "viewer@e2e.test");
    outsider = await createUser(db.pool, "outsider@e2e.test");
    org = await createOrg(db.pool, owner, "E2EOrg");
    otherOrg = await createOrg(db.pool, outsider, "OtherE2E");
    await addMember(db.pool, org, viewer, "viewer");
  }, 60_000);

  afterAll(async () => {
    globalThis.fetch = realFetch;
    proc?.kill();
    await db?.drop();
  });

  it("runs a product shot from enqueue to QC through the real worker loop", async () => {
    const owners = userClient(owner);
    const { data: product, error: pErr } = await owners.from("products").insert({ organization_id: org, sku: "E2E-1", title: "E2E bralette" }).select("id").single();
    expect(pErr).toBeNull();
    const source = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#222" } }).png().toBuffer();
    const assetPath = `${org}/products/${product!.id}/source/${randomUUID()}.png`;
    storage.set(assetPath, source);
    const { data: asset, error: aErr } = await owners
      .from("product_assets")
      .insert({ organization_id: org, product_id: product!.id, role: "front", storage_path: assetPath, mime_type: "image/png", size_bytes: source.length, sha256: "e2e" })
      .select("id")
      .single();
    expect(aErr).toBeNull();

    // Enqueue exactly as enqueueJobs() does (idempotent upsert via the user's client).
    const { toJobInsert } = await import("@/server/jobs/insert");
    const input = {
      jobType: "image_generation" as const,
      provider: "gemini",
      model: "gemini-3-pro-image-preview",
      idempotencyKey: `e2e-${randomUUID()}`,
      productId: product!.id as string,
      inputAssetRefs: [{ kind: "product_asset", id: asset!.id as string }],
      config: {
        kind: "product_shot",
        style: { shotType: "front", pose: "", cameraAngle: "", framing: "full_body", background: "grey", lighting: "soft", aspectRatio: "3:4", imageSize: "2K", variations: 1, creativeInstructions: "" },
        presetId: null,
        productReferenceAssetIds: [asset!.id],
        modelReferenceAssetIds: [],
        variationIndex: 0,
        regenerationNote: null,
      },
    };
    const row = toJobInsert(org, owner, input);
    const first = await owners.from("generation_jobs").upsert([row], { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true }).select("id");
    expect(first.error).toBeNull();
    expect(first.data).toHaveLength(1);
    const dup = await owners.from("generation_jobs").upsert([row], { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true }).select("id");
    expect(dup.error).toBeNull();
    expect(dup.data).toHaveLength(0);

    // Viewers and outsiders cannot enqueue.
    const viewerInsert = await userClient(viewer).from("generation_jobs").insert(toJobInsert(org, viewer, { ...input, idempotencyKey: `v-${randomUUID()}` }));
    expect(viewerInsert.error?.code).toBe("42501");

    const { setProviderOverrides } = await import("@/lib/providers/registry");
    const generated = await sharp({ create: { width: 768, height: 1024, channels: 3, background: "#a33" } }).png().toBuffer();
    setProviderOverrides({
      image: {
        name: "gemini",
        model: "gemini-3-pro-image-preview",
        generateImage: async () => ({
          provider: "gemini",
          model: "gemini-3-pro-image-preview",
          resolvedModel: "gemini-3-pro-image-preview",
          requestId: "e2e-req",
          usage: { inputTokens: 800, outputTokens: 1120, outputImageTokens: 1120, thoughtsTokens: 0, totalTokens: 1920 },
          latencyMs: 5,
          images: [{ mimeType: "image/png", data: generated }],
          text: null,
          finishReason: "STOP",
          blockReason: null,
        }),
      },
      vision: {
        name: "gemini",
        model: "gemini-2.5-flash",
        generateStructured: async () => ({
          provider: "gemini",
          model: "gemini-2.5-flash",
          resolvedModel: null,
          requestId: "e2e-qc",
          usage: { inputTokens: 500, outputTokens: 80, outputImageTokens: null, thoughtsTokens: null, totalTokens: 580 },
          latencyMs: 5,
          text: JSON.stringify({ verdict: "needs_review", flags: [{ type: "color_change", severity: "medium", description: "slightly redder" }], summary: "check colour" }),
        }),
      },
    });

    const { runWorkerTick } = await import("@/server/jobs/worker");
    const summary = await runWorkerTick({ timeBudgetMs: 20_000, workerId: "e2e-worker" });
    setProviderOverrides({});
    // Image job, then the follow-up QC job in the same tick.
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);

    const { data: results } = await owners.from("generation_results").select("*").eq("product_id", product!.id);
    expect(results).toHaveLength(1);
    expect(results![0]).toMatchObject({ kind: "image", qc_status: "flagged", review_status: "pending", shot_type: "front" });
    expect(storage.has(results![0].storage_path)).toBe(true);
    const { data: jobs } = await owners.from("generation_jobs").select("job_type, status, attempts, provider_request_id").order("created_at");
    expect(jobs).toEqual([
      expect.objectContaining({ job_type: "image_generation", status: "succeeded", attempts: 1, provider_request_id: "e2e-req" }),
      expect.objectContaining({ job_type: "quality_review", status: "succeeded" }),
    ]);
    const { data: ledger } = await owners.from("usage_ledger").select("job_type, cost_source, succeeded");
    expect(ledger).toHaveLength(2);
    expect(ledger!.every((l) => l.cost_source === "estimated" && l.succeeded)).toBe(true);

    // Outsiders see none of it.
    const outsiderView = await userClient(outsider).from("generation_results").select("id");
    expect(outsiderView.data).toEqual([]);

    // Review with column-restricted update; storage_path cannot be changed.
    const approve = await owners.from("generation_results").update({ review_status: "approved", reviewed_by: owner, reviewed_at: new Date().toISOString() }).eq("id", results![0].id).select("id");
    expect(approve.data).toHaveLength(1);
    const tamper = await owners.from("generation_results").update({ storage_path: `${otherOrg}/x.png` }).eq("id", results![0].id);
    expect(tamper.error?.code).toBe("42501");
  }, 60_000);

  it("stores validated analysis via the worker", async () => {
    const owners = userClient(owner);
    const { data: product } = await owners.from("products").insert({ organization_id: org, sku: "E2E-2", title: "Analysed" }).select("id").single();
    const bytes = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#fff" } }).png().toBuffer();
    const path = `${org}/products/${product!.id}/source/${randomUUID()}.png`;
    storage.set(path, bytes);
    const { data: asset } = await owners
      .from("product_assets")
      .insert({ organization_id: org, product_id: product!.id, role: "front", storage_path: path, mime_type: "image/png", size_bytes: bytes.length, sha256: "e2e2" })
      .select("id")
      .single();
    const { toJobInsert } = await import("@/server/jobs/insert");
    await owners.from("generation_jobs").insert(
      toJobInsert(org, owner, {
        jobType: "product_analysis",
        provider: "gemini",
        model: "gemini-2.5-flash",
        idempotencyKey: `an-${randomUUID()}`,
        productId: product!.id as string,
        inputAssetRefs: [{ kind: "product_asset", id: asset!.id as string }],
      }),
    );
    const { setProviderOverrides } = await import("@/lib/providers/registry");
    setProviderOverrides({
      vision: {
        name: "gemini",
        model: "gemini-2.5-flash",
        generateStructured: async () => ({
          provider: "gemini",
          model: "gemini-2.5-flash",
          resolvedModel: "gemini-2.5-flash",
          requestId: "an",
          usage: { inputTokens: 300, outputTokens: 200, outputImageTokens: null, thoughtsTokens: 0, totalTokens: 500 },
          latencyMs: 1,
          text: JSON.stringify(validAnalysisFixture),
        }),
      },
    });
    const { runWorkerTick } = await import("@/server/jobs/worker");
    await runWorkerTick({ timeBudgetMs: 10_000, workerId: "e2e-worker-2" });
    setProviderOverrides({});
    const { data } = await owners.from("products").select("analysis_status, ai_analysis").eq("id", product!.id).single();
    expect(data!.analysis_status).toBe("completed");
    expect(data!.ai_analysis.category).toBe("bralette");
  }, 60_000);

  it("supports the query shapes used by the studio pages", async () => {
    const owners = userClient(owner);
    // Products list: substring search + first asset thumbnail.
    const list = await owners
      .from("products")
      .select("*, product_assets(thumbnail_path, role)", { count: "exact" })
      .eq("organization_id", org)
      .or("sku.ilike.%E2E%,title.ilike.%E2E%")
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .range(0, 24)
      .limit(1, { referencedTable: "product_assets" });
    expect(list.error).toBeNull();
    expect(list.count).toBe(2);
    expect(list.data!.every((p) => p.product_assets.length <= 1)).toBe(true);

    // Presets: system + own organization.
    const presets = await owners.from("shoot_presets").select("*").or(`organization_id.is.null,organization_id.eq.${org}`);
    expect(presets.error).toBeNull();
    expect(presets.data!.length).toBeGreaterThanOrEqual(5);

    // Review grid filtered by batch via inner join.
    const review = await owners
      .from("generation_results")
      .select("*, products(sku), generation_jobs!inner(batch_id)", { count: "exact" })
      .eq("organization_id", org)
      .eq("kind", "image")
      .eq("generation_jobs.batch_id", randomUUID());
    expect(review.error).toBeNull();
    expect(review.count).toBe(0);

    // Jobs list with product SKU embed; media library embeds.
    const jobs = await owners.from("generation_jobs").select("*, products(sku)").eq("organization_id", org).in("status", ["queued", "processing", "succeeded"]);
    expect(jobs.error).toBeNull();
    expect(jobs.data!.some((j) => j.products?.sku === "E2E-1")).toBe(true);
    const lib = await owners.from("generation_results").select("*, products(sku), model_profiles(code)").eq("organization_id", org);
    expect(lib.error).toBeNull();

    // Reporting RPCs.
    const now = new Date();
    const args = { p_org: org, p_from: new Date(now.getTime() - 86400_000).toISOString(), p_to: new Date(now.getTime() + 86400_000).toISOString() };
    for (const [fn, a] of [
      ["usage_breakdown", args],
      ["usage_daily", args],
      ["usage_by_product", { ...args, p_limit: 20 }],
      ["org_storage_usage", { p_org: org }],
      ["queue_health", { p_org: org }],
      ["org_month_spend", { p_org: org }],
    ] as const) {
      const res = await owners.rpc(fn, a);
      expect(res.error, fn).toBeNull();
    }
    const breakdown = await owners.rpc("usage_breakdown", args);
    expect((breakdown.data as { calls: number }[]).reduce((s, r) => s + Number(r.calls), 0)).toBe(3);

    // Membership lookup as used by the session context.
    const members = await owners.from("organization_members").select("organization_id, role, organizations(name)").eq("user_id", owner);
    expect(members.data).toEqual([{ organization_id: org, role: "owner", organizations: { name: "E2EOrg" } }]);

    // Cancel RPC through the API.
    const { toJobInsert } = await import("@/server/jobs/insert");
    const { data: j } = await owners
      .from("generation_jobs")
      .insert(toJobInsert(org, owner, { jobType: "product_analysis", provider: "gemini", model: "m", idempotencyKey: `c-${randomUUID()}`, runAfter: new Date(Date.now() + 3600_000) }))
      .select("id")
      .single();
    const cancel = await owners.rpc("cancel_job", { p_job_id: j!.id });
    expect(cancel.data).toBe("cancelled");
    const foreignCancel = await userClient(outsider).rpc("cancel_job", { p_job_id: j!.id });
    expect(foreignCancel.error).not.toBeNull();
  }, 60_000);

  it("anonymous API access returns nothing", async () => {
    const anon = createClient(BASE, jwt({ role: "anon" }), { auth: { persistSession: false } });
    const res = await anon.from("products").select("id");
    expect(res.data ?? []).toEqual([]);
  });
});

vi.setConfig({ testTimeout: 60_000 });
