import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { en } from "@/lib/i18n/dictionaries/en";
import { tr } from "@/lib/i18n/dictionaries/tr";
import { fmt, resolveLocale } from "@/lib/i18n/config";
import { localizeZodError } from "@/lib/i18n/zod";
import { jobErrorLabel, shotLabel } from "@/lib/i18n/labels";
import { productInputSchema } from "@/lib/domain/schemas";
import { validateDeclaredImage } from "@/lib/domain/files";
import { buildAnalysisPrompt, buildQualityReviewPrompt } from "@/lib/domain/prompts";

const locale = { current: "tr" as "tr" | "en" };
vi.mock("@/lib/i18n/server", async () => {
  const { dictionaries } = await import("@/lib/i18n/dictionaries");
  return { getI18n: async () => ({ locale: locale.current, d: dictionaries[locale.current] }) };
});
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));
const { toActionError } = await import("@/server/action");
const { UserFacingError, AuthorizationError } = await import("@/server/errors");
const { RateLimitError } = await import("@/server/rate-limit");

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of leaves(v, key)) out.set(kk, vv);
  }
  return out;
}

const placeholders = (s: string) => new Set(Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]));

describe("dictionaries", () => {
  const enLeaves = leaves(en as unknown as Tree);
  const trLeaves = leaves(tr as unknown as Tree);

  it("Turkish has exactly the English keys", () => {
    expect([...trLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("every entry is non-empty and uses the same {placeholders}", () => {
    for (const [key, value] of enLeaves) {
      const t = trLeaves.get(key)!;
      expect(value.trim(), `en.${key}`).not.toBe("");
      expect(t.trim(), `tr.${key}`).not.toBe("");
      expect(placeholders(t), `placeholders of ${key}`).toEqual(placeholders(value));
    }
  });

  it("is actually translated (not a copy of English)", () => {
    let same = 0;
    for (const [key, value] of enLeaves) if (trLeaves.get(key) === value) same++;
    // Brand names, codes and a few identical words (SKU, Model, Video…) may match.
    expect(same / enLeaves.size).toBeLessThan(0.1);
  });
});

describe("locale resolution and formatting", () => {
  it("prefers the cookie, then Accept-Language, then English", () => {
    expect(resolveLocale("tr", "en-US")).toBe("tr");
    expect(resolveLocale(undefined, "tr-TR,tr;q=0.9,en;q=0.8")).toBe("tr");
    expect(resolveLocale(undefined, "de-DE,en;q=0.5,tr;q=0.9")).toBe("tr");
    expect(resolveLocale("xx", "fr-FR")).toBe("en");
    expect(resolveLocale(null, null)).toBe("en");
  });

  it("fills placeholders", () => {
    expect(fmt(tr.shoot.summaryImages, { total: 6, shots: 3, variations: 2 })).toBe("6 görsel (3 çekim türü × 2 varyasyon)");
    expect(fmt("{a} {missing}", { a: 1 })).toBe("1 {missing}");
  });

  it("translates enum-backed labels and job error codes", () => {
    expect(shotLabel(tr, "three_quarter")).toBe("üç çeyrek");
    expect(shotLabel(tr, "custom")).toBe("custom");
    expect(jobErrorLabel(tr, "safety_filtered")).toContain("güvenlik");
    expect(jobErrorLabel(tr, "http_502")).toBe(tr.jobErrors.http_500);
    expect(jobErrorLabel(tr, "weird_code")).toBeNull();
  });
});

describe("validation messages", () => {
  it("translates custom schema messages and zod's built-in messages", () => {
    const res = productInputSchema.safeParse({ sku: "", title: "" });
    expect(res.success).toBe(false);
    const localized = localizeZodError(res.error!, "tr", tr);
    expect(localized.fieldErrors.sku).toContain("SKU zorunludur");
    expect(localized.fieldErrors.title).toContain("Başlık zorunludur");

    const builtIn = z.object({ n: z.number().max(3) }).safeParse({ n: 10 });
    const trMsg = localizeZodError(builtIn.error!, "tr", tr).error;
    expect(trMsg).not.toBe(builtIn.error!.issues[0]!.message);
    expect(trMsg.length).toBeGreaterThan(0);
    expect(localizeZodError(builtIn.error!, "en", en).error).toBe(builtIn.error!.issues[0]!.message);
  });

  it("returns localizable upload errors", () => {
    const res = validateDeclaredImage({ name: "a.svg", size: 10, type: "image/svg+xml" });
    expect(res).toMatchObject({ ok: false, error: "unsupportedType", vars: { type: "image/svg+xml" } });
    if (!res.ok) expect(fmt(tr.errors[res.error], res.vars)).toBe('Desteklenmeyen dosya türü "image/svg+xml". JPEG, PNG veya WebP kullanın.');
  });
});

describe("server action errors follow the request language", () => {
  it("localizes user-facing, authorization and rate-limit errors", async () => {
    locale.current = "tr";
    expect((await toActionError(new UserFacingError("shootTooLarge", { total: 50, max: 40 }), "t")).error).toBe(
      "Bu çekim 50 görsel oluşturur; gönderim başına en fazla 40 görsel üretilebilir.",
    );
    expect((await toActionError(new AuthorizationError("roleRequired", { role: "editor" }), "t")).error).toBe("Bu işlem için editör rolü gerekiyor.");
    expect((await toActionError(new RateLimitError(), "t")).error).toBe(tr.errors.rateLimited);
    locale.current = "en";
    expect((await toActionError(new UserFacingError("productNotFound"), "t")).error).toBe("Product not found.");
  });

  it("never leaks unexpected error details", async () => {
    locale.current = "tr";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await toActionError(new Error("db password=secret"), "t")).error).toBe(tr.errors.generic);
    spy.mockRestore();
  });

  it("keeps English messages on the error object for logs", () => {
    expect(new UserFacingError("tooManyReferences", { max: 6, count: 8 }).message).toBe(
      "Select at most 6 reference images in total (currently 8).",
    );
  });
});

describe("AI output language", () => {
  it("asks for Turkish free text but English enum values", () => {
    const p = buildAnalysisPrompt([{ index: 1, role: "front" }], "tr");
    expect(p).toContain("in Turkish");
    expect(p).toContain("Keep enum values exactly as defined");
    expect(buildAnalysisPrompt([{ index: 1, role: "front" }], "en")).not.toContain("Turkish");
    expect(buildQualityReviewPrompt({ productRefCount: 1, modelRefCount: 0, shotType: null, framing: null, background: null, language: "tr" })).toContain(
      "in Turkish",
    );
  });
});
