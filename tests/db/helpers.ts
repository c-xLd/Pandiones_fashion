import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

/**
 * Database test harness. Creates a throwaway database on the server given by
 * TEST_DATABASE_URL (a superuser connection to a plain Postgres), installs a
 * minimal Supabase shim (roles, auth.uid(), storage schema) and applies the
 * real migrations from supabase/migrations.
 */
export const ADMIN_URL = process.env.TEST_DATABASE_URL;

export interface TestDb {
  pool: pg.Pool;
  drop: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDb> {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL not set");
  const name = `pfs_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
  const root = path.resolve(import.meta.dirname, "../..");
  await pool.query(readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(dir, file), "utf8"));
  }
  return {
    pool,
    drop: async () => {
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}

/** Run queries as a signed-in Supabase user (role authenticated + JWT sub claim). */
export async function asUser<T>(pool: pg.Pool, userId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await client.query("set local role authenticated");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Run queries as the service role (used by the worker). */
export async function asService<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createUser(pool: pg.Pool, email: string): Promise<string> {
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

export async function createOrg(pool: pg.Pool, ownerId: string, name: string): Promise<string> {
  return asUser(pool, ownerId, async (c) => {
    const { rows } = await c.query("select public.create_organization($1, $2) as id", [name, `${name.toLowerCase()}-${randomUUID().slice(0, 6)}`]);
    return rows[0].id as string;
  });
}

export async function addMember(pool: pg.Pool, orgId: string, userId: string, role: string): Promise<void> {
  await pool.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)", [orgId, userId, role]);
}

export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  if (!error) throw new Error(`Expected database error matching ${pattern}, but the query succeeded`);
  const msg = (error as Error).message;
  if (!pattern.test(msg)) throw new Error(`Expected error matching ${pattern}, got: ${msg}`);
}
