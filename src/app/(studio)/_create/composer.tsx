"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ArrowUp, Check, ChevronDown, Dices, ImagePlus, Layers, Loader2, MapPin, Ratio, RefreshCw, Shirt, Sparkles, Upload, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "@/lib/domain/schemas";
import { SESSION_LOCATIONS, SESSION_SHOT_COUNTS, MAX_SESSION_LOCATIONS, type SessionLocation } from "@/lib/domain/photo-session";
import { IMAGE_MIME_TYPES, validateDeclaredImage } from "@/lib/domain/files";
import { createPhotoSession } from "@/server/actions/generation";
import { discardEmptyProduct, quickCreateProduct } from "@/server/actions/products";
import { castRandomModel, discardCastModel, discardEmptyModel, quickCreateModel } from "@/server/actions/models";
import { uploadFile } from "@/components/studio/upload-client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";

export interface ComposerProps {
  products: { id: string; sku: string; title: string; thumb: string | null; hasAssets: boolean }[];
  models: { id: string; name: string; thumb: string | null }[];
  disabledReason: string | null;
  /** Preselected after adding a product/model (e.g. from /products/new). */
  initialProductId?: string;
  initialModelId?: string;
}

const MAX_GARMENT_FILES = 4;
/** Poll for a cast model's portrait; give up after this long. */
const CAST_POLL_MS = 4_000;
const CAST_TIMEOUT_MS = 4 * 60_000;
const DEFAULT_LOCATIONS: SessionLocation[] = ["studio_white", "city_street"];

type LocalProduct = ComposerProps["products"][number];
type LocalModel = ComposerProps["models"][number];

