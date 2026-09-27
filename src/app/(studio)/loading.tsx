import { getI18n } from "@/lib/i18n/server";

export default async function Loading() {
  const { d } = await getI18n();
  return (
    <div className="space-y-4" aria-busy="true" aria-label={d.common.loading}>
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
