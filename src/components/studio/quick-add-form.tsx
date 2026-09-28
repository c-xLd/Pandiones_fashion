"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { IMAGE_MIME_TYPES, validateDeclaredImage } from "@/lib/domain/files";
import { discardEmptyProduct, quickCreateProduct } from "@/server/actions/products";
import { discardEmptyModel, quickCreateModel } from "@/server/actions/models";
import { snapshotFiles, uploadFile } from "./upload-client";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

const MAX_FILES = { product: 8, model: 4 } as const;

interface Picked {
  key: string;
  file: File;
  preview: string;
}

/**
 * One-step add: name (optional) + photos (+ consent for models). Creates the
 * record, uploads the photos and jumps to the create canvas with it selected.
 */
export function QuickAddForm({ kind }: { kind: "product" | "model" }) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.quickAdd;
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [adultOk, setAdultOk] = useState(false);
  const [permissionOk, setPermissionOk] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Free preview URLs on unmount (removed photos are freed immediately).
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.preview)), []);

  function add(list: FileList | File[]) {
    setError(null);
    const next: Picked[] = [];
    for (const file of Array.from(list)) {
      const check = validateDeclaredImage({ name: file.name, size: file.size, type: file.type });
      if (!check.ok) {
        setError(fmt(d.errors[check.error], check.vars));
        continue;
      }
      next.push({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) });
    }
    setFiles((prev) => [...prev, ...next].slice(0, MAX_FILES[kind]));
  }

  async function submit() {
    if (!files.length) return setError(t.needPhoto);
    if (kind === "model" && (!adultOk || !permissionOk)) return setError(t.needConsent);
    setBusy(true);
    setError(null);
    try {
      const created =
        kind === "product"
          ? await quickCreateProduct({ title: name.trim() || undefined })
          : await quickCreateModel({ name: name.trim() || undefined, adultConfirmed: true, consentConfirmed: true });
      if (!created.ok) return setError(created.error);
      const id = created.data.id;
      let failed: string | null = null;
      let uploaded = 0;
      setProgress({ done: 0, total: files.length });
      for (const [i, item] of files.entries()) {
        const res = await uploadFile(kind === "product" ? "products" : "models", id, item.file, i === 0 ? "front" : "other", undefined, d.uploader.uploadFailed, d.uploader.unreadable);
        if (res.ok) uploaded++;
        else failed = res.error;
        setProgress({ done: i + 1, total: files.length });
      }
      if (!uploaded) {
        // Nothing was uploaded: remove the empty record so it does not linger.
        await (kind === "product" ? discardEmptyProduct(id) : discardEmptyModel(id));
        return setError(failed ?? t.needPhoto);
      }
      router.push(kind === "product" ? `/?productId=${id}` : `/?modelId=${id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="quick-name">{t.name}</Label>
        <Input
          id="quick-name"
          value={name}
          maxLength={kind === "product" ? 200 : 120}
          placeholder={kind === "product" ? t.productNamePlaceholder : t.modelNamePlaceholder}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="space-y-2">
        <Label>{t.photos}</Label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (busy) return;
            const dropped = Array.from(e.dataTransfer.files);
            void snapshotFiles(dropped).then(({ files, unreadable }) => {
              if (unreadable) setError(d.uploader.unreadable);
              add(files);
            });
          }}
          className={cn("grid grid-cols-3 gap-2 rounded-2xl border border-dashed p-2 transition-colors sm:grid-cols-4", dragging && "border-ring bg-accent/40")}
        >
          {files.map((f, i) => (
            <div key={f.key} className="group relative aspect-[3/4] overflow-hidden rounded-xl bg-muted">
              <img src={f.preview} alt="" className="h-full w-full object-cover" />
              {i === 0 && kind === "product" && (
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur">{t.firstIsFront}</span>
              )}
              {!busy && (
                <button
                  type="button"
                  aria-label={t.removePhoto}
                  onClick={() => {
                    URL.revokeObjectURL(f.preview);
                    setFiles((prev) => prev.filter((x) => x.key !== f.key));
                  }}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-90 backdrop-blur hover:opacity-100"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {files.length < MAX_FILES[kind] && (
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl bg-white/[0.03] p-2 text-center text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                files.length === 0 && "col-span-3 aspect-auto py-10 sm:col-span-4",
              )}
            >
              <ImagePlus className="h-6 w-6" />
              <span>{t.addPhotos}</span>
              {files.length === 0 && <span className="text-xs">{t.dropHint}</span>}
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple={MAX_FILES[kind] > 1}
          accept={IMAGE_MIME_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label={t.addPhotos}
          onChange={(e) => {
            const input = e.currentTarget;
            void snapshotFiles(input.files).then(({ files, unreadable }) => {
              input.value = "";
              if (unreadable) setError(d.uploader.unreadable);
              add(files);
            });
          }}
        />
      </div>

      {kind === "model" && (
        <div className="space-y-2 rounded-2xl border p-3">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={adultOk} onChange={(e) => setAdultOk(e.target.checked)} disabled={busy} />
            {d.create.consentAdult}
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={permissionOk} onChange={(e) => setPermissionOk(e.target.checked)} disabled={busy} />
            {d.create.consentPermission}
          </label>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" disabled={busy || !files.length || (kind === "model" && (!adultOk || !permissionOk))} className="w-full sm:w-auto">
        {busy && <Loader2 className="animate-spin" />}
        {busy ? (progress ? fmt(t.uploading, progress) : t.saving) : t.saveAndShoot}
      </Button>
    </form>
  );
}
