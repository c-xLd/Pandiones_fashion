import Link from "next/link";
import { Clapperboard, Plus } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { isVideoEnabled } from "@/lib/providers/registry";
import { formatDateTime } from "@/lib/utils";
import type { VideoProjectRow } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { StatusBadge } from "@/components/studio/status-badge";
import { AutoRefresh } from "@/components/studio/auto-refresh";

export const metadata = { title: "Video studio" };

export default async function VideoPage() {
  const ctx = await requirePageContext();
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
        title="Video studio"
        description={
          <span className="flex flex-wrap items-center gap-3">
            Product videos from one approved image, or advertising videos from selected images and a brief.
            <AutoRefresh active={active} intervalMs={10000} />
          </span>
        }
        actions={
          canEdit &&
          enabled && (
            <Button asChild>
              <Link href="/video/new">
                <Plus /> New video
              </Link>
            </Button>
          )
        }
      />
      {!enabled && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>Video generation is not configured</AlertTitle>
          <AlertDescription>
            Set <code>VIDEO_PROVIDER=gemini-veo</code>, <code>VIDEO_MODEL</code> (verify with <code>npm run providers:models</code>) and{" "}
            <code>GEMINI_API_KEY</code> on the server. Review the provider&apos;s current pricing and commercial terms first — see docs/API_PROVIDERS.md.
          </AlertDescription>
        </Alert>
      )}
      {projects.length === 0 ? (
        <EmptyState icon={Clapperboard} title="No video projects yet" description="Approve a generated image in Review, then choose “Make video”." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Spec</TableHead>
                <TableHead>Created</TableHead>
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
                  <TableCell>{p.kind}</TableCell>
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
                  <TableCell className="text-xs">{formatDateTime(p.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
