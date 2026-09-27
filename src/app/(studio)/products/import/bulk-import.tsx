"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ASSET_ROLES, type AssetRole } from "@/lib/domain/schemas";
import { IMAGE_MIME_TYPES, parseBulkFileName, validateDeclaredImage } from "@/lib/domain/files";
import { ensureProductsForSkus } from "@/server/actions/products";
import { runPool, uploadFile } from "@/components/studio/upload-client";

type Row = {
  key: string;
  file: File;
  sku: string;
  role: AssetRole;
  state: "pending" | "uploading" | "processing" | "done" | "error";
  message?: string;
};

const MAX_FILES = 500;

export function BulkImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [productIds, setProductIds] = useState<Record<string, string>>({});

  const update = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addFiles(files: FileList) {
    const next: Row[] = [];
    for (const file of Array.from(files).slice(0, MAX_FILES - rows.length)) {
      const parsed = parseBulkFileName(file.name);
      const check = validateDeclaredImage({ name: file.name, size: file.size, type: file.type });
      next.push({
        key: crypto.randomUUID(),
        file,
        sku: parsed?.sku ?? "",
        role: ((parsed?.role as AssetRole) ?? "front") as AssetRole,
        state: check.ok && parsed ? "pending" : "error",
        message: !check.ok ? check.error : !parsed ? "Could not read a SKU from the file name; enter it manually." : undefined,
      });
    }
    setRows((prev) => [...prev, ...next]);
  }

  const counts = useMemo(() => {
    const skus = new Set(rows.filter((r) => r.sku).map((r) => r.sku));
    return {
      skus: skus.size,
      pending: rows.filter((r) => r.state === "pending").length,
      done: rows.filter((r) => r.state === "done").length,
      failed: rows.filter((r) => r.state === "error").length,
    };
  }, [rows]);

  async function start() {
    setGlobalError(null);
    const queue = rows.filter((r) => r.state === "pending" && r.sku.trim());
    if (!queue.length) return;
    setRunning(true);
    const ensure = await ensureProductsForSkus(Array.from(new Set(queue.map((r) => r.sku.trim()))));
    if (!ensure.ok) {
      setGlobalError(ensure.error);
      setRunning(false);
      return;
    }
    setProductIds((prev) => ({ ...prev, ...ensure.data }));
    await runPool(queue, 3, async (row) => {
      const productId = ensure.data[row.sku.trim()];
      if (!productId) return update(row.key, { state: "error", message: "Product could not be created." });
      try {
        const res = await uploadFile("products", productId, row.file, row.role, (phase) => update(row.key, { state: phase }));
        update(row.key, res.ok ? { state: "done", message: res.warning ?? undefined } : { state: "error", message: res.error });
      } catch (err) {
        update(row.key, { state: "error", message: err instanceof Error ? err.message : "Upload failed" });
      }
    });
    setRunning(false);
  }

  const total = rows.length;
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={running}>
            Choose images
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={IMAGE_MIME_TYPES.join(",")}
            className="sr-only"
            aria-label="Choose images to import"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="text-sm text-muted-foreground">
            {total} files · {counts.skus} SKUs · {counts.done} uploaded · {counts.failed} with errors
          </span>
          <Button type="button" className="ml-auto" onClick={start} disabled={running || counts.pending === 0}>
            {running ? <Loader2 className="animate-spin" /> : <Upload />} Import {counts.pending} files
          </Button>
        </div>
        {running && <Progress value={total ? ((counts.done + counts.failed) / total) * 100 : 0} label="Import progress" />}
        {globalError && <p className="text-sm text-destructive">{globalError}</p>}
        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="max-w-[240px] truncate" title={r.file.name}>
                    {r.file.name}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`SKU for ${r.file.name}`}
                      className="h-8"
                      value={r.sku}
                      disabled={running || r.state === "done"}
                      onChange={(e) => {
                        const sku = e.target.value;
                        const ok = validateDeclaredImage({ name: r.file.name, size: r.file.size, type: r.file.type }).ok;
                        update(r.key, { sku, ...(ok && sku.trim() ? { state: "pending", message: undefined } : {}) });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Role for ${r.file.name}`}
                      className="h-8"
                      value={r.role}
                      disabled={running || r.state === "done"}
                      onChange={(e) => update(r.key, { role: e.target.value as AssetRole })}
                    >
                      {ASSET_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="flex items-center gap-1.5">
                      {r.state === "done" && <CheckCircle2 className="h-4 w-4 text-success" />}
                      {r.state === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                      {(r.state === "uploading" || r.state === "processing") && <Loader2 className="h-4 w-4 animate-spin" />}
                      {r.state}
                      {r.state === "done" && productIds[r.sku.trim()] && (
                        <Link className="underline" href={`/products/${productIds[r.sku.trim()]}`}>
                          open
                        </Link>
                      )}
                    </span>
                    {r.message && <span className={r.state === "error" ? "text-destructive" : "text-warning-foreground"}>{r.message}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
