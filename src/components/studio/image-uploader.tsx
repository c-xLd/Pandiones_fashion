"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Upload, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { ASSET_ROLES, type AssetRole } from "@/lib/domain/schemas";
import { IMAGE_MIME_TYPES, parseBulkFileName, validateDeclaredImage } from "@/lib/domain/files";
import { runPool, uploadFile } from "./upload-client";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";

type ItemState = "pending" | "uploading" | "processing" | "done" | "error";

interface Item {
  key: string;
  file: File;
  role: AssetRole;
  state: ItemState;
  message?: string;
  warning?: string;
}

const CONCURRENCY = 3;

function guessRole(name: string): AssetRole {
  const parsed = parseBulkFileName(name);
  const role = parsed?.role as AssetRole | undefined;
  return role && (ASSET_ROLES as readonly string[]).includes(role) ? role : "front";
}

export function ImageUploader({ target, entityId }: { target: "products" | "models"; entityId: string }) {
  const router = useRouter();
  const { d } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const addFiles = useCallback((files: FileList | File[]) => {
    const next: Item[] = Array.from(files).map((file) => {
      const check = validateDeclaredImage({ name: file.name, size: file.size, type: file.type });
      return {
        key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        role: guessRole(file.name),
        state: check.ok ? "pending" : "error",
        message: check.ok ? undefined : fmt(d.errors[check.error], check.vars),
      };
    });
    setItems((prev) => [...prev, ...next]);
  }, [d]);

  async function start() {
    setRunning(true);
    const queue = items.filter((i) => i.state === "pending");
    await runPool(queue, CONCURRENCY, async (item) => {
      try {
        const res = await uploadFile(target, entityId, item.file, item.role, (phase) => update(item.key, { state: phase }), d.uploader.uploadFailed);
        if (res.ok) update(item.key, { state: "done", warning: res.warning ?? undefined });
        else update(item.key, { state: "error", message: res.error });
      } catch (err) {
        update(item.key, { state: "error", message: err instanceof Error ? err.message : d.uploader.genericFailed });
      }
    });
    setRunning(false);
    router.refresh();
  }

  const pending = items.filter((i) => i.state === "pending").length;
  const finished = items.filter((i) => i.state === "done" || i.state === "error").length;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-accent" : ""}`}
      >
        <Upload className="mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm">{d.uploader.dragHere}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => inputRef.current?.click()}>
          {d.uploader.choose}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_MIME_TYPES.join(",")}
          multiple
          className="sr-only"
          aria-label={d.uploader.chooseLabel}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">{d.uploader.hint}</p>
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          {running && <Progress value={(finished / items.length) * 100} label={d.uploader.progress} />}
          <ul className="divide-y rounded-md border text-sm">
            {items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-3 p-2">
                <StateIcon state={item.state} />
                <span className="min-w-0 flex-1 truncate" title={item.file.name}>
                  {item.file.name}
                  {item.message && <span className="block text-xs text-destructive">{item.message}</span>}
                  {item.warning && <span className="block text-xs text-warning-foreground">{item.warning}</span>}
                </span>
                {target === "products" && (
                  <NativeSelect
                    aria-label={fmt(d.uploader.roleFor, { name: item.file.name })}
                    className="h-8 w-28"
                    value={item.role}
                    disabled={item.state !== "pending"}
                    onChange={(e) => update(item.key, { role: e.target.value as AssetRole })}
                  >
                    {ASSET_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {d.enums.assetRole[r]}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                {item.state === "pending" || item.state === "error" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={running}
                    onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                  >
                    {d.common.remove}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" onClick={start} disabled={running || pending === 0}>
              {running ? <Loader2 className="animate-spin" /> : <Upload />}
              {pending > 0 ? fmt(d.uploader.uploadCount, { n: pending }) : d.uploader.upload}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={running}
              onClick={() => setItems((prev) => prev.filter((i) => i.state === "pending"))}
            >
              {d.uploader.clearFinished}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StateIcon({ state }: { state: ItemState }) {
  const { d } = useI18n();
  switch (state) {
    case "done":
      return <CheckCircle2 className="h-4 w-4 text-success" aria-label={d.uploader.uploaded} />;
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" aria-label={d.uploader.failed} />;
    case "uploading":
    case "processing":
      return <Loader2 className="h-4 w-4 animate-spin text-info" aria-label={state} />;
    default:
      return <AlertTriangle className="h-4 w-4 text-muted-foreground opacity-0" aria-hidden />;
  }
}
