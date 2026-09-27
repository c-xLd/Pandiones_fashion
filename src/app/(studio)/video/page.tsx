import Link from "next/link";
import { Clapperboard, Plus } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { isVideoEnabled } from "@/lib/providers/registry";
import { formatDateTime } from "@/lib/utils";
import type { VideoProjectRow } from "@/lib/types";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { StatusBadge } from "@/components/studio/status-badge";
import { AutoRefresh } from "@/components/studio/auto-refresh";

export const generateMetadata = pageMetadata((d) => d.video.metaTitle);

export default async function VideoPage() {
  const ctx = await requirePageContext();
  const { locale, d } = await getI18n();
  const t = d.video;
  const { data, error } = await ctx.supabase
    .from("video_projects")
    .select("*, products(sku)")
    .eq("organization_id", ctx.org.organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const projects = (data ?? []) as (VideoProjectRow & { products: { sku: string } | null })[];
  const enabled = isVideoEnabled();
  const canEdit = roleAtLeast(ctx.org.role, "editor");
  const active = projects.some((p) => p.status === "queued" || p.status === "processing");

  return (
    <>
      <PageHeader
        title={t.title}
        description={
          <span className="flex flex-wrap items-center gap-3">
            {t.description}
            <AutoRefresh active={active} intervalMs={10000} />
          </span>
        }
        actions={
          canEdit &&
          enabled && (
            <Button asChild>
              <Link href="/video/new">
                <Plus /> {t.newVideo}
              </Link>
            </Button>
          )
        }
      />
      {!enabled && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>{t.disabledTitle}</AlertTitle>
          <AlertDescription>{t.disabledBody}</AlertDescription>
        </Alert>
      )}
      {projects.length === 0 ? (
        <EmptyState icon={Clapperboard} title={t.emptyTitle} description={t.emptyBody} />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.name}</TableHead>
                <TableHead>{t.columns.type}</TableHead>
                <TableHead>{t.columns.product}</TableHead>
                <TableHead>{t.columns.status}</TableHead>
                <TableHead>{t.columns.approval}</TableHead>
                <TableHead>{t.columns.spec}</TableHead>
                <TableHead>{t.columns.created}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/video/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>{d.enums.videoKind[p.kind]}</TableCell>
                  <TableCell className="font-mono text-xs">{p.products?.sku ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.approval_status} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {p.duration_seconds}s · {p.aspect_ratio} · {p.resolution}
                  </TableCell>
                  <TableCell className="text-xs">{formatDateTime(p.created_at, locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
