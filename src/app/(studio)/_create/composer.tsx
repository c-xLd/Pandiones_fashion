"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ArrowUp, Check, ChevronDown, Loader2, Plus, Ratio, Shirt, SlidersHorizontal, UserRound, Camera, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { SHOT_TYPES, IMAGE_ASPECT_RATIOS, shootStyleSchema, type ShotType, type ShootStyle, type ImageAspectRatio } from "@/lib/domain/schemas";
import { createShoot } from "@/server/actions/generation";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";

export interface ComposerProps {
  products: { id: string; sku: string; title: string; thumb: string | null; assetIds: string[] }[];
  models: { id: string; name: string; thumb: string | null; primaryAssetIds: string[] }[];
  presets: { id: string; name: string; category: string; config: Partial<ShootStyle> }[];
  maxReferences: number;
  disabledReason: string | null;
}

const OUTPUT_COUNTS = [1, 2, 3, 4] as const;
const MAX_PRODUCT_REFS = 4;

/** Flow-style prompt bar: pick ingredients (product, model, look), describe the scene, generate. */
export function Composer({ products, models, presets, maxReferences, disabledReason }: ComposerProps) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.create;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const firstUsable = products.find((p) => p.assetIds.length > 0);
  const [productId, setProductId] = useState(firstUsable?.id ?? "");
  const [modelId, setModelId] = useState("");
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const preset = presets.find((p) => p.id === presetId);
  const [shotType, setShotType] = useState<ShotType>((preset?.config.shotType as ShotType) ?? "front");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>((preset?.config.aspectRatio as ImageAspectRatio) ?? "3:4");
  const [count, setCount] = useState<number>(Math.min(4, Math.max(1, Number(preset?.config.variations ?? 2))));
  const [prompt, setPrompt] = useState("");

  const product = products.find((p) => p.id === productId);
  const model = models.find((m) => m.id === modelId);

  const blocking = useMemo(() => {
    if (disabledReason) return disabledReason;
    if (!product || product.assetIds.length === 0) return t.needProduct;
    return null;
  }, [disabledReason, product, t]);

  function choosePreset(id: string) {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p?.config.shotType) setShotType(p.config.shotType as ShotType);
    if (p?.config.aspectRatio) setAspectRatio(p.config.aspectRatio as ImageAspectRatio);
    if (p?.config.variations) setCount(Math.min(4, Math.max(1, Number(p.config.variations))));
  }

  function submit() {
    if (blocking || pending || !product) return;
    setError(null);
    setNotice(null);
    const modelRefs = model ? model.primaryAssetIds.slice(0, 1) : [];
    const productRefs = product.assetIds.slice(0, Math.max(1, Math.min(MAX_PRODUCT_REFS, maxReferences - modelRefs.length)));
    const c = preset?.config ?? {};
    const style = shootStyleSchema.omit({ shotType: true }).safeParse({
      pose: c.pose ?? "",
      cameraAngle: c.cameraAngle ?? "",
      framing: c.framing ?? "full_body",
      background: c.background ?? "",
      lighting: c.lighting ?? "",
      aspectRatio,
      imageSize: c.imageSize ?? "1K",
      variations: count,
      creativeInstructions: [c.creativeInstructions, prompt.trim()].filter(Boolean).join("\n").slice(0, 2000),
    });
    if (!style.success) return setError(d.shoot.invalidSettings);
    start(async () => {
      const res = await createShoot({
        productId: product.id,
        modelProfileId: model?.id ?? null,
        presetId: presetId || null,
        productReferenceAssetIds: productRefs,
        modelReferenceAssetIds: modelRefs,
        shotTypes: [shotType],
        style: style.data,
        idempotencyKey,
      });
      if (!res.ok) return setError(res.error);
      setNotice(fmt(t.queuedNotice, { n: res.data.jobCount }));
      setPrompt("");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    });
  }

  const categoryLabel = (c: string) => (d.enums.presetCategory as Record<string, string>)[c] ?? c;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-4 sm:pb-5">
      <div className="pointer-events-auto mx-auto max-w-3xl">
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
              icon={<Shirt />}
              label={product ? product.sku : t.chooseProduct}
              thumb={product?.thumb}
              ariaLabel={t.product}
            >
              {products.length === 0 ? (
                <Menu.Item asChild>
                  <Link href="/products/new" className={itemClass}>
                    <Plus className="h-4 w-4" /> {t.addProduct}
                  </Link>
                </Menu.Item>
              ) : (
                products.map((p) => (
                  <Menu.Item
                    key={p.id}
                    className={itemClass}
                    disabled={p.assetIds.length === 0}
                    onSelect={() => setProductId(p.id)}
                  >
                    <Thumb url={p.thumb} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs">{p.sku}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.assetIds.length === 0 ? t.noReferences : p.title}
                      </span>
                    </span>
                    {p.id === productId && <Check className="h-4 w-4" />}
                  </Menu.Item>
                ))
              )}
            </Chooser>

            <Chooser icon={<UserRound />} label={model ? model.name : t.anyModel} thumb={model?.thumb} ariaLabel={t.model}>
              <Menu.Item className={itemClass} onSelect={() => setModelId("")}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <UserRound className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{t.anyModel}</span>
                  <span className="block text-xs text-muted-foreground">{d.shoot.genericModel}</span>
                </span>
                {!modelId && <Check className="h-4 w-4" />}
              </Menu.Item>
              {models.map((m) => (
                <Menu.Item key={m.id} className={itemClass} onSelect={() => setModelId(m.id)}>
                  <Thumb url={m.thumb} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {m.id === modelId && <Check className="h-4 w-4" />}
                </Menu.Item>
              ))}
              <Menu.Item asChild>
                <Link href="/models/new" className={itemClass}>
                  <Plus className="h-4 w-4" /> {d.nav.models}
                </Link>
              </Menu.Item>
            </Chooser>

            <Chooser icon={<SlidersHorizontal />} label={preset ? preset.name : t.customLook} ariaLabel={t.look}>
              <Menu.Item className={itemClass} onSelect={() => setPresetId("")}>
                <span className="flex-1">{t.customLook}</span>
                {!presetId && <Check className="h-4 w-4" />}
              </Menu.Item>
              {presets.map((p) => (
                <Menu.Item key={p.id} className={itemClass} onSelect={() => choosePreset(p.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{categoryLabel(p.category)}</span>
                  </span>
                  {p.id === presetId && <Check className="h-4 w-4" />}
                </Menu.Item>
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
            <Chooser icon={<Camera />} label={d.enums.shotType[shotType]} ariaLabel={t.shot} compact>
              {SHOT_TYPES.map((s) => (
                <Menu.Item key={s} className={itemClass} onSelect={() => setShotType(s)}>
                  <span className="flex-1">{d.enums.shotType[s]}</span>
                  {s === shotType && <Check className="h-4 w-4" />}
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
            <Chooser icon={<Layers />} label={fmt(t.outputsValue, { n: count })} ariaLabel={t.outputs} compact>
              {OUTPUT_COUNTS.map((n) => (
                <Menu.Item key={n} className={itemClass} onSelect={() => setCount(n)}>
                  <span className="flex-1">{fmt(t.outputsValue, { n })}</span>
                  {n === count && <Check className="h-4 w-4" />}
                </Menu.Item>
              ))}
            </Chooser>
            <div className="ml-auto flex items-center gap-2">
              {blocking && <span className="hidden max-w-[16rem] truncate text-xs text-muted-foreground md:inline" title={blocking}>{blocking}</span>}
              <button
                type="submit"
                disabled={pending || Boolean(blocking)}
                aria-label={t.generate}
                title={blocking ?? t.generate}
                className="flow-gradient flex h-10 w-10 items-center justify-center rounded-full text-white shadow-lg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
              </button>
            </div>
          </div>
          {blocking && <p className="px-2 pt-1 text-xs text-muted-foreground md:hidden">{blocking}</p>}
        </form>
      </div>
    </div>
  );
}

const itemClass =
  "flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-accent";

function Thumb({ url }: { url: string | null | undefined }) {
  return url ? <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-lg bg-muted" />;
}

function Chooser({
  icon,
  label,
  thumb,
  ariaLabel,
  compact,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  thumb?: string | null;
  ariaLabel: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label={`${ariaLabel}: ${label}`}
        className={cn(
          "flex max-w-[12rem] items-center gap-1.5 rounded-full border bg-white/[0.04] text-sm transition-colors hover:bg-accent data-[state=open]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0",
          compact ? "h-8 px-2.5 text-xs text-muted-foreground" : "h-9 pl-1 pr-2.5",
          !compact && !thumb && "pl-2.5",
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
          className="z-50 max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-2xl"
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
