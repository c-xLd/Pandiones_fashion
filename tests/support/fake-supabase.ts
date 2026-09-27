import { randomUUID } from "node:crypto";

/**
 * Minimal in-memory stand-in for the subset of the supabase-js query builder
 * used by the background worker and job handlers. TEST SUPPORT ONLY — it
 * does not implement RLS (the worker uses the service role, which bypasses
 * RLS; tenant scoping in handlers is asserted via explicit filters).
 */
type Row = Record<string, unknown>;
type Filter = { op: "eq" | "neq" | "in"; col: string; val: unknown };

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  objects = new Map<string, { data: Buffer; contentType?: string }>();
  rpcHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {};
  uniqueKeys: Record<string, string[]> = { generation_jobs: ["organization_id", "idempotency_key"] };

  table(name: string): Row[] {
    return (this.tables[name] ??= []);
  }

  seed(name: string, rows: Row[]): Row[] {
    const withIds = rows.map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
    this.table(name).push(...withIds);
    return withIds;
  }

  from(name: string) {
    return new FakeQuery(this, name);
  }

  rpc(name: string, args: Record<string, unknown>) {
    const handler = this.rpcHandlers[name];
    return Promise.resolve(handler ? { data: handler(args), error: null } : { data: null, error: { message: `rpc ${name} not faked` } });
  }

  storage = {
    from: (_bucket: string) => ({
      download: async (path: string) => {
        const obj = this.objects.get(path);
        if (!obj) return { data: null, error: { message: "Object not found" } };
        const bytes = new Uint8Array(obj.data);
        return { data: new Blob([bytes]), error: null };
      },
      upload: async (path: string, data: Buffer, opts?: { contentType?: string; upsert?: boolean }) => {
        if (this.objects.has(path) && !opts?.upsert) return { data: null, error: { message: "The resource already exists" } };
        this.objects.set(path, { data: Buffer.from(data), contentType: opts?.contentType });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) this.objects.delete(p);
        return { data: [], error: null };
      },
    }),
  };
}

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null; count?: number | null }> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private returning = false;
  private singleMode: "single" | "maybe" | null = null;
  private countMode = false;
  private headMode = false;
  private limitN: number | null = null;
  private ignoreDuplicates = false;

  constructor(
    private db: FakeSupabase,
    private name: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== "select") this.returning = true;
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.headMode = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = payload;
    this.ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ op: "eq", col, val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push({ op: "neq", col, val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.filters.push({ op: "in", col, val });
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.col];
      if (f.op === "eq") return v === f.val;
      if (f.op === "neq") return v !== f.val;
      return (f.val as unknown[]).includes(v);
    });
  }

  private execute() {
    const rows = this.db.table(this.name);
    let result: Row[] = [];
    if (this.op === "select") {
      result = rows.filter((r) => this.matches(r));
    } else if (this.op === "insert" || this.op === "upsert") {
      const items = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const keys = this.db.uniqueKeys[this.name];
      for (const item of items) {
        const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...item };
        if (keys && rows.some((r) => keys.every((k) => r[k] === row[k]))) {
          if (this.op === "upsert" && this.ignoreDuplicates) continue;
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
        rows.push(row);
        result.push(row);
      }
    } else if (this.op === "update") {
      result = rows.filter((r) => this.matches(r));
      for (const r of result) Object.assign(r, this.payload, { updated_at: new Date().toISOString() });
    } else if (this.op === "delete") {
      result = rows.filter((r) => this.matches(r));
      this.db.tables[this.name] = rows.filter((r) => !result.includes(r));
    }
    if (this.limitN != null) result = result.slice(0, this.limitN);
    const count = this.countMode ? result.length : null;
    if (this.headMode) return { data: null, error: null, count };
    if (this.op !== "select" && !this.returning && !this.singleMode) return { data: null, error: null, count };
    if (this.singleMode) {
      if (result.length === 0) {
        return this.singleMode === "maybe" ? { data: null, error: null } : { data: null, error: { message: "No rows found", code: "PGRST116" } };
      }
      return { data: { ...result[0] }, error: null };
    }
    return { data: result.map((r) => ({ ...r })), error: null, count };
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}
