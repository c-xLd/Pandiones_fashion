import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, asService, asUser, createOrg, createTestDatabase, createUser, expectDbError, type TestDb } from "./helpers";

/** Durable queue semantics: idempotency, state machine, claiming, leases, cancellation. */
describe.skipIf(!ADMIN_URL)("generation job queue", () => {
  let db: TestDb;
  let owner: string, editor: string, outsider: string;
  let org: string, otherOrg: string;

  const insertJob = (userId: string, orgId: string, extra: Record<string, unknown> = {}) =>
    asUser(db.pool, userId, async (c) => {
      const cols = { organization_id: orgId, created_by: userId, job_type: "image_generation", provider: "gemini", model: "m", idempotency_key: `k-${randomUUID()}`, ...extra };
      const keys = Object.keys(cols);
      const { rows } = await c.query(
        `insert into generation_jobs (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
        Object.values(cols),
      );
      return rows[0];
    });

  const claim = (worker: string, limit: number, maxActive = 100, lease = 300) =>
    asService(db.pool, async (c) => (await c.query("select * from claim_jobs($1, $2, $3, $4)", [worker, limit, lease, maxActive])).rows);

  beforeAll(async () => {
    db = await createTestDatabase();
    owner = await createUser(db.pool, "owner@example.test");
    editor = await createUser(db.pool, "editor@example.test");
    outsider = await createUser(db.pool, "outsider@example.test");
    org = await createOrg(db.pool, owner, "QueueOrg");
    otherOrg = await createOrg(db.pool, outsider, "OtherOrg");
    await addMember(db.pool, org, editor, "editor");
  }, 60_000);

  beforeEach(async () => {
    await db.pool.query("delete from generation_jobs");
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe("enqueue policy", () => {
    it("editors can enqueue queued jobs for themselves", async () => {
      const job = await insertJob(editor, org);
      expect(job.status).toBe("queued");
      expect(job.attempts).toBe(0);
    });

    it("clients cannot create pre-completed or foreign jobs", async () => {
      await expectDbError(insertJob(editor, org, { status: "succeeded" }), /row-level security/);
      await expectDbError(insertJob(editor, org, { attempts: 2 }), /row-level security/);
      await expectDbError(insertJob(editor, org, { created_by: owner }), /row-level security/);
      await expectDbError(insertJob(outsider, org), /row-level security/);
    });

    it("clients cannot change job state directly", async () => {
      const job = await insertJob(editor, org);
      await expectDbError(
        asUser(db.pool, editor, (c) => c.query("update generation_jobs set status = 'succeeded' where id = $1", [job.id])),
        /permission denied/,
      );
    });

    it("idempotency key prevents duplicate jobs per organization", async () => {
      const key = `dup-${randomUUID()}`;
      await insertJob(editor, org, { idempotency_key: key });
      await expectDbError(insertJob(editor, org, { idempotency_key: key }), /duplicate key/);
      const inserted = await asUser(db.pool, editor, async (c) =>
        (
          await c.query(
            "insert into generation_jobs (organization_id, created_by, job_type, provider, model, idempotency_key) values ($1, $2, 'image_generation', 'gemini', 'm', $3) on conflict (organization_id, idempotency_key) do nothing returning id",
            [org, editor, key],
          )
        ).rowCount,
      );
      expect(inserted).toBe(0);
      // The same key in another tenant is independent.
      const other = await insertJob(outsider, otherOrg, { idempotency_key: key });
      expect(other.id).toBeDefined();
    });
  });

  describe("state machine (database trigger)", () => {
    it("rejects invalid transitions and stamps completion", async () => {
      const job = await insertJob(editor, org);
      await expectDbError(db.pool.query("update generation_jobs set status = 'succeeded' where id = $1", [job.id]), /invalid job transition queued -> succeeded/);
      await db.pool.query("update generation_jobs set status = 'processing', locked_by = 'w', locked_until = now() + interval '1 minute' where id = $1", [job.id]);
      await db.pool.query("update generation_jobs set status = 'succeeded' where id = $1", [job.id]);
      const { rows } = await db.pool.query("select * from generation_jobs where id = $1", [job.id]);
      expect(rows[0].completed_at).not.toBeNull();
      expect(rows[0].locked_by).toBeNull();
      expect(rows[0].progress).toBe(100);
      await expectDbError(db.pool.query("update generation_jobs set status = 'processing' where id = $1", [job.id]), /invalid job transition/);
      await expectDbError(db.pool.query("update generation_jobs set status = 'queued' where id = $1", [job.id]), /invalid job transition/);
    });

    it("allows processing -> queued for transient retries", async () => {
      const job = await insertJob(editor, org);
      await db.pool.query("update generation_jobs set status = 'processing' where id = $1", [job.id]);
      await db.pool.query("update generation_jobs set status = 'queued', run_after = now() + interval '10 seconds' where id = $1", [job.id]);
      const { rows } = await db.pool.query("select status from generation_jobs where id = $1", [job.id]);
      expect(rows[0].status).toBe("queued");
    });
  });

  describe("claiming", () => {
    it("concurrent workers never claim the same job (SKIP LOCKED)", async () => {
      for (let i = 0; i < 6; i++) await insertJob(editor, org);
      const [a, b] = await Promise.all([claim("worker-a", 4), claim("worker-b", 4)]);
      const ids = [...a, ...b].map((j) => j.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(6);
      for (const j of [...a, ...b]) {
        expect(j.status).toBe("processing");
        expect(j.attempts).toBe(1);
        expect(j.started_at).not.toBeNull();
      }
    });

    it("respects run_after and the concurrency cap", async () => {
      await insertJob(editor, org, { run_after: new Date(Date.now() + 60_000).toISOString() });
      expect(await claim("w", 5)).toHaveLength(0);
      for (let i = 0; i < 3; i++) await insertJob(editor, org);
      expect(await claim("w", 5, 2)).toHaveLength(2);
      // Two are active now; cap of 2 allows none more.
      expect(await claim("w", 5, 2)).toHaveLength(0);
    });

    it("reclaims a crashed worker's job after its lease expires, counting an attempt", async () => {
      const job = await insertJob(editor, org);
      await claim("dead-worker", 1);
      await db.pool.query("update generation_jobs set locked_until = now() - interval '1 second' where id = $1", [job.id]);
      const [again] = await claim("new-worker", 1);
      expect(again.id).toBe(job.id);
      expect(again.locked_by).toBe("new-worker");
      expect(again.attempts).toBe(2);
    });

    it("fails a job whose lease expired after the last attempt", async () => {
      const job = await insertJob(editor, org);
      await db.pool.query(
        "update generation_jobs set status = 'processing', attempts = 3, max_attempts = 3, locked_by = 'dead', locked_until = now() - interval '1 second' where id = $1",
        [job.id],
      );
      expect(await claim("w", 5)).toHaveLength(0);
      const { rows } = await db.pool.query("select status, error_code from generation_jobs where id = $1", [job.id]);
      expect(rows[0]).toEqual({ status: "failed", error_code: "lease_expired" });
    });

    it("polling a submitted long-running video operation does not consume attempts", async () => {
      const job = await insertJob(editor, org, { job_type: "video_generation", provider: "gemini-veo" });
      await claim("w1", 1);
      await db.pool.query(
        "update generation_jobs set provider_operation = 'operations/xyz', locked_by = null, locked_until = now() - interval '1 second' where id = $1",
        [job.id],
      );
      const [polled] = await claim("w2", 1);
      expect(polled.id).toBe(job.id);
      expect(polled.attempts).toBe(1);
      expect(polled.provider_operation).toBe("operations/xyz");
    });

    it("claim_jobs is not callable by users", async () => {
      await expectDbError(asUser(db.pool, owner, (c) => c.query("select * from claim_jobs('x', 1, 60, 1)")), /permission denied/);
    });
  });

  describe("cancellation", () => {
    it("cancels queued jobs immediately and flags processing jobs", async () => {
      const queued = await insertJob(editor, org);
      const status = await asUser(db.pool, editor, async (c) => (await c.query("select cancel_job($1) as s", [queued.id])).rows[0].s);
      expect(status).toBe("cancelled");
      const running = await insertJob(editor, org);
      await claim("w", 1);
      const s2 = await asUser(db.pool, editor, async (c) => (await c.query("select cancel_job($1) as s", [running.id])).rows[0].s);
      expect(s2).toBe("processing");
      const { rows } = await db.pool.query("select cancel_requested from generation_jobs where id = $1", [running.id]);
      expect(rows[0].cancel_requested).toBe(true);
    });

    it("cannot cancel another tenant's job", async () => {
      const job = await insertJob(editor, org);
      await expectDbError(asUser(db.pool, outsider, (c) => c.query("select cancel_job($1)", [job.id])), /job not found/);
    });
  });
});
