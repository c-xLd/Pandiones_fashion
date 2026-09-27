"use client";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const { d } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {total === 0
          ? d.pagination.noResults
          : fmt(d.pagination.range, { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>
              <ChevronLeft /> {d.pagination.previous}
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft /> {d.pagination.previous}
          </Button>
        )}
        <span>{fmt(d.pagination.page, { page, pages })}</span>
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>
              {d.pagination.next} <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {d.pagination.next} <ChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
}
