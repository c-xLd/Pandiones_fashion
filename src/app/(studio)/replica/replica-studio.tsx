"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Plus, UserRound, X, Copy } from "lucide-react";
import { IMAGE_MIME_TYPES, validateDeclaredImage } from "@/lib/domain/files";
import { MAX_REPLICA_SCENES, IMAGE_ENGINES, OUTPUT_QUALITIES, type ImageEngine, type OutputQuality } from "@/lib/domain/schemas";
import { createReplicaBatch } from "@/server/actions/generation";
import { discardEmptyProduct, quickCreateProduct } from "@/server/actions/products";
import { discardEmptyModel, quickCreateModel } from "@/server/actions/models";
import { snapshotFiles, uploadFile } from "@/components/studio/upload-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  name: string;
  thumb: string | null;
}
interface Scene {
  key: string;
  preview: string;
  path: string | null;
  error?: string;
}

export function ReplicaStudio({
  products,
  models,
  disabledReason,
}: {
  products: (Item & { hasAssets: boolean })[];
  models: Item[];
  disabledReason: string | null;
}) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.replica;
  const [pending, start] = useTransition();
  const [localProducts, setLocalProducts] = useState<(Item & { hasAssets: boolean })[]>([]);
  const [localModels, setLocalModels] = useState<Item[]>([]);
  const allProducts = [...localProducts.filter((l) => !products.some((p) => p.id === l.id)), ...products];
  const allModels = [...localModels.filter((l) => !models.some((m) => m.id === l.id)), ...models];
  const [productId, setProductId] = useState(products.find((p) => p.hasAssets)?.id ?? "");
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [batchId] = useState(() => crypto.randomUUID());
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [quality, setQuality] = useState<OutputQuality>("2K");
  const [engine, setEngine] = useState<ImageEngine>("auto");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<"product" | "model" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [adultOk, setAdultOk] = useState(false);
  const [permissionOk, setPermissionOk] = useState(false);
  const productInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const sceneInput = useRef<HTMLInputElement>(null);

  const product = allProducts.find((p) => p.id === productId);
  const readyScenes = scenes.filter((s) => s.path);
  const uploadingScenes = scenes.some((s) => !s.path && !s.error);
  const blocking = disabledReason ?? (!product?.hasAssets ? t.needProduct : !readyScenes.length ? t.needReference : null);

  function invalid(file: File): string | null {
    const r = validateDeclaredImage({ name: file.name, size: file.size, type: file.type });
    return r.ok ? null : fmt(d.errors[r.error], r.vars);
  }

  async function addProduct(files: File[]) {
    const list = files.slice(0, 4);
    const bad = list.map(invalid).find(Boolean);
    if (bad) return setError(bad);
    setError(null);
    setBusy("product");
    try {
      const title = (list[0]?.name ?? "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 80);
      const created = await quickCreateProduct({ title: title || undefined });
      if (!created.ok) return setError(created.error);
      let ok = 0;
      for (const [i, file] of list.entries()) {
        const res = await uploadFile("products", created.data.id, file, i === 0 ? "front" : "other", undefined, d.uploader.uploadFailed, d.uploader.unreadable);
        if (res.ok) ok++;
        else setError(res.error);
      }
      if (!ok) return void (await discardEmptyProduct(created.data.id));
      setLocalProducts((p) => [{ id: created.data.id, name: title || created.data.sku, thumb: list[0] ? URL.createObjectURL(list[0]) : null, hasAssets: true }, ...p]);
      setProductId(created.data.id);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function addModel(file: File) {
    const bad = invalid(file);
    if (bad) return setError(bad);
    setError(null);
    setBusy("model");
    try {
      const created = await quickCreateModel({ adultConfirmed: true, consentConfirmed: true });
      if (!created.ok) return setError(created.error);
      const res = await uploadFile("models", created.data.id, file, "other", undefined, d.uploader.uploadFailed, d.uploader.unreadable);
      if (!res.ok) {
        await discardEmptyModel(created.data.id);
        return setError(res.error);
      }
      setLocalModels((m) => [{ id: created.data.id, name: created.data.name, thumb: URL.createObjectURL(file) }, ...m]);
      setModelId(created.data.id);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function addScenes(files: File[]) {
    setError(null);
    const room = MAX_REPLICA_SCENES - scenes.length;
    for (const file of files.slice(0, room)) {
      const bad = invalid(file);
      const key = crypto.randomUUID();
      setScenes((s) => [...s, { key, preview: URL.createObjectURL(file), path: null, error: bad ?? undefined }]);
      if (bad) continue;
      const res = await uploadFile("references", batchId, file, "other", undefined, d.uploader.uploadFailed, d.uploader.unreadable);
      setScenes((s) => s.map((x) => (x.key === key ? { ...x, path: res.ok ? (res.path ?? null) : null, error: res.ok ? undefined : res.error } : x)));
    }
  }

  function submit() {
    if (blocking || pending || uploadingScenes || !product) return;
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await createReplicaBatch({
        productId: product.id,
        modelProfileId: modelId || null,
        scenePaths: readyScenes.map((s) => s.path as string),
        imageSize: quality,
        engine,
        instructions: instructions.trim(),
        idempotencyKey,
      });
      if (!res.ok) return setError(res.error);
      setNotice(fmt(t.queued, { n: res.data.jobCount }));
      scenes.forEach((s) => URL.revokeObjectURL(s.preview));
      setScenes([]);
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    });
  }

  const tile = "relative flex aspect-[3/4] w-24 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border text-center text-xs sm:w-28";

  return (
    <div className="space-y-5 rounded-3xl border bg-card/80 p-4 sm:p-5">
      <section>
        <p className="mb-2 text-sm font-medium">{t.product}</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" disabled={busy !== null} onClick={() => productInput.current?.click()} className={cn(tile, "border-dashed text-muted-foreground hover:bg-accent")}>
            {busy === "product" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            {busy === "product" ? t.uploading : t.uploadProduct}
          </button>
          {allProducts.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!p.hasAssets}
              onClick={() => setProductId(p.id)}
              className={cn(tile, "disabled:opacity-40", p.id === productId && "ring-2 ring-ring")}
              title={p.name}
            >
              {p.thumb ? <img src={p.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-1 text-[11px] text-white">{p.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="mb-2 text-sm font-medium">{t.model}</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setAdultOk(false);
              setPermissionOk(false);
              setConsentOpen(true);
            }}
            className={cn(tile, "border-dashed text-muted-foreground hover:bg-accent")}
          >
            {busy === "model" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            {busy === "model" ? t.uploading : t.uploadModel}
          </button>
          <button type="button" onClick={() => setModelId("")} className={cn(tile, "text-muted-foreground", !modelId && "ring-2 ring-ring")}>
            <UserRound className="h-5 w-5" />
            <span className="px-1">{t.keepPerson}</span>
          </button>
          {allModels.map((m) => (
            <button key={m.id} type="button" onClick={() => setModelId(m.id)} className={cn(tile, m.id === modelId && "ring-2 ring-ring")} title={m.name}>
              {m.thumb ? <img src={m.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-1 text-[11px] text-white">{m.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="text-sm font-medium">{t.references}</p>
        <p className="mb-2 text-xs text-muted-foreground">{t.referencesHint}</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {scenes.map((s) => (
            <div key={s.key} className={cn(tile, s.error && "border-destructive/50")}>
              <img src={s.preview} alt="" className={cn("absolute inset-0 h-full w-full object-cover", !s.path && "opacity-50")} />
              {!s.path && !s.error && <Loader2 className="relative h-5 w-5 animate-spin text-white" />}
              {s.error && <span className="relative bg-black/70 p-1 text-[10px] text-red-300">{s.error}</span>}
              <button
                type="button"
                aria-label={t.removeReference}
                onClick={() => {
                  URL.revokeObjectURL(s.preview);
                  setScenes((all) => all.filter((x) => x.key !== s.key));
                }}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {scenes.length < MAX_REPLICA_SCENES && (
            <button type="button" onClick={() => sceneInput.current?.click()} className={cn(tile, "border-dashed text-muted-foreground hover:bg-accent")}>
              <Plus className="h-5 w-5" />
              {t.addReference}
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={1000} rows={2} placeholder={t.instructions} aria-label={t.instructions} />
        <NativeSelect aria-label={d.create.quality} value={quality} onChange={(e) => setQuality(e.target.value as OutputQuality)}>
          {OUTPUT_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {d.create.qualities[q]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={d.create.engine} value={engine} onChange={(e) => setEngine(e.target.value as ImageEngine)}>
          {IMAGE_ENGINES.map((e) => (
            <option key={e} value={e}>
              {d.create.engines[e]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {(error || notice || blocking) && (
        <p className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : "status"}>
          {error ?? notice ?? blocking}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending || uploadingScenes || busy !== null || Boolean(blocking)}
        className="flow-gradient flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-8"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
        {fmt(t.generate, { n: readyScenes.length })}
      </button>

      <input
        ref={productInput}
        type="file"
        multiple
        accept={IMAGE_MIME_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label={t.uploadProduct}
        onChange={async (e) => {
          const input = e.currentTarget;
          const { files, unreadable } = await snapshotFiles(input.files);
          input.value = "";
          if (unreadable) setError(d.uploader.unreadable);
          if (files.length) void addProduct(files);
        }}
      />
      <input
        ref={modelInput}
        type="file"
        accept={IMAGE_MIME_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label={t.uploadModel}
        onChange={async (e) => {
          const input = e.currentTarget;
          const { files, unreadable } = await snapshotFiles(input.files);
          input.value = "";
          if (unreadable) setError(d.uploader.unreadable);
          if (files[0]) void addModel(files[0]);
        }}
      />
      <input
        ref={sceneInput}
        type="file"
        multiple
        accept={IMAGE_MIME_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label={t.addReference}
        onChange={async (e) => {
          const input = e.currentTarget;
          const { files, unreadable } = await snapshotFiles(input.files);
          input.value = "";
          if (unreadable) setError(d.uploader.unreadable);
          if (files.length) void addScenes(files);
        }}
      />

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="max-w-md" closeLabel={d.common.cancel}>
          <DialogTitle>{d.create.consentTitle}</DialogTitle>
          <DialogDescription>{d.create.consentBody}</DialogDescription>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={adultOk} onChange={(e) => setAdultOk(e.target.checked)} />
            {d.create.consentAdult}
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={permissionOk} onChange={(e) => setPermissionOk(e.target.checked)} />
            {d.create.consentPermission}
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConsentOpen(false)}>
              {d.common.cancel}
            </Button>
            <Button
              type="button"
              disabled={!adultOk || !permissionOk}
              onClick={() => {
                setConsentOpen(false);
                modelInput.current?.click();
              }}
            >
              <ImagePlus /> {d.create.consentContinue}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
