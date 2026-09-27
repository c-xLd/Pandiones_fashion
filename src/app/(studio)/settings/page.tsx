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
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { fmt } from "@/lib/i18n/config";
import type { OrgRole } from "@/lib/domain/schemas";

export const generateMetadata = pageMetadata((d) => d.settings.metaTitle);

export default async function SettingsPage() {
  const ctx = await requirePageContext();
  const { locale, d } = await getI18n();
  const t = d.settings;
  const org = ctx.org.organizationId;
  const isAdmin = roleAtLeast(ctx.org.role, "admin");
  const [orgRes, membersRes, queueRes, auditRes] = await Promise.all([
    ctx.supabase.from("organizations").select("*").eq("id", org).single(),
    ctx.supabase.from("organization_members").select("*").eq("organization_id", org).order("created_at"),
    ctx.supabase.rpc("queue_health", { p_org: org }),
    isAdmin ? ctx.supabase.from("audit_logs").select("*").eq("organization_id", org).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
  ]);
  const members = (membersRes.data ?? []) as { id: string; user_id: string; role: OrgRole; created_at: string }[];

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
      <PageHeader title={t.title} description={fmt(t.description, { role: d.enums.role[ctx.org.role] })} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.orgTitle}</CardTitle>
            <CardDescription>{isAdmin ? t.orgAdmin : t.orgReadOnly}</CardDescription>
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
            <CardTitle>{t.providersTitle}</CardTitle>
            <CardDescription>{t.providersDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="grid grid-cols-[150px_1fr] gap-1">
              <dt className="text-muted-foreground">{t.imageModel}</dt>
              <dd>{gemini?.image ?? d.dashboard.notConfigured}</dd>
              <dt className="text-muted-foreground">{t.analysisModel}</dt>
              <dd>{gemini?.analysis ?? d.dashboard.notConfigured}</dd>
              <dt className="text-muted-foreground">{t.maxRefs}</dt>
              <dd>{gemini?.maxRefs ?? "—"}</dd>
              <dt className="text-muted-foreground">{t.autoQc}</dt>
              <dd>{qualityReviewEnabled() ? t.enabled : t.disabled}</dd>
              <dt className="text-muted-foreground">{t.videoProvider}</dt>
              <dd>
                {video.provider}
                {video.model ? ` · ${video.model}` : ""}
                {video.durations ? fmt(t.durations, { list: video.durations }) : ""}
              </dd>
            </dl>
            {isAdmin && <ProviderCheckButton />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.membersTitle}</CardTitle>
            <CardDescription>{t.rolesHelp}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.member}</TableHead>
                  <TableHead>{t.role}</TableHead>
                  <TableHead>{t.since}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm">
                      {emails[m.user_id] ?? `${m.user_id.slice(0, 8)}…`}
                      {m.user_id === ctx.userId && <span className="ml-1 text-xs text-muted-foreground">{d.common.you}</span>}
                    </TableCell>
                    <TableCell>
                      {isAdmin ? <MemberRoleSelect memberId={m.id} role={m.role} disabled={m.user_id === ctx.userId} /> : <StatusBadge status="none" label={d.enums.role[m.role]} />}
                    </TableCell>
                    <TableCell className="text-xs">{formatDateTime(m.created_at, locale)}</TableCell>
                    <TableCell>
                      {isAdmin && m.user_id !== ctx.userId && (
                        <ActionButton size="sm" variant="ghost" action={removeMember.bind(null, m.id)} confirm={t.removeConfirm}>
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
            <CardTitle>{t.queueTitle}</CardTitle>
            <CardDescription>{t.queueDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noJobs24h}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {queue.map((q) => (
                  <li key={q.status} className="flex justify-between">
                    <StatusBadge status={q.status} />
                    <span>{fmt(t.queueRow, { n: Number(q.jobs), date: formatDateTime(q.oldest, locale) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t.auditTitle}</CardTitle>
              <CardDescription>{t.auditDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.auditColumns.time}</TableHead>
                    <TableHead>{t.auditColumns.action}</TableHead>
                    <TableHead>{t.auditColumns.actor}</TableHead>
                    <TableHead>{t.auditColumns.entity}</TableHead>
                    <TableHead>{t.auditColumns.details}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((auditRes.data ?? []) as { id: string; created_at: string; action: string; actor_id: string | null; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> }[]).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(a.created_at, locale)}</TableCell>
                      <TableCell className="text-xs font-medium">{a.action}</TableCell>
                      <TableCell className="text-xs">{a.actor_id ? emails[a.actor_id] ?? a.actor_id.slice(0, 8) : d.common.system}</TableCell>
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
