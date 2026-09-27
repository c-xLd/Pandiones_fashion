import { Trash2 } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { removeMember } from "@/server/actions/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { geminiConfig, isGeminiConfigured, qualityReviewEnabled, videoConfig } from "@/lib/env";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/studio/page-header";
import { StatusBadge } from "@/components/studio/status-badge";
import { ActionButton } from "@/components/studio/action-button";
import { AddMemberForm, MemberRoleSelect, OrgSettingsForm, ProviderCheckButton } from "./forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requirePageContext();
  const org = ctx.org.organizationId;
  const isAdmin = roleAtLeast(ctx.org.role, "admin");
  const [orgRes, membersRes, queueRes, auditRes] = await Promise.all([
    ctx.supabase.from("organizations").select("*").eq("id", org).single(),
    ctx.supabase.from("organization_members").select("*").eq("organization_id", org).order("created_at"),
    ctx.supabase.rpc("queue_health", { p_org: org }),
    isAdmin ? ctx.supabase.from("audit_logs").select("*").eq("organization_id", org).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
  ]);
  const members = (membersRes.data ?? []) as { id: string; user_id: string; role: string; created_at: string }[];

  // Member emails come from auth (admin API) and are only shown to admins.
  const emails: Record<string, string> = {};
  if (isAdmin) {
    await Promise.all(
      members.map(async (m) => {
        const { data } = await getSupabaseAdmin().auth.admin.getUserById(m.user_id);
        if (data.user?.email) emails[m.user_id] = data.user.email;
      }),
    );
  }

  let gemini: { image: string; analysis: string; maxRefs: number } | null = null;
  if (isGeminiConfigured()) {
    const g = geminiConfig();
    gemini = { image: g.imageModel, analysis: g.analysisModel, maxRefs: g.maxReferenceImages };
  }
  let video: { provider: string; model: string | null; durations: string } = { provider: "none", model: null, durations: "" };
  try {
    const v = videoConfig();
    video = { provider: v.provider, model: v.model, durations: v.allowedDurations.join(", ") };
  } catch (error) {
    video = { provider: `invalid (${error instanceof Error ? error.message : "error"})`, model: null, durations: "" };
  }
  const queue = (queueRes.data ?? []) as { status: string; jobs: number; oldest: string }[];
  const o = orgRes.data as { name: string; monthly_budget_usd: string | null; budget_alert_percent: number; budget_hard_limit: boolean };

  return (
    <>
      <PageHeader title="Settings" description={`Organization · your role: ${ctx.org.role}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organization & budget</CardTitle>
            <CardDescription>{isAdmin ? "Admins can change these settings." : "Read-only for your role."}</CardDescription>
          </CardHeader>
          <CardContent>
            <OrgSettingsForm
              name={o.name}
              budget={o.monthly_budget_usd == null ? null : Number(o.monthly_budget_usd)}
              alertPercent={o.budget_alert_percent}
              hardLimit={o.budget_hard_limit}
              readOnly={!isAdmin}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>Server-side configuration. Keys are never sent to the browser.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="grid grid-cols-[150px_1fr] gap-1">
              <dt className="text-muted-foreground">Image model</dt>
              <dd>{gemini?.image ?? "not configured"}</dd>
              <dt className="text-muted-foreground">Analysis / QC model</dt>
              <dd>{gemini?.analysis ?? "not configured"}</dd>
              <dt className="text-muted-foreground">Max references</dt>
              <dd>{gemini?.maxRefs ?? "—"}</dd>
              <dt className="text-muted-foreground">Automated QC</dt>
              <dd>{qualityReviewEnabled() ? "enabled" : "disabled"}</dd>
              <dt className="text-muted-foreground">Video provider</dt>
              <dd>
                {video.provider}
                {video.model ? ` · ${video.model}` : ""}
                {video.durations ? ` · durations ${video.durations}s` : ""}
              </dd>
            </dl>
            {isAdmin && <ProviderCheckButton />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>viewer: read · editor: create, generate, review · admin: settings, members, deletion · owner: everything</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm">
                      {emails[m.user_id] ?? `${m.user_id.slice(0, 8)}…`}
                      {m.user_id === ctx.userId && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell>
                      {isAdmin ? <MemberRoleSelect memberId={m.id} role={m.role} disabled={m.user_id === ctx.userId} /> : <StatusBadge status="none" label={m.role} />}
                    </TableCell>
                    <TableCell className="text-xs">{formatDateTime(m.created_at)}</TableCell>
                    <TableCell>
                      {isAdmin && m.user_id !== ctx.userId && (
                        <ActionButton size="sm" variant="ghost" action={removeMember.bind(null, m.id)} confirm="Remove this member from the organization?">
                          <Trash2 />
                        </ActionButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {isAdmin && <AddMemberForm />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue health (24h)</CardTitle>
            <CardDescription>Jobs are processed by the background worker (Vercel Cron → /api/jobs/run, or `npm run worker`).</CardDescription>
          </CardHeader>
          <CardContent>
            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs in the last 24 hours.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {queue.map((q) => (
                  <li key={q.status} className="flex justify-between">
                    <StatusBadge status={q.status} />
                    <span>
                      {Number(q.jobs)} jobs · oldest {formatDateTime(q.oldest)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
              <CardDescription>Latest 50 important actions.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((auditRes.data ?? []) as { id: string; created_at: string; action: string; actor_id: string | null; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> }[]).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(a.created_at)}</TableCell>
                      <TableCell className="text-xs font-medium">{a.action}</TableCell>
                      <TableCell className="text-xs">{a.actor_id ? emails[a.actor_id] ?? a.actor_id.slice(0, 8) : "system"}</TableCell>
                      <TableCell className="text-xs">
                        {a.entity_type} {a.entity_id?.slice(0, 8)}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate font-mono text-[10px]">{JSON.stringify(a.metadata)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
