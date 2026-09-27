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
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { fmt } from "@/lib/i18n/config";

export const generateMetadata = pageMetadata((d) => d.costs.metaTitle);

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
  const { locale, d } = await getI18n();
  const t = d.costs;
  const money = (v: number | null, digits = 4) => formatMoney(v, "USD", digits, locale);
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
  const daily = ((dailyRes.data ?? []) as { day: string; cost: number; calls: number }[]).map((row) => ({ ...row, cost: Number(row.cost) }));
  const maxDaily = Math.max(0.000001, ...daily.map((row) => row.cost));
  const products = (productsRes.data ?? []) as { product_id: string; sku: string; title: string; cost: number; images: number; videos: number }[];
  const recent = (recentRes.data ?? []) as UsageRow[];
  const budget = orgRes.data?.monthly_budget_usd == null ? null : Number(orgRes.data.monthly_budget_usd);
  const budgetInfo = budgetState(total, budget, orgRes.data?.budget_alert_percent ?? 80);
  const pricing = Object.entries(pricingTable());

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <form className="flex gap-2">
            <Input type="month" name="month" defaultValue={month} aria-label={t.month} className="w-44" />
            <Button type="submit" variant="secondary">
              {d.common.show}
            </Button>
          </form>
        }
      />
      {budgetInfo.level !== "none" && budgetInfo.level !== "ok" && (
        <Alert variant={budgetInfo.level === "exceeded" ? "destructive" : "warning"} className="mb-4">
          <AlertTitle>{budgetInfo.level === "exceeded" ? t.budgetExceeded : t.budgetAlert}</AlertTitle>
          <AlertDescription>
            {fmt(t.budgetBody, { spend: money(total, 2), budget: money(budget, 2), percent: budgetInfo.percent?.toFixed(0) })}{" "}
            {orgRes.data?.budget_hard_limit ? t.hardLimitOn : t.hardLimitOff}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{fmt(t.total, { month })}</CardDescription>
            <CardTitle className="text-3xl">{money(total, 2)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>{fmt(t.actual, { amount: money(actual) })}</p>
            <p>{fmt(t.estimated, { amount: money(estimated) })}</p>
            <p>{fmt(t.unknownCalls, { n: unknownCalls })}</p>
            <p>{fmt(t.budget, { budget: budget == null ? d.common.notSet : money(budget, 2) })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t.perImage}</CardDescription>
            <CardTitle className="text-3xl">{images ? money(imageCost / images) : "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {fmt(t.perImageDetail, { images, gen: money(imageCost), qc: money(qcCost), analysis: money(analysisCost) })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t.perVideo}</CardDescription>
            <CardTitle className="text-3xl">{videos ? money(videoCost / videos) : "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {fmt(t.perVideoDetail, { videos, seconds: sum((r) => r.video_seconds, (r) => r.job_type === "video_generation"), cost: money(videoCost) })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t.failed}</CardDescription>
            <CardTitle className="text-3xl">{money(failedCost)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{fmt(t.failedDetail, { n: failedCalls })}</CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.daily}</CardTitle>
          </CardHeader>
          <CardContent>
            {daily.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noUsage}</p>
            ) : (
              <ul className="space-y-1" aria-label={t.daily}>
                {daily.map((day) => (
                  <li key={day.day} className="grid grid-cols-[80px_1fr_90px] items-center gap-2 text-xs">
                    <span>{day.day}</span>
                    <span className="h-3 rounded bg-primary/80" style={{ width: `${Math.max(2, (day.cost / maxDaily) * 100)}%` }} />
                    <span className="text-right">{money(day.cost, 3)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t.byModel}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.providerModel}</TableHead>
                  <TableHead>{t.calls}</TableHead>
                  <TableHead>{t.cost}</TableHead>
                  <TableHead>{t.source}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(byModel.entries()).map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="text-xs">{k}</TableCell>
                    <TableCell>{v.calls}</TableCell>
                    <TableCell>{money(v.cost)}</TableCell>
                    <TableCell className="space-x-1">
                      {Array.from(v.sources).map((s) => (
                        <Badge key={s} variant={s === "provider_reported" ? "success" : s === "estimated" ? "info" : "outline"}>
                          {(d.enums.costSource as Record<string, string>)[s] ?? s}
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
            <CardTitle>{t.topProducts}</CardTitle>
          </CardHeader>
          <CardContent>
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noProductUsage}</p>
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
                        {fmt(t.productUnits, { images: Number(p.images), videos: Number(p.videos) })}
                      </TableCell>
                      <TableCell>{money(Number(p.cost))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t.limits}</CardTitle>
            <CardDescription>
              {t.limitsDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{fmt(t.concurrency, { value: process.env.WORKER_MAX_CONCURRENCY ?? t.concurrencyDefault })}</p>
            {Object.entries(LIMITS).map(([k, [n, w]]) => (
              <p key={k}>{fmt(t.rateLimit, { scope: t.rateScopes[k as keyof typeof t.rateScopes], n, w })}</p>
            ))}
            <p>{fmt(t.hardLimit, { state: orgRes.data?.budget_hard_limit ? d.common.on : d.common.off })}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t.pricingTitle}</CardTitle>
          <CardDescription>
            {t.pricingDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.modelPrefix}</TableHead>
                <TableHead>{t.rates}</TableHead>
                <TableHead>{t.verified}</TableHead>
                <TableHead>{t.source}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricing.map(([key, p]) => (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell className="text-xs">
                    {p.kind === "tokens"
                      ? fmt(t.tokenRates, { input: p.inputPerMillion, text: p.outputTextPerMillion }) +
                        (p.outputImagePerMillion != null ? fmt(t.imageRate, { image: p.outputImagePerMillion }) : "")
                      : Object.entries(p.perSecond)
                          .map(([r, v]) => `${r}: ${v}/s`)
                          .join(" · ")}
                  </TableCell>
                  <TableCell>{p.verifiedAt ? <Badge variant="success">{p.verifiedAt}</Badge> : <Badge variant="warning">{t.unverified}</Badge>}</TableCell>
                  <TableCell className="text-xs">
                    <a className="underline" href={p.source} target="_blank" rel="noreferrer">
                      {t.pricingPage}
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
          <CardTitle>{t.recent}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.time}</TableHead>
                <TableHead>{t.columns.type}</TableHead>
                <TableHead>{t.columns.model}</TableHead>
                <TableHead>{t.columns.tokens}</TableHead>
                <TableHead>{t.columns.cost}</TableHead>
                <TableHead>{t.columns.source}</TableHead>
                <TableHead>{t.columns.request}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(u.created_at, locale)}</TableCell>
                  <TableCell className="text-xs">
                    {d.enums.jobType[u.job_type]} {!u.succeeded && <Badge variant="destructive">{t.failedBadge}</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">{u.model}</TableCell>
                  <TableCell className="text-xs">
                    {u.input_tokens ?? "—"} / {u.output_tokens ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">{formatMoney(u.cost_amount == null ? null : Number(u.cost_amount), u.cost_currency, 6, locale)}</TableCell>
                  <TableCell>
                    <Badge variant={u.cost_source === "provider_reported" ? "success" : u.cost_source === "estimated" ? "info" : "outline"}>{d.enums.costSource[u.cost_source]}</Badge>
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
