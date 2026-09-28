"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Copy, Images, Shirt, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { isActive } from "./sidebar-nav";

const TABS = [
  { href: "/", key: "create", icon: Sparkles },
  { href: "/replica", key: "replica", icon: Copy },
  { href: "/library", key: "library", icon: Images },
  { href: "/products", key: "products", icon: Shirt },
  { href: "/models", key: "models", icon: UserRound },
] as const;

/** App-style bottom navigation on phones and tablets (hidden on desktop). */
export function TabBar({ menu }: { menu: React.ReactNode }) {
  const pathname = usePathname();
  const { d } = useI18n();
  const short: Record<(typeof TABS)[number]["key"], string> = {
    create: d.nav.create,
    replica: d.nav.replica,
    library: d.tabs.library,
    products: d.nav.products,
    models: d.nav.models,
  };
  return (
    <nav
      aria-label={d.common.mainNav}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto grid h-16 max-w-xl grid-cols-6">
        {TABS.map(({ href, key, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex select-none flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors active:scale-95",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-primary text-primary-foreground")}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="max-w-full truncate px-0.5">{short[key]}</span>
            </Link>
          );
        })}
        {menu}
      </div>
    </nav>
  );
}
