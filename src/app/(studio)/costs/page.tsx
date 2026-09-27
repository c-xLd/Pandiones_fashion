import Link from "next/link";
import { requirePageContext } from "@/server/context";
import { pricingTable, budgetState } from "@/lib/domain/costs";
import { LIMITS } from "@/server/rate-limit";
import { formatDateTime, formatMoney } from "@/lib/utils";
import type { UsageRow } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/studio/page-header";

export const metadata = { title: "Costs & usage" };

interface BreakdownRow {
  job_type: string;
  provider: string;
  model: string;
  cost_source: "provider_reported" | "estimated" | "unknown";
  succeeded: boolean;
  calls: number;
  cost: number;
  input_tokens: number;
  output_tokens: number;
  images: number;
  videos: number;
  video_seconds: number;
}

function monthRange(month: string | undefined) {
  const now = new Date();
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(y, mo - 1, 1));
  const to = new Date(Date.UTC(y, mo, 1));
  return { month: m, from, to };
}

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const org = ctx.org.organizationId;
  const db = ctx.supabase;
  const { month, from, to } = monthRange(sp.month);
  const args = { p_org: org, p_from: from.toISOString(), p_to: to.toISOString() };

  const [breakdownRes, dailyRes, productsRes, recentRes, orgRes] = await Promise.all([
    db.rpc("usage_breakdown", args),
    db.rpc("usage_daily", args),
    db.rpc("usage_by_product", { ...args, p_limit: 20 }),
    db.from("usage_ledger").select("*").eq("organization_id", org).gte("created_at", args.p_from).lt("created_at", args.p_to).order("created_at", { ascending: false }).limit(25),
    db.from("organizations").select("monthly_budget_usd, budget_alert_percent, budget_hard_limit").eq("id", org).single(),
  ]);
  const rows = ((breakdownRes.data ?? []) as BreakdownRow[]).map((r) => ({
    ...r,
    calls: Number(r.calls),
    cost: Number(r.cost),
    images: Number(r.images),
    videos: Number(r.videos),
    video_seconds: Number(r.video_seconds),
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
  }));
  const sum = (f: (r: (typeof rows)[number]) => number, pred: (r: (typeof rows)[number]) => boolean = () => true) =>
    rows.filter(pred).reduce((s, r) => s + f(r), 0);

  const actual = sum((r) => r.cost, (r) => r.cost_source === "provider_reported");
  const estimated = sum((r) => r.cost, (r) => r.cost_source === "estimated");
  const unknownCalls = sum((r) => r.calls, (r) => r.cost_source === "unknown");
  const total = actual + estimated;
  const imageRows = (r: (typeof rows)[number]) => r.job_type === "image_generation" || r.job_type === "model_portrait";
  const images = sum((r) => r.images, imageRows);
  const imageCost = sum((r) => r.cost, imageRows);
  const qcCost = sum((r) => r.cost, (r) => r.job_type === "quality_review");
  const analysisCost = sum((r) => r.cost, (r) => r.job_type === "product_analysis");
  const videos = sum((r) => r.videos, (r) => r.job_type === "video_generation");
  const videoCost = sum((r) => r.cost, (r) => r.job_type === "video_generation");
  const failedCost = sum((r) => r.cost, (r) => !r.succeeded);
  const failedCalls = sum((r) => r.calls, (r) => !r.succeeded);

  const byModel = new Map<string, { calls: number; cost: number; sources: Set<string> }>();
  for (const r of rows) {
    const key = `${r.provider} · ${r.model}`;
    const v = byModel.get(key) ?? { calls: 0, cost: 0, sources: new Set<string>() };
    v.calls += r.calls;
    v.cost += r.cost;
    v.sources.add(r.cost_source);
    byModel.set(key, v);
  }
  const daily = ((dailyRes.data ?? []) as { day: string; cost: number; calls: number }[]).map((d) => ({ ...d, cost: Number(d.cost) }));
  const maxDaily = Math.max(0.000001, ...daily.map((d) => d.cost));
  const products = (productsRes.data ?? []) as { product_id: string; sku: string; title: string; cost: number; images: number; videos: number }[];
  const recent = (recentRes.data ?? []) as UsageRow[];
  const budget = orgRes.data?.monthly_budget_usd == null ? null : Number(orgRes.data.monthly_budget_usd);
  const budgetInfo = budgetState(total, budget, orgRes.data?.budget_alert_percent ?? 80);
  const pricing = Object.entries(pricingTable());

  return (
    <>
      <PageHeader
        title="Costs & usage"
        description="Actual provider-reported costs and estimates are tracked separately. The Gemini API reports token usage, not charged amounts, so most figures are estimates."
        actions={
          <form className="flex gap-2">
            <Input type="month" name="month" defaultValue={month} aria-label="Month" className="w-44" />
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
        }
      />
      {budgetInfo.level !== "none" && budgetInfo.level !== "ok" && (
        <Alert variant={budgetInfo.level === "exceeded" ? "destructive" : "warning"} className="mb-4">
          <AlertTitle>{budgetInfo.level === "exceeded" ? "Budget exceeded" : "Budget alert threshold reached"}</AlertTitle>
          <AlertDescription>
            {formatMoney(total, "USD", 2)} of {formatMoney(budget, "USD", 2)} ({budgetInfo.percent?.toFixed(0)}%).{" "}
            {orgRes.data?.budget_hard_limit ? "New generations are blocked while the hard limit is exceeded." : "Hard limit is off; generation continues."}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total ({month})</CardDescription>
            <CardTitle className="text-3xl">{formatMoney(total, "USD", 2)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>Actual (provider-reported): {formatMoney(actual, "USD", 4)}</p>
            <p>Estimated: {formatMoney(estimated, "USD", 4)}</p>
            <p>Calls with unknown cost: {unknownCalls}</p>
            <p>Budget: {budget == null ? "not set" : formatMoney(budget, "USD", 2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost per image</CardDescription>
            <CardTitle className="text-3xl">{images ? formatMoney(imageCost / images, "USD", 4) : "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {images} images · {formatMoney(imageCost, "USD", 4)} generation · {formatMoney(qcCost, "USD", 4)} QC · {formatMoney(analysisCost, "USD", 4)} analysis
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost per video</CardDescription>
            <CardTitle className="text-3xl">{videos ? formatMoney(videoCost / videos, "USD", 4) : "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {videos} videos · {sum((r) => r.video_seconds, (r) => r.job_type === "video_generation")}s · {formatMoney(videoCost, "USD", 4)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed generations</CardDescription>
            <CardTitle className="text-3xl">{formatMoney(failedCost, "USD", 4)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{failedCalls} failed or blocked calls (cost counted only where usage was reported)</CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Daily spend</CardTitle>
          </CardHeader>
          <CardContent>
            {daily.length === 0 ? (
              <p className="text-sm text-muted-foreground">No usage this month.</p>
            ) : (
              <ul className="space-y-1" aria-label="Daily spend">
                {daily.map((d) => (
                  <li key={d.day} className="grid grid-cols-[80px_1fr_90px] items-center gap-2 text-xs">
                    <span>{d.day}</span>
                    <span className="h-3 rounded bg-primary/80" style={{ width: `${Math.max(2, (d.cost / maxDaily) * 100)}%` }} />
                    <span className="text-right">{formatMoney(d.cost, "USD", 3)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By model</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider · model</TableHead>
                  <TableHead>Calls</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(byModel.entries()).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="text-xs">{k}</TableCell>
                    <TableCell>{v.calls}</TableCell>
                    <TableCell>{formatMoney(v.cost)}</TableCell>
                    <TableCell className="space-x-1">
                      {Array.from(v.sources).map((s) => (
                        <Badge key={s} variant={s === "provider_reported" ? "success" : s === "estimated" ? "info" : "outline"}>
                          {s}
                        </Badge>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top products by cost</CardTitle>
          </CardHeader>
          <CardContent>
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">No product-linked usage.</p>
            ) : (
              <Table>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.product_id}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/products/${p.product_id}`} className="hover:underline">
                          {p.sku}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">{p.title}</TableCell>
                      <TableCell className="text-xs">
                        {Number(p.images)} img · {Number(p.videos)} vid
                      </TableCell>
                      <TableCell>{formatMoney(Number(p.cost))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Limits</CardTitle>
            <CardDescription>
              Provider quotas are set per Google Cloud project (see AI Studio → usage and rate limits). The app enforces its own limits below to stay within them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Worker concurrency (WORKER_MAX_CONCURRENCY): {process.env.WORKER_MAX_CONCURRENCY ?? "4 (default)"}</p>
            {Object.entries(LIMITS).map(([k, [n, w]]) => (
              <p key={k}>
                {k}: {n} requests / {w}s per user
              </p>
            ))}
            <p>Monthly hard budget limit: {orgRes.data?.budget_hard_limit ? "on" : "off"} (Settings)</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Pricing assumptions used for estimates</CardTitle>
          <CardDescription>
            Configured in <code>src/config/pricing.ts</code> and overridable with <code>PRICING_OVERRIDES_JSON</code>. Prices change — verify against the source and
            record the verification date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model prefix</TableHead>
                <TableHead>Rates (USD)</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricing.map(([key, p]) => (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell className="text-xs">
                    {p.kind === "tokens"
                      ? `in ${p.inputPerMillion}/1M · text out ${p.outputTextPerMillion}/1M${p.outputImagePerMillion != null ? ` · image out ${p.outputImagePerMillion}/1M` : ""}`
                      : Object.entries(p.perSecond)
                          .map(([r, v]) => `${r}: ${v}/s`)
                          .join(" · ")}
                  </TableCell>
                  <TableCell>{p.verifiedAt ? <Badge variant="success">{p.verifiedAt}</Badge> : <Badge variant="warning">unverified</Badge>}</TableCell>
                  <TableCell className="text-xs">
                    <a className="underline" href={p.source} target="_blank" rel="noreferrer">
                      pricing page
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent ledger entries</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Tokens in/out</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Request</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(u.created_at)}</TableCell>
                  <TableCell className="text-xs">
                    {u.job_type.replace(/_/g, " ")} {!u.succeeded && <Badge variant="destructive">failed</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">{u.model}</TableCell>
                  <TableCell className="text-xs">
                    {u.input_tokens ?? "—"} / {u.output_tokens ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">{formatMoney(u.cost_amount == null ? null : Number(u.cost_amount), u.cost_currency, 6)}</TableCell>
                  <TableCell>
                    <Badge variant={u.cost_source === "provider_reported" ? "success" : u.cost_source === "estimated" ? "info" : "outline"}>{u.cost_source}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate font-mono text-[10px]" title={u.request_id ?? ""}>
                    {u.request_id ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
