import { describe, expect, it } from "vitest";
import {
  ProviderError,
  backoffDelayMs,
  canTransition,
  classifyError,
  decideRetry,
  isTerminal,
  sanitizeErrorMessage,
} from "@/lib/domain/jobs";
import { patchForFailure, patchForOutcome } from "@/server/jobs/policy";

const now = new Date("2026-09-27T12:00:00Z");

describe("job state transitions", () => {
  it("allows only the documented transitions", () => {
    expect(canTransition("queued", "processing")).toBe(true);
    expect(canTransition("processing", "succeeded")).toBe(true);
    expect(canTransition("processing", "queued")).toBe(true);
    expect(canTransition("queued", "succeeded")).toBe(false);
    expect(canTransition("succeeded", "queued")).toBe(false);
    expect(canTransition("failed", "processing")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("processing")).toBe(false);
  });
});

describe("retry policy", () => {
  it("uses exponential backoff with bounded jitter", () => {
    expect(backoffDelayMs(1, { random: () => 0 })).toBe(2500);
    expect(backoffDelayMs(1, { random: () => 1 })).toBe(5000);
    expect(backoffDelayMs(3, { random: () => 1 })).toBe(20000);
    expect(backoffDelayMs(30, { random: () => 1 })).toBe(300000);
    const a = backoffDelayMs(2, { random: () => 0.3 });
    expect(a).toBeGreaterThanOrEqual(5000);
    expect(a).toBeLessThanOrEqual(10000);
  });

  it("retries only transient failures and respects max attempts", () => {
    expect(decideRetry({ classification: "transient", attempts: 1, maxAttempts: 3, random: () => 0 }).action).toBe("retry");
    expect(decideRetry({ classification: "transient", attempts: 3, maxAttempts: 3 }).action).toBe("fail");
    expect(decideRetry({ classification: "permanent", attempts: 1, maxAttempts: 3 }).action).toBe("fail");
    expect(decideRetry({ classification: "transient", attempts: 1, maxAttempts: 3, retryAfterMs: 60000, random: () => 0 }).delayMs).toBe(60000);
  });

  it("classifies HTTP, network and timeout errors", () => {
    expect(classifyError({ status: 429, message: "quota" }).classification).toBe("transient");
    expect(classifyError({ status: 503 }).classification).toBe("transient");
    expect(classifyError({ status: 400 }).classification).toBe("permanent");
    expect(classifyError({ status: 403 }).classification).toBe("permanent");
    expect(classifyError(new Error("fetch failed")).classification).toBe("transient");
    expect(classifyError(Object.assign(new Error("aborted"), { name: "AbortError" })).code).toBe("timeout");
    expect(classifyError(new Error("weird")).classification).toBe("permanent");
  });

  it("never stores secrets in error messages", () => {
    const msg = sanitizeErrorMessage("failed ?key=AIzaSyA1234567890abcdefghijklmnop and Bearer abc.def and sb_secret_XYZ123");
    expect(msg).not.toContain("AIzaSy");
    expect(msg).not.toContain("abc.def");
    expect(msg).not.toContain("sb_secret_XYZ123");
  });
});

describe("worker outcome -> job patch", () => {
  it("success clears errors and sets progress 100", () => {
    expect(patchForOutcome({ status: "succeeded", requestId: "r1" }, now)).toEqual({
      status: "succeeded",
      progress: 100,
      error_code: null,
      error_message: null,
      provider_request_id: "r1",
    });
  });

  it("pending (long-running video) keeps processing and releases the lease until the next poll", () => {
    const patch = patchForOutcome({ status: "pending", operation: "operations/abc", progress: 42, pollAfterMs: 15000 }, now);
    expect(patch).toMatchObject({ status: "processing", provider_operation: "operations/abc", progress: 42, locked_by: null });
    expect(patch.locked_until).toBe("2026-09-27T12:00:15.000Z");
  });

  it("transient failure is re-queued with backoff; permanent fails", () => {
    const retry = patchForFailure({ attempts: 1, max_attempts: 3, provider_operation: null }, new ProviderError("503", "transient", "http_503"), now, () => 0);
    expect(retry.final).toBe(false);
    expect(retry.patch.status).toBe("queued");
    expect(retry.patch.run_after).toBe("2026-09-27T12:00:02.500Z");

    const fail = patchForFailure({ attempts: 1, max_attempts: 3, provider_operation: null }, new ProviderError("bad", "permanent", "blocked"), now);
    expect(fail.final).toBe(true);
    expect(fail.patch).toMatchObject({ status: "failed", error_code: "blocked" });

    const exhausted = patchForFailure({ attempts: 3, max_attempts: 3, provider_operation: null }, { status: 500, message: "x" }, now);
    expect(exhausted.final).toBe(true);
  });

  it("a transient polling failure does not resubmit a submitted video", () => {
    const d = patchForFailure({ attempts: 1, max_attempts: 2, provider_operation: "operations/abc" }, { status: 503, message: "unavailable" }, now);
    expect(d.final).toBe(false);
    expect(d.patch.status).toBe("processing");
    expect(d.patch.run_after).toBeUndefined();
    expect(d.patch.locked_until).toBe("2026-09-27T12:00:30.000Z");
  });
});

describe("quota classification", () => {
  it("fails fast when the provider quota is zero (billing not enabled)", async () => {
    const { classifyError } = await import("@/lib/domain/jobs");
    const zero = Object.assign(new Error("Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3-pro-image"), { status: 429 });
    expect(classifyError(zero)).toEqual({ classification: "permanent", code: "quota_billing", status: 429 });
    const rate = Object.assign(new Error("Resource has been exhausted (e.g. check quota)."), { status: 429 });
    expect(classifyError(rate)).toEqual({ classification: "transient", code: "http_429", status: 429 });
  });
});

describe("rate-limit retries", () => {
  it("parses the provider retry hint", async () => {
    const { parseRetryHintMs } = await import("@/lib/domain/jobs");
    expect(parseRetryHintMs("Quota exceeded ... Please retry in 18.384170605s.")).toBe(18385);
    expect(parseRetryHintMs("no hint")).toBeUndefined();
  });

  it("refunds the attempt and waits for the hint plus jitter while within the grace period", () => {
    const now = new Date("2026-09-27T21:00:00Z");
    const err = new ProviderError("429", "transient", "http_429", {}, 18_000);
    const d = patchForFailure({ attempts: 3, max_attempts: 3, provider_operation: null, created_at: "2026-09-27T20:55:00Z" }, err, now, () => 0.5);
    expect(d.final).toBe(false);
    expect(d.patch.status).toBe("queued");
    expect(d.patch.attempts).toBe(2);
    expect(Date.parse(d.patch.run_after as string) - now.getTime()).toBe(18_000 + 7_500);
  });

  it("falls back to normal attempt accounting after the grace period", () => {
    const now = new Date("2026-09-27T21:00:00Z");
    const err = new ProviderError("429", "transient", "http_429", {}, 18_000);
    const d = patchForFailure({ attempts: 3, max_attempts: 3, provider_operation: null, created_at: "2026-09-27T20:00:00Z" }, err, now, () => 0.5);
    expect(d.final).toBe(true);
    expect(d.patch.status).toBe("failed");
  });
});
