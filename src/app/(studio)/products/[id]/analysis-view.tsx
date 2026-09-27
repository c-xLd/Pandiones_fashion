"use client";
import type { ProductAnalysis } from "@/lib/domain/analysis";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";

function Conf({ c }: { c: "high" | "medium" | "low" }) {
  const { d } = useI18n();
  return <Badge variant={c === "high" ? "success" : c === "medium" ? "info" : "warning"}>{d.enums.confidence[c]}</Badge>;
}

/**
 * AI analysis as returned by the model. Enum values are translated here;
 * free-text values are shown as written by the model, which is asked to use
 * the language of the user who requested the analysis.
 */
export function AnalysisView({
  analysis,
  model,
  analyzedAt,
}: {
  analysis: ProductAnalysis;
  model: string | null;
  analyzedAt: string | null;
}) {
  const { locale, d } = useI18n();
  const a = d.analysis;
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
      <p className="text-xs text-muted-foreground">
        {fmt(a.unverified, { model: model ?? a.unknownModel, date: formatDateTime(analyzedAt, locale) })}
      </p>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[140px_1fr]">
        <dt className="text-muted-foreground">{a.category}</dt>
        <dd className="flex items-center gap-2">
          {analysis.category} <Conf c={analysis.categoryConfidence} />
        </dd>
        <dt className="text-muted-foreground">{a.colors}</dt>
        <dd className="flex flex-wrap gap-2">
          {analysis.dominantColors.map((c) => (
            <span key={c.name} className="inline-flex items-center gap-1">
              {c.hex && <span className="inline-block h-3 w-3 rounded-full border" style={{ backgroundColor: c.hex }} aria-hidden />}
              {c.name} <Conf c={c.confidence} />
            </span>
          ))}
        </dd>
        <dt className="text-muted-foreground">{a.fabric}</dt>
        <dd>{analysis.fabricAppearance || "—"}</dd>
        <dt className="text-muted-foreground">{a.silhouette}</dt>
        <dd>{analysis.silhouette || "—"}</dd>
        <dt className="text-muted-foreground">{a.construction}</dt>
        <dd>{analysis.construction || "—"}</dd>
        <dt className="text-muted-foreground">{a.frontBack}</dt>
        <dd>{analysis.frontBackDistinctions || "—"}</dd>
        <dt className="text-muted-foreground">{a.imageQuality}</dt>
        <dd>
          <Badge variant={analysis.imageQuality.overall === "good" ? "success" : analysis.imageQuality.overall === "acceptable" ? "info" : "warning"}>
            {d.enums.imageQuality[analysis.imageQuality.overall]}
          </Badge>{" "}
          {analysis.imageQuality.issues.join("; ")}
        </dd>
        <dt className="text-muted-foreground">{a.missingAngles}</dt>
        <dd>
          {analysis.missingReferenceAngles.length
            ? analysis.missingReferenceAngles.map((r) => d.enums.assetRole[r]).join(", ")
            : a.noneReported}
        </dd>
      </dl>
      {analysis.details.length > 0 && (
        <div>
          <p className="mb-1 font-medium">{a.visibleDetails}</p>
          <ul className="space-y-1">
            {analysis.details.map((det, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{d.enums.detailElement[det.element]}</Badge> {det.description} <Conf c={det.confidence} />
                {det.visibleInImages.length > 0 && (
                  <span className="text-xs text-muted-foreground">{fmt(a.images, { list: det.visibleInImages.join(", ") })}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {analysis.uncertainties.length > 0 && (
        <div>
          <p className="mb-1 font-medium">{a.uncertainties}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {analysis.uncertainties.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
