import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, asService, asUser, createOrg, createTestDatabase, createUser, expectDbError, type TestDb } from "./helpers";

/**
 * Tenant isolation, authorization and asset access, verified against the
 * real migrations with Row Level Security enforced.
 */
describe.skipIf(!ADMIN_URL)("RLS & tenant isolation", () => {
  let db: TestDb;
  let ownerA: string, ownerB: string, editorA: string, viewerA: string, editorBoth: string;
  let orgA: string, orgB: string;
  let productA: string, productB: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    ownerA = await createUser(db.pool, "owner-a@example.test");
    ownerB = await createUser(db.pool, "owner-b@example.test");
    editorA = await createUser(db.pool, "editor-a@example.test");
    viewerA = await createUser(db.pool, "viewer-a@example.test");
    editorBoth = await createUser(db.pool, "editor-both@example.test");
    orgA = await createOrg(db.pool, ownerA, "AlphaOrg");
    orgB = await createOrg(db.pool, ownerB, "BetaOrg");
    await addMember(db.pool, orgA, editorA, "editor");
    await addMember(db.pool, orgA, viewerA, "viewer");
    await addMember(db.pool, orgA, editorBoth, "editor");
    await addMember(db.pool, orgB, editorBoth, "editor");
    productA = await asUser(db.pool, ownerA, async (c) =>
      (await c.query("insert into products (organization_id, sku, title) values ($1, 'A-1', 'Alpha product') returning id", [orgA])).rows[0].id,
    );
    productB = await asUser(db.pool, ownerB, async (c) =>
      (await c.query("insert into products (organization_id, sku, title) values ($1, 'B-1', 'Beta product') returning id", [orgB])).rows[0].id,
    );
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("create_organization makes the caller owner", async () => {
    const { rows } = await db.pool.query("select role from organization_members where organization_id = $1 and user_id = $2", [orgA, ownerA]);
    expect(rows[0].role).toBe("owner");
  });

  it("members only see their own organization's rows", async () => {
    const seenByA = await asUser(db.pool, ownerA, async (c) => (await c.query("select id from products")).rows.map((r) => r.id));
    expect(seenByA).toEqual([productA]);
    const seenByB = await asUser(db.pool, ownerB, async (c) => (await c.query("select id from products")).rows.map((r) => r.id));
    expect(seenByB).toEqual([productB]);
    const orgsSeenByB = await asUser(db.pool, ownerB, async (c) => (await c.query("select id from organizations")).rows.map((r) => r.id));
    expect(orgsSeenByB).toEqual([orgB]);
  });

  it("cannot read another tenant's row even by id", async () => {
    const rows = await asUser(db.pool, ownerB, async (c) => (await c.query("select * from products where id = $1", [productA])).rows);
    expect(rows).toHaveLength(0);
  });

  it("cannot insert into another organization", async () => {
    await expectDbError(
      asUser(db.pool, ownerB, (c) => c.query("insert into products (organization_id, sku, title) values ($1, 'X', 'x')", [orgA])),
      /row-level security/,
    );
  });

  it("cannot modify or delete another tenant's rows (silently affects 0 rows)", async () => {
    const updated = await asUser(db.pool, ownerB, async (c) => (await c.query("update products set title = 'pwned' where id = $1", [productA])).rowCount);
    expect(updated).toBe(0);
    const deleted = await asUser(db.pool, ownerB, async (c) => (await c.query("delete from products where id = $1", [productA])).rowCount);
    expect(deleted).toBe(0);
  });

  it("enforces roles: viewer read-only, editor writes, admin deletes", async () => {
    await expectDbError(
      asUser(db.pool, viewerA, (c) => c.query("insert into products (organization_id, sku, title) values ($1, 'V-1', 'x')", [orgA])),
      /row-level security/,
    );
    const viewerUpdate = await asUser(db.pool, viewerA, async (c) => (await c.query("update products set title = 'v' where id = $1", [productA])).rowCount);
    expect(viewerUpdate).toBe(0);
    const editorProduct = await asUser(db.pool, editorA, async (c) =>
      (await c.query("insert into products (organization_id, sku, title) values ($1, 'E-1', 'edited') returning id", [orgA])).rows[0].id,
    );
    const editorDelete = await asUser(db.pool, editorA, async (c) => (await c.query("delete from products where id = $1", [editorProduct])).rowCount);
    expect(editorDelete).toBe(0);
    const adminDelete = await asUser(db.pool, ownerA, async (c) => (await c.query("delete from products where id = $1", [editorProduct])).rowCount);
    expect(adminDelete).toBe(1);
  });

  it("rows cannot be moved to another organization", async () => {
    const pid = await asUser(db.pool, editorBoth, async (c) =>
      (await c.query("insert into products (organization_id, sku, title) values ($1, 'M-1', 'mover') returning id", [orgA])).rows[0].id,
    );
    await expectDbError(
      asUser(db.pool, editorBoth, (c) => c.query("update products set organization_id = $1 where id = $2", [orgB, pid])),
      /organization_id is immutable/,
    );
  });

  it("users cannot add themselves to another organization", async () => {
    await expectDbError(
      asUser(db.pool, ownerB, (c) => c.query("insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [orgA, ownerB])),
      /permission denied/,
    );
  });

  it("model profiles must be confirmed adults", async () => {
    await expectDbError(
      asUser(db.pool, editorA, (c) =>
        c.query("insert into model_profiles (organization_id, code, display_name, adult_confirmed) values ($1, 'M01', 'Test', false)", [orgA]),
      ),
      /check constraint/,
    );
  });

  it("system presets are readable by everyone but immutable", async () => {
    const count = await asUser(db.pool, ownerB, async (c) => (await c.query("select count(*)::int as n from shoot_presets where organization_id is null")).rows[0].n);
    expect(count).toBeGreaterThanOrEqual(5);
    const updated = await asUser(db.pool, ownerB, async (c) => (await c.query("update shoot_presets set name = 'x' where organization_id is null")).rowCount);
    expect(updated).toBe(0);
    await expectDbError(
      asUser(db.pool, ownerB, (c) => c.query("insert into shoot_presets (organization_id, name, category, config) values (null, 'x', 'ecommerce', '{}')")),
      /row-level security/,
    );
  });

  it("asset metadata cannot be repointed by clients (column grants)", async () => {
    const assetId = await asUser(db.pool, editorA, async (c) =>
      (
        await c.query(
          "insert into product_assets (organization_id, product_id, role, storage_path, mime_type, size_bytes, sha256) values ($1, $2, 'front', $3, 'image/png', 10, 'abc') returning id",
          [orgA, productA, `${orgA}/products/${productA}/source/${randomUUID()}.png`],
        )
      ).rows[0].id,
    );
    await expectDbError(
      asUser(db.pool, editorA, (c) => c.query("update product_assets set storage_path = $1 where id = $2", [`${orgB}/stolen.png`, assetId])),
      /permission denied/,
    );
    const roleUpdate = await asUser(db.pool, editorA, async (c) => (await c.query("update product_assets set role = 'back' where id = $1", [assetId])).rowCount);
    expect(roleUpdate).toBe(1);
  });

  it("storage paths must be namespaced by the owning organization", async () => {
    await expectDbError(
      asUser(db.pool, editorA, (c) =>
        c.query(
          "insert into product_assets (organization_id, product_id, role, storage_path, mime_type, size_bytes, sha256) values ($1, $2, 'front', $3, 'image/png', 10, 'abc')",
          [orgA, productA, `${orgB}/products/x.png`],
        ),
      ),
      /check constraint/,
    );
  });

  describe("storage object policies (private bucket)", () => {
    it("allows editors to write only under their organization prefix", async () => {
      await asUser(db.pool, editorA, (c) => c.query("insert into storage.objects (bucket_id, name) values ('studio-assets', $1)", [`${orgA}/products/p/source/a.png`]));
      await expectDbError(
        asUser(db.pool, editorA, (c) => c.query("insert into storage.objects (bucket_id, name) values ('studio-assets', $1)", [`${orgB}/products/p/source/a.png`])),
        /row-level security/,
      );
      await expectDbError(
        asUser(db.pool, viewerA, (c) => c.query("insert into storage.objects (bucket_id, name) values ('studio-assets', $1)", [`${orgA}/products/p/source/b.png`])),
        /row-level security/,
      );
      await expectDbError(
        asUser(db.pool, editorA, (c) => c.query("insert into storage.objects (bucket_id, name) values ('studio-assets', 'not-a-uuid/x.png')")),
        /row-level security/,
      );
    });

    it("signed URL generation is limited to readable objects", async () => {
      await asService(db.pool, (c) => c.query("insert into storage.objects (bucket_id, name) values ('studio-assets', $1)", [`${orgB}/results/j/secret.png`]));
      const seenByA = await asUser(db.pool, ownerA, async (c) => (await c.query("select name from storage.objects")).rows.map((r) => r.name));
      expect(seenByA.every((n: string) => n.startsWith(orgA))).toBe(true);
      const seenByViewer = await asUser(db.pool, viewerA, async (c) => (await c.query("select count(*)::int as n from storage.objects")).rows[0].n);
      expect(seenByViewer).toBeGreaterThan(0);
    });
  });

  describe("results review", () => {
    let jobId: string;
    let resultId: string;
    beforeAll(async () => {
      jobId = await asUser(db.pool, editorA, async (c) =>
        (
          await c.query(
            "insert into generation_jobs (organization_id, created_by, job_type, provider, model, idempotency_key, product_id) values ($1, $2, 'image_generation', 'gemini', 'm', $3, $4) returning id",
            [orgA, editorA, `key-${randomUUID()}`, productA],
          )
        ).rows[0].id,
      );
      resultId = await asService(db.pool, async (c) =>
        (
          await c.query(
            "insert into generation_results (organization_id, job_id, product_id, kind, storage_path, mime_type, size_bytes, provider, model) values ($1, $2, $3, 'image', $4, 'image/png', 100, 'gemini', 'm') returning id",
            [orgA, jobId, productA, `${orgA}/results/${jobId}/r.png`],
          )
        ).rows[0].id,
      );
    });

    it("editors can set review fields only", async () => {
      const n = await asUser(db.pool, editorA, async (c) =>
        (await c.query("update generation_results set review_status = 'approved', reviewed_by = $2, reviewed_at = now() where id = $1", [resultId, editorA])).rowCount,
      );
      expect(n).toBe(1);
      await expectDbError(
        asUser(db.pool, editorA, (c) => c.query("update generation_results set storage_path = 'x' where id = $1", [resultId])),
        /permission denied/,
      );
      await expectDbError(
        asUser(db.pool, editorA, (c) => c.query("update generation_results set qc_status = 'passed' where id = $1", [resultId])),
        /permission denied/,
      );
    });

    it("other tenants cannot review", async () => {
      const n = await asUser(db.pool, ownerB, async (c) => (await c.query("update generation_results set review_status = 'rejected' where id = $1", [resultId])).rowCount);
      expect(n).toBe(0);
    });
  });

  describe("usage, audit and reporting", () => {
    beforeAll(async () => {
      await asService(db.pool, async (c) => {
        await c.query(
          "insert into usage_ledger (organization_id, product_id, job_type, provider, model, cost_amount, cost_source, succeeded, units) values ($1, $2, 'image_generation', 'gemini', 'm', 0.5, 'estimated', true, '{\"images\":1}')",
          [orgA, productA],
        );
        await c.query(
          "insert into usage_ledger (organization_id, product_id, job_type, provider, model, cost_amount, cost_source, succeeded) values ($1, $2, 'image_generation', 'gemini', 'm', 9.0, 'estimated', true)",
          [orgB, productB],
        );
        await c.query("insert into audit_logs (organization_id, actor_id, action, entity_type) values ($1, $2, 'test.action', 'test')", [orgA, ownerA]);
      });
    });

    it("users cannot write usage or audit records", async () => {
      await expectDbError(
        asUser(db.pool, ownerA, (c) =>
          c.query("insert into usage_ledger (organization_id, job_type, provider, model, cost_source, succeeded) values ($1, 'image_generation', 'x', 'x', 'unknown', true)", [orgA]),
        ),
        /permission denied/,
      );
      await expectDbError(
        asUser(db.pool, ownerA, (c) => c.query("insert into audit_logs (organization_id, action, entity_type) values ($1, 'x', 'x')", [orgA])),
        /permission denied/,
      );
    });

    it("spend and reporting functions only see the caller's tenant", async () => {
      const spendA = await asUser(db.pool, ownerA, async (c) => Number((await c.query("select org_month_spend($1) as s", [orgA])).rows[0].s));
      expect(spendA).toBeCloseTo(0.5);
      const spendBByA = await asUser(db.pool, ownerA, async (c) => Number((await c.query("select org_month_spend($1) as s", [orgB])).rows[0].s));
      expect(spendBByA).toBe(0);
      const breakdown = await asUser(db.pool, ownerA, async (c) =>
        (await c.query("select * from usage_breakdown($1, now() - interval '1 day', now() + interval '1 day')", [orgB])).rows,
      );
      expect(breakdown).toHaveLength(0);
    });

    it("audit log is visible to admins only", async () => {
      expect(await asUser(db.pool, ownerA, async (c) => (await c.query("select * from audit_logs")).rowCount)).toBe(1);
      expect(await asUser(db.pool, viewerA, async (c) => (await c.query("select * from audit_logs")).rowCount)).toBe(0);
      expect(await asUser(db.pool, ownerB, async (c) => (await c.query("select * from audit_logs")).rowCount)).toBe(0);
    });

    it("rate limiter works and is not callable by users", async () => {
      const key = `test:${randomUUID()}`;
      const hits = await asService(db.pool, async (c) => {
        const out: boolean[] = [];
        for (let i = 0; i < 3; i++) out.push((await c.query("select rate_limit_hit($1, 2, 60) as ok", [key])).rows[0].ok);
        return out;
      });
      expect(hits).toEqual([true, true, false]);
      await expectDbError(asUser(db.pool, ownerA, (c) => c.query("select rate_limit_hit('x', 1, 60)")), /permission denied/);
    });
  });
});