/** Flow-style shoot bar: garment + model + locations → a varied photo session. */
export function Composer({ products, models, disabledReason, initialProductId, initialModelId }: ComposerProps) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.create;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // Items uploaded in this session show immediately, before the server refresh lands.
  const [localProducts, setLocalProducts] = useState<LocalProduct[]>([]);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const allProducts = useMemo(() => [...localProducts.filter((l) => !products.some((p) => p.id === l.id)), ...products], [localProducts, products]);
  const allModels = useMemo(() => [...localModels.filter((l) => !models.some((m) => m.id === l.id)), ...models], [localModels, models]);

  const [productId, setProductId] = useState(
    (products.find((p) => p.id === initialProductId && p.hasAssets) ?? products.find((p) => p.hasAssets))?.id ?? "",
  );
  const [modelId, setModelId] = useState(models.some((m) => m.id === initialModelId) ? (initialModelId as string) : ""); // "" = random model
  const [locations, setLocations] = useState<SessionLocation[]>(DEFAULT_LOCATIONS);
  const [count, setCount] = useState<number>(6);
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("3:4");
  const [prompt, setPrompt] = useState("");
  const [quality, setQuality] = useState<"2K" | "4K">("2K");
  // Casting: a new random model whose portrait is being generated / previewed.
  const [casting, setCasting] = useState<{ modelId: string; startedAt: number; dismissed: boolean } | null>(null);
  const [castBusy, setCastBusy] = useState(false);
  const [uploading, setUploading] = useState<"garment" | "model" | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [adultOk, setAdultOk] = useState(false);
  const [permissionOk, setPermissionOk] = useState(false);

  const garmentInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);

  const product = allProducts.find((p) => p.id === productId);
  const model = allModels.find((m) => m.id === modelId);

  const castModel = casting ? models.find((m) => m.id === casting.modelId) : undefined;
  const castReady = Boolean(castModel?.thumb);
  const castWaiting = Boolean(casting && !castReady);

  // Refresh server data until the cast portrait arrives (or give up).
  useEffect(() => {
    if (!casting || castReady) return;
    const id = setInterval(() => {
      if (Date.now() - casting.startedAt > CAST_TIMEOUT_MS) {
        setCasting(null);
        setModelId("");
        setError(t.castFailed);
        return;
      }
      router.refresh();
    }, CAST_POLL_MS);
    return () => clearInterval(id);
  }, [casting, castReady, router, t.castFailed]);

  async function cast(replace?: string) {
    setError(null);
    setNotice(null);
    setCastBusy(true);
    try {
      if (replace) await discardCastModel(replace);
      const res = await castRandomModel({ idempotencyKey: crypto.randomUUID() });
      if (!res.ok) return setError(res.error);
      setLocalModels((prev) => [{ id: res.data.modelId, name: res.data.name, thumb: null }, ...prev.filter((m) => m.id !== replace)]);
      setModelId(res.data.modelId);
      setCasting({ modelId: res.data.modelId, startedAt: Date.now(), dismissed: false });
      router.refresh();
    } finally {
      setCastBusy(false);
    }
  }

  const blocking = useMemo(() => {
    if (disabledReason) return disabledReason;
    if (castWaiting && modelId === casting?.modelId) return t.waitCasting;
    if (!product || !product.hasAssets) return t.needGarment;
    if (!locations.length) return t.needLocation;
    return null;
  }, [disabledReason, product, locations.length, t, castWaiting, modelId, casting?.modelId]);

  const locationName = (l: SessionLocation) => t.locationNames[l];
  const uploadError = d.uploader.uploadFailed;

  function checkFile(file: File): string | null {
    const res = validateDeclaredImage({ name: file.name, size: file.size, type: file.type });
    return res.ok ? null : fmt(d.errors[res.error], res.vars);
  }

  async function uploadGarment(files: File[]) {
    const list = files.slice(0, MAX_GARMENT_FILES);
    const invalid = list.map(checkFile).find(Boolean);
    if (invalid) return setError(invalid);
    setError(null);
    setNotice(null);
    setUploading("garment");
    try {
      const title = (list[0]?.name ?? "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 80);
      const created = await quickCreateProduct({ title: title || undefined });
      if (!created.ok) return setError(created.error);
      let uploaded = 0;
      for (const [i, file] of list.entries()) {
        const res = await uploadFile("products", created.data.id, file, i === 0 ? "front" : "other", undefined, uploadError, d.uploader.unreadable);
        if (res.ok) uploaded++;
        else setError(res.error);
      }
      if (!uploaded) {
        await discardEmptyProduct(created.data.id);
        return;
      }
      setLocalProducts((prev) => [
        { id: created.data.id, sku: created.data.sku, title: title || t.newGarment, thumb: list[0] ? URL.createObjectURL(list[0]) : null, hasAssets: uploaded > 0 },
        ...prev,
      ]);
      setProductId(created.data.id);
      router.refresh();
    } finally {
      setUploading(null);
    }
  }

  async function uploadModel(file: File) {
    const invalid = checkFile(file);
    if (invalid) return setError(invalid);
    setError(null);
    setNotice(null);
    setUploading("model");
    try {
      const created = await quickCreateModel({ adultConfirmed: true, consentConfirmed: true });
      if (!created.ok) return setError(created.error);
      const res = await uploadFile("models", created.data.id, file, "other", undefined, uploadError, d.uploader.unreadable);
      if (!res.ok) {
        await discardEmptyModel(created.data.id);
        return setError(res.error);
      }
      setLocalModels((prev) => [{ id: created.data.id, name: created.data.name, thumb: URL.createObjectURL(file) }, ...prev]);
      setModelId(created.data.id);
      router.refresh();
    } finally {
      setUploading(null);
    }
  }

  function toggleLocation(l: SessionLocation) {
    setLocations((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : prev.length >= MAX_SESSION_LOCATIONS ? prev : [...prev, l]));
  }

  function submit() {
    if (blocking || pending || uploading || !product) return;
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await createPhotoSession({
        productId: product.id,
        modelProfileId: model?.id ?? null,
        randomModel: !model,
        locations,
        count,
        aspectRatio,
        imageSize: quality,
        instructions: prompt.trim(),
        idempotencyKey,
      });
      if (!res.ok) return setError(res.error);
      setNotice(fmt(t.sessionQueued, { n: res.data.jobCount }));
      setPrompt("");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    });
  }

  const locationsLabel = locations.length === 1 ? locationName(locations[0] as SessionLocation) : fmt(t.locationsValue, { n: locations.length });

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-4 sm:pb-5">
      <div className="pointer-events-auto mx-auto max-w-3xl">
        {casting && !casting.dismissed && (
          <div className="mb-2 flex items-center gap-3 rounded-3xl border bg-card/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl">
            {castReady && castModel?.thumb ? (
              <img src={castModel.thumb} alt={castModel.name} className="flow-drop h-40 w-30 shrink-0 rounded-2xl object-cover sm:h-48 sm:w-36" />
            ) : (
              <div className="flow-shimmer flex h-40 w-30 shrink-0 items-center justify-center rounded-2xl border sm:h-48 sm:w-36">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-medium">{castReady ? t.castReady : t.casting}</p>
              <p className="text-xs text-muted-foreground">{castReady ? castModel?.name : t.castHint}</p>
              {castReady && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setCasting((c) => (c ? { ...c, dismissed: true } : c))}>
                    <Check /> {t.useThisModel}
                  </Button>
                  <Button size="sm" variant="outline" disabled={castBusy} onClick={() => void cast(casting.modelId)}>
                    {castBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t.anotherModel}
                  </Button>
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label={d.common.cancel}
              onClick={() => setCasting((c) => (c ? { ...c, dismissed: true } : c))}
              className="self-start rounded-full p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {(notice || error) && (
          <p
            role={error ? "alert" : "status"}
            className={cn(
              "mx-auto mb-2 w-fit max-w-full rounded-full border px-4 py-1.5 text-center text-xs backdrop-blur",
              error ? "border-destructive/40 bg-destructive/15 text-destructive" : "bg-card/90 text-muted-foreground",
            )}
          >
            {error ?? notice}
          </p>
        )}
        <form
          className="rounded-3xl border bg-card/90 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Chooser
              icon={uploading === "garment" ? <Loader2 className="animate-spin" /> : <Shirt />}
              label={uploading === "garment" ? t.uploading : product ? product.title || product.sku : t.chooseGarment}
              thumb={uploading === "garment" ? null : product?.thumb}
              ariaLabel={t.garment}
              disabled={uploading !== null}
            >
              <Menu.Item className={itemClass} onSelect={() => garmentInput.current?.click()}>
                <span className="flow-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white">
                  <Upload className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{t.uploadGarment}</span>
                  <span className="block text-xs text-muted-foreground">{t.uploadGarmentHint}</span>
                </span>
              </Menu.Item>
              {allProducts.length > 0 && <Menu.Separator className="my-1 h-px bg-border" />}
              {allProducts.map((p) => (
                <Menu.Item key={p.id} className={itemClass} disabled={!p.hasAssets} onSelect={() => setProductId(p.id)}>
                  <Thumb url={p.thumb} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.title}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.hasAssets ? p.sku : t.noReferences}</span>
                  </span>
                  {p.id === productId && <Check className="h-4 w-4" />}
                </Menu.Item>
              ))}
            </Chooser>

            <Chooser
              icon={uploading === "model" || castWaiting ? <Loader2 className="animate-spin" /> : model ? <UserRound /> : <Dices />}
              label={uploading === "model" ? t.uploading : castWaiting && modelId === casting?.modelId ? t.casting : model ? model.name : t.randomModel}
              thumb={uploading === "model" ? null : model?.thumb}
              ariaLabel={t.model}
              disabled={uploading !== null}
            >
              <Menu.Item className={itemClass} disabled={castBusy || Boolean(disabledReason)} onSelect={() => void cast()}>
                <span className="flow-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white">
                  {castBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{t.castModel}</span>
                  <span className="block text-xs text-muted-foreground">{t.castModelHint}</span>
                </span>
              </Menu.Item>
              <Menu.Item className={itemClass} onSelect={() => setModelId("")}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Dices className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{t.randomModel}</span>
                  <span className="block text-xs text-muted-foreground">{t.randomModelHint}</span>
                </span>
                {!modelId && <Check className="h-4 w-4" />}
              </Menu.Item>
              <Menu.Item
                className={itemClass}
                onSelect={() => {
                  setAdultOk(false);
                  setPermissionOk(false);
                  setConsentOpen(true);
                }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <ImagePlus className="h-4 w-4" />
                </span>
                <span className="flex-1">{t.uploadModel}</span>
              </Menu.Item>
              {allModels.length > 0 && <Menu.Separator className="my-1 h-px bg-border" />}
              {allModels.map((m) => (
                <Menu.Item key={m.id} className={itemClass} onSelect={() => setModelId(m.id)}>
                  <Thumb url={m.thumb} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {m.id === modelId && <Check className="h-4 w-4" />}
                </Menu.Item>
              ))}
            </Chooser>

            <Chooser icon={<MapPin />} label={locations.length ? locationsLabel : t.locations} ariaLabel={t.locations}>
              {SESSION_LOCATIONS.map((l) => (
                <Menu.CheckboxItem
                  key={l}
                  className={itemClass}
                  checked={locations.includes(l)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleLocation(l)}
                >
                  <span className="flex-1">{locationName(l)}</span>
                  <Menu.ItemIndicator>
                    <Check className="h-4 w-4" />
                  </Menu.ItemIndicator>
                </Menu.CheckboxItem>
              ))}
            </Chooser>
          </div>

          <label htmlFor="composer-prompt" className="sr-only">
            {t.promptLabel}
          </label>
          <textarea
            id="composer-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={1500}
            placeholder={t.promptPlaceholder}
            className="mt-2 block max-h-40 min-h-[3.25rem] w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
          />

          <div className="mt-1 flex items-center gap-1.5">
            <Chooser icon={<Layers />} label={fmt(t.photosValue, { n: count })} ariaLabel={t.photos} compact>
              {SESSION_SHOT_COUNTS.map((n) => (
                <Menu.Item key={n} className={itemClass} onSelect={() => setCount(n)}>
                  <span className="flex-1">{fmt(t.photosValue, { n })}</span>
                  {n === count && <Check className="h-4 w-4" />}
                </Menu.Item>
              ))}
            </Chooser>
            <Chooser icon={<Ratio />} label={aspectRatio} ariaLabel={t.aspectRatio} compact>
              {IMAGE_ASPECT_RATIOS.map((r) => (
                <Menu.Item key={r} className={itemClass} onSelect={() => setAspectRatio(r)}>
                  <span className="flex-1">{r}</span>
                  {r === aspectRatio && <Check className="h-4 w-4" />}
                </Menu.Item>
              ))}
            </Chooser>
            <Chooser icon={<Sparkles />} label={quality} ariaLabel={t.quality} compact>
              {(["2K", "4K"] as const).map((q) => (
                <Menu.Item key={q} className={itemClass} onSelect={() => setQuality(q)}>
                  <span className="min-w-0 flex-1">
                    <span className="block">{q}</span>
                    <span className="block text-xs text-muted-foreground">{q === "2K" ? t.quality2kHint : t.quality4kHint}</span>
                  </span>
                  {q === quality && <Check className="h-4 w-4" />}
                </Menu.Item>
              ))}
            </Chooser>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {blocking && (
                <span className="hidden max-w-[14rem] truncate text-xs text-muted-foreground md:inline" title={blocking}>
                  {blocking}
                </span>
              )}
              <button
                type="submit"
                disabled={pending || uploading !== null || Boolean(blocking)}
                title={blocking ?? t.startShoot}
                className="flow-gradient flex h-10 shrink-0 items-center gap-1.5 rounded-full pl-4 pr-3 text-sm font-medium text-white shadow-lg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.startShoot}
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {blocking && <p className="px-2 pt-1 text-xs text-muted-foreground md:hidden">{blocking}</p>}
        </form>

        <input
          ref={garmentInput}
          type="file"
          accept={IMAGE_MIME_TYPES.join(",")}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label={t.uploadGarment}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void uploadGarment(files);
          }}
        />
        <input
          ref={modelInput}
          type="file"
          accept={IMAGE_MIME_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label={t.uploadModel}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void uploadModel(file);
          }}
        />
      </div>

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="pointer-events-auto max-w-md" closeLabel={d.common.cancel}>
          <DialogTitle>{t.consentTitle}</DialogTitle>
          <DialogDescription>{t.consentBody}</DialogDescription>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={adultOk} onChange={(e) => setAdultOk(e.target.checked)} />
            {t.consentAdult}
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={permissionOk} onChange={(e) => setPermissionOk(e.target.checked)} />
            {t.consentPermission}
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
              <ImagePlus /> {t.consentContinue}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const itemClass =
  "relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-accent";

function Thumb({ url }: { url: string | null | undefined }) {
  return url ? <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-lg bg-muted" />;
}

function Chooser({
  icon,
  label,
  thumb,
  ariaLabel,
  compact,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  thumb?: string | null;
  ariaLabel: string;
  compact?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        disabled={disabled}
        aria-label={`${ariaLabel}: ${label}`}
        className={cn(
          "flex max-w-[13rem] items-center gap-1.5 rounded-full border bg-white/[0.04] text-sm transition-colors hover:bg-accent disabled:opacity-60 data-[state=open]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0",
          compact ? "h-8 px-2.5 text-xs text-muted-foreground" : "h-9 pr-2.5",
          !compact && (thumb ? "pl-1" : "pl-2.5"),
        )}
      >
        {thumb ? <img src={thumb} alt="" className="h-7 w-7 rounded-full object-cover" /> : icon}
        <span className="truncate">{label}</span>
        <ChevronDown className="opacity-60" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-2xl"
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
