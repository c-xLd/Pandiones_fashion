import Link from "next/link";
import { AlertTriangle, Camera, ClipboardCheck, ListChecks, Shirt } from "lucide-react";
import { requirePageContext } from "@/server/context";
import { signUrls } from "@/server/storage";
import { budgetState } from "@/lib/domain/costs";
import { isGeminiConfigured } from "@/lib/env";
import { isVideoEnabled } from "@/lib/providers/registry";
import { formatMoney } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { fmt } from "@/lib/i18n/config";
import type { ResultRow } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/studio/page-header";
import { MediaThumb } from "@/components/studio/media-thumb";
import { QcBadge, StatusBadge } from "@/components/studio/status-badge";
import { EmptyState } from "@/components/studio/empty-state";

export const generateMetadata = pageMetadata((d) => d.dashboard.metaTitle);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const ctx = await requirePageContext();
  const { locale, d } = await getI18n();
  const money = (v: number | null) => formatMoney(v, "USD", 2, locale);
  const db = ctx.supabase;
  const org = ctx.org.organizationId;

  const [products, pendingReview, activeJobs, failedJobs, recent, orgRow, spend] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("organization_id", org).neq("status", "archived"),
    db.from("generation_results").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("review_status", "pending"),
    db.from("generation_jobs").select("id", { count: "exact", head: true }).eq("organization_id", org).in("status", ["queued", "processing"]),
    db
      .from("generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("status", "failed")
      .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
    db.from("generation_results").select("*").eq("organization_id", org).eq("kind", "image").order("created_at", { ascending: false }).limit(8),
    db.from("organizations").select("monthly_budget_usd, budget_alert_percent").eq("id", org).single(),
    db.rpc("org_month_spend", { p_org: org }),
  ]);

  const results = (recent.data ?? []) as ResultRow[];
  const urls = await signUrls(db, results.map((r) => r.thumbnail_path));
  const monthSpend = Number(spend.data ?? 0);
  const budget = orgRow.data?.monthly_budget_usd == null ? null : Number(orgRow.data.monthly_budget_usd);
  const budgetInfo = budgetState(monthSpend, budget, orgRow.data?.budget_alert_percent ?? 80);

  const stats = [
    { label: d.dashboard.activeProducts, value: products.count ?? 0, href: "/products", icon: Shirt },
    { label: d.dashboard.awaitingReview, value: pendingReview.count ?? 0, href: "/review", icon: ClipboardCheck },
    { label: d.dashboard.jobsInProgress, value: activeJobs.count ?? 0, href: "/jobs?status=active", icon: ListChecks },
    { label: d.dashboard.failedJobs, value: failedJobs.count ?? 0, href: "/jobs?status=failed", icon: AlertTriangle },
  ];

  return (
    <>
      <PageHeader
        title={fmt(d.dashboard.welcome, { org: ctx.org.organizationName })}
        description={d.dashboard.description}
        actions={
          <Button asChild>
            <Link href="/shoots/new">
              <Camera /> {d.nav.newShoot}
            </Link>
          </Button>
        }
      />
      {error === "forbidden" && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{d.dashboard.forbidden}</AlertDescription>
        </Alert>
      )}
      {!isGeminiConfigured() && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>{d.dashboard.geminiMissingTitle}</AlertTitle>
          <AlertDescription>{d.dashboard.geminiMissingBody}</AlertDescription>
        </Alert>
      )}
      {budgetInfo.level === "warning" || budgetInfo.level === "exceeded" ? (
        <Alert variant={budgetInfo.level === "exceeded" ? "destructive" : "warning"} className="mb-4">
          <AlertTitle>{budgetInfo.level === "exceeded" ? d.dashboard.budgetExceededTitle : d.dashboard.budgetWarningTitle}</AlertTitle>
          <AlertDescription>
            {fmt(d.dashboard.budgetBody, { spend: money(monthSpend), budget: money(budget), percent: budgetInfo.percent?.toFixed(0) })}{" "}
            <Link href="/costs" className="underline">
              {d.dashboard.viewCosts}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, href, icon: Icon }) => (
          <Link key={label} href={href}>
            <Card className="transition-colors hover:bg-accent/50">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardDescription>{label}</CardDescription>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{d.dashboard.latestImages}</CardTitle>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <EmptyState
                icon={Camera}
                title={d.dashboard.noImagesTitle}
                description={d.dashboard.noImagesBody}
                action={
                  <Button asChild size="sm">
                    <Link href="/products/new">{d.dashboard.addProduct}</Link>
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {results.map((r) => (
                  <Link key={r.id} href={`/results/${r.id}`} className="space-y-1">
                    <MediaThumb src={r.thumbnail_path ? urls[r.thumbnail_path] : null} alt={r.shot_type ?? ""} />
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={r.review_status} />
                      <QcBadge status={r.qc_status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{d.dashboard.thisMonth}</CardTitle>
            <CardDescription>{d.dashboard.thisMonthDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-3xl font-semibold">{money(monthSpend)}</p>
            <p className="text-muted-foreground">{fmt(d.dashboard.budget, { budget: budget == null ? d.common.notSet : money(budget) })}</p>
            <div className="space-y-1 border-t pt-3">
              <p>
                {d.dashboard.imageGeneration} <strong>{isGeminiConfigured() ? d.dashboard.configured : d.dashboard.notConfigured}</strong>
              </p>
              <p>
                {d.dashboard.videoGeneration} <strong>{isVideoEnabled() ? d.dashboard.configured : d.dashboard.disabled}</strong>
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/costs">{d.dashboard.costDashboard}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
