import type { ProductAnalysis } from "@/lib/domain/analysis";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

function Conf({ c }: { c: "high" | "medium" | "low" }) {
  return <Badge variant={c === "high" ? "success" : c === "medium" ? "info" : "warning"}>{c}</Badge>;
}

export function AnalysisView({
  analysis,
  model,
  analyzedAt,
}: {
  analysis: ProductAnalysis;
  model: string | null;
  analyzedAt: string | null;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
      <p className="text-xs text-muted-foreground">
        Unverified AI observation · {model ?? "unknown model"} · {formatDateTime(analyzedAt)}
      </p>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[140px_1fr]">
        <dt className="text-muted-foreground">Category</dt>
        <dd className="flex items-center gap-2">
          {analysis.category} <Conf c={analysis.categoryConfidence} />
        </dd>
        <dt className="text-muted-foreground">Colors</dt>
        <dd className="flex flex-wrap gap-2">
          {analysis.dominantColors.map((c) => (
            <span key={c.name} className="inline-flex items-center gap-1">
              {c.hex && <span className="inline-block h-3 w-3 rounded-full border" style={{ backgroundColor: c.hex }} aria-hidden />}
              {c.name} <Conf c={c.confidence} />
            </span>
          ))}
        </dd>
        <dt className="text-muted-foreground">Fabric</dt>
        <dd>{analysis.fabricAppearance || "—"}</dd>
        <dt className="text-muted-foreground">Silhouette</dt>
        <dd>{analysis.silhouette || "—"}</dd>
        <dt className="text-muted-foreground">Construction</dt>
        <dd>{analysis.construction || "—"}</dd>
        <dt className="text-muted-foreground">Front / back</dt>
        <dd>{analysis.frontBackDistinctions || "—"}</dd>
        <dt className="text-muted-foreground">Image quality</dt>
        <dd>
          <Badge variant={analysis.imageQuality.overall === "good" ? "success" : analysis.imageQuality.overall === "acceptable" ? "info" : "warning"}>
            {analysis.imageQuality.overall}
          </Badge>{" "}
          {analysis.imageQuality.issues.join("; ")}
        </dd>
        <dt className="text-muted-foreground">Missing angles</dt>
        <dd>{analysis.missingReferenceAngles.length ? analysis.missingReferenceAngles.join(", ") : "none reported"}</dd>
      </dl>
      {analysis.details.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Visible details</p>
          <ul className="space-y-1">
            {analysis.details.map((d, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{d.element}</Badge> {d.description} <Conf c={d.confidence} />
                {d.visibleInImages.length > 0 && <span className="text-xs text-muted-foreground">images {d.visibleInImages.join(", ")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {analysis.uncertainties.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Uncertainties</p>
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
