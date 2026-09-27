/**
 * Applies supabase/migrations/*.sql in order to DATABASE_URL, recording each
 * applied file in public.schema_migrations so re-runs are safe.
 *
 *   DATABASE_URL=postgres://... npm run db:apply
 *
 * Prefer the Supabase CLI (`supabase db push`) when available; this script is
 * for environments without it. Use the database's direct/session connection
 * string (Supabase dashboard → Connect), not the transaction pooler.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    await client.query("alter table public.schema_migrations enable row level security");
    const { rows } = await client.query("select name from public.schema_migrations");
    const applied = new Set(rows.map((r) => r.name as string));
    const dir = path.resolve("supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file}`);
        continue;
      }
      const sql = readFileSync(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`apply  ${file}`);
      } catch (error) {
        await client.query("rollback");
        console.error(`FAILED ${file}: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    }
    console.log("Migrations up to date.");
  } finally {
    await client.end();
  }
}

void main();
