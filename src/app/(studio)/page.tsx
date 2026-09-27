import Link from "next/link";
import { AlertTriangle, Camera, ClipboardCheck, ListChecks, Shirt } from "lucide-react";
import { requirePageContext } from "@/server/context";
import { signUrls } from "@/server/storage";
import { budgetState } from "@/lib/domain/costs";
import { isGeminiConfigured } from "@/lib/env";
import { isVideoEnabled } from "@/lib/providers/registry";
import { formatMoney } from "@/lib/utils";
import type { ResultRow } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/studio/page-header";
import { MediaThumb } from "@/components/studio/media-thumb";
import { QcBadge, StatusBadge } from "@/components/studio/status-badge";
import { EmptyState } from "@/components/studio/empty-state";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const ctx = await requirePageContext();
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
    { label: "Active products", value: products.count ?? 0, href: "/products", icon: Shirt },
    { label: "Awaiting review", value: pendingReview.count ?? 0, href: "/review", icon: ClipboardCheck },
    { label: "Jobs in progress", value: activeJobs.count ?? 0, href: "/jobs?status=active", icon: ListChecks },
    { label: "Failed jobs (7 days)", value: failedJobs.count ?? 0, href: "/jobs?status=failed", icon: AlertTriangle },
  ];

  return (
    <>
      <PageHeader
        title={`Welcome to ${ctx.org.organizationName}`}
        description="Product → images → review → video. Every generation runs as a durable background job."
        actions={
          <Button asChild>
            <Link href="/shoots/new">
              <Camera /> New shoot
            </Link>
          </Button>
        }
      />
      {error === "forbidden" && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>You do not have permission to open that page.</AlertDescription>
        </Alert>
      )}
      {!isGeminiConfigured() && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>Image generation is not configured</AlertTitle>
          <AlertDescription>
            Set <code>GEMINI_API_KEY</code> and <code>GEMINI_IMAGE_MODEL</code> on the server. Products and uploads work without them. See
            docs/SETUP.md.
          </AlertDescription>
        </Alert>
      )}
      {budgetInfo.level === "warning" || budgetInfo.level === "exceeded" ? (
        <Alert variant={budgetInfo.level === "exceeded" ? "destructive" : "warning"} className="mb-4">
          <AlertTitle>{budgetInfo.level === "exceeded" ? "Monthly budget exceeded" : "Approaching monthly budget"}</AlertTitle>
          <AlertDescription>
            {formatMoney(monthSpend, "USD", 2)} of {formatMoney(budget, "USD", 2)} ({budgetInfo.percent?.toFixed(0)}%) — mostly estimates.{" "}
            <Link href="/costs" className="underline">
              View costs
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
            <CardTitle>Latest generated images</CardTitle>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <EmptyState
                icon={Camera}
                title="No images generated yet"
                description="Create a product, upload reference images and start a shoot."
                action={
                  <Button asChild size="sm">
                    <Link href="/products/new">Add a product</Link>
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {results.map((r) => (
                  <Link key={r.id} href={`/results/${r.id}`} className="space-y-1">
                    <MediaThumb src={r.thumbnail_path ? urls[r.thumbnail_path] : null} alt={`Result ${r.shot_type ?? ""}`} />
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
            <CardTitle>This month</CardTitle>
            <CardDescription>Provider usage cost (estimates unless marked actual).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-3xl font-semibold">{formatMoney(monthSpend, "USD", 2)}</p>
            <p className="text-muted-foreground">Budget: {budget == null ? "not set" : formatMoney(budget, "USD", 2)}</p>
            <div className="space-y-1 border-t pt-3">
              <p>
                Image generation: <strong>{isGeminiConfigured() ? "configured" : "not configured"}</strong>
              </p>
              <p>
                Video generation: <strong>{isVideoEnabled() ? "configured" : "disabled"}</strong>
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/costs">Cost dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
