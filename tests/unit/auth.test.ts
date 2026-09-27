import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const claims = { current: null as null | { sub: string } };
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: claims.current ? { claims: claims.current } : null, error: null }) } }),
}));
const tick = vi.fn(async () => ({ claimed: 0 }));
vi.mock("@/server/jobs/worker", () => ({ runWorkerTick: tick }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));

const { middleware } = await import("@/middleware");
const { roleAtLeast } = await import("@/server/context");
const { assertUploadPath } = await import("@/server/storage");
const workerRoute = await import("@/app/api/jobs/run/route");

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  claims.current = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.BACKGROUND_JOB_SECRET = "s".repeat(40);
  delete process.env.CRON_SECRET;
  tick.mockClear();
});

describe("route protection (middleware)", () => {
  it("redirects anonymous users to login, preserving the target", async () => {
    const res = await middleware(new NextRequest("https://studio.test/products/abc"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/products/abc");
  });

  it("returns 401 JSON for anonymous API calls", async () => {
    const res = await middleware(new NextRequest("https://studio.test/api/export", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("lets signed-in users through and bounces them away from /login", async () => {
    claims.current = { sub: "user-1" };
    const ok = await middleware(new NextRequest("https://studio.test/products"));
    expect(ok.headers.get("location")).toBeNull();
    const login = await middleware(new NextRequest("https://studio.test/login"));
    expect(new URL(login.headers.get("location")!).pathname).toBe("/");
  });

  it("sends users to /setup when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await middleware(new NextRequest("https://studio.test/"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/setup");
  });
});

describe("role hierarchy", () => {
  it("orders viewer < editor < admin < owner", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "editor")).toBe(true);
    expect(roleAtLeast("editor", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
  });
});

describe("worker endpoint authentication", () => {
  it("rejects missing or wrong secrets without running the worker", async () => {
    const none = await workerRoute.POST(new NextRequest("https://studio.test/api/jobs/run", { method: "POST" }));
    expect(none.status).toBe(401);
    const wrong = await workerRoute.POST(
      new NextRequest("https://studio.test/api/jobs/run", { method: "POST", headers: { authorization: "Bearer nope" } }),
    );
    expect(wrong.status).toBe(401);
    expect(tick).not.toHaveBeenCalled();
  });

  it("runs a tick with the background secret or Vercel CRON_SECRET", async () => {
    const ok = await workerRoute.POST(
      new NextRequest("https://studio.test/api/jobs/run", { method: "POST", headers: { authorization: `Bearer ${"s".repeat(40)}` } }),
    );
    expect(ok.status).toBe(200);
    process.env.CRON_SECRET = "c".repeat(40);
    const cron = await workerRoute.GET(new NextRequest("https://studio.test/api/jobs/run", { headers: { authorization: `Bearer ${"c".repeat(40)}` } }));
    expect(cron.status).toBe(200);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe("asset upload path authorization", () => {
  const valid = `${ORG}/products/${PRODUCT}/source/0f0e0d0c-0b0a-4908-8706-050403020100.png`;
  it("accepts server-issued paths for the caller's org and entity", () => {
    expect(() => assertUploadPath(valid, ORG, "products", PRODUCT)).not.toThrow();
  });
  it("rejects other organizations, other entities, traversal and bad extensions", () => {
    expect(() => assertUploadPath(valid, OTHER, "products", PRODUCT)).toThrow();
    expect(() => assertUploadPath(valid, ORG, "products", OTHER)).toThrow();
    expect(() => assertUploadPath(valid, ORG, "models", PRODUCT)).toThrow();
    expect(() => assertUploadPath(`${ORG}/products/${PRODUCT}/source/../../${OTHER}/x.png`, ORG, "products", PRODUCT)).toThrow();
    expect(() => assertUploadPath(valid.replace(".png", ".svg"), ORG, "products", PRODUCT)).toThrow();
  });
});
