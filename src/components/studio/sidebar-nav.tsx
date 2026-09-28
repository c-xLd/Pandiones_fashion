"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Copy,
  Sparkles,
  Shirt,
  UserRound,
  SlidersHorizontal,
  Camera,
  ClipboardCheck,
  ListChecks,
  Clapperboard,
  Images,
  Wallet,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type NavItem = { href: string; key: keyof Dictionary["nav"]; icon: typeof Shirt };

/** Always visible in the top bar on large screens. */
export const NAV_PRIMARY: NavItem[] = [
  { href: "/", key: "create", icon: Sparkles },
  { href: "/replica", key: "replica", icon: Copy },
  { href: "/products", key: "products", icon: Shirt },
  { href: "/models", key: "models", icon: UserRound },
  { href: "/review", key: "review", icon: ClipboardCheck },
  { href: "/video", key: "video", icon: Clapperboard },
  { href: "/library", key: "library", icon: Images },
];

/** Reachable from the menu panel. */
export const NAV_SECONDARY: NavItem[] = [
  { href: "/shoots/new", key: "newShoot", icon: Camera },
  { href: "/presets", key: "presets", icon: SlidersHorizontal },
  { href: "/jobs", key: "jobs", icon: ListChecks },
  { href: "/costs", key: "costs", icon: Wallet },
  { href: "/settings", key: "settings", icon: Settings },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Horizontal pill navigation for the top bar. */
export function TopNav() {
  const pathname = usePathname();
  const { d } = useI18n();
  return (
    <nav className="hidden items-center gap-1 rounded-full border bg-card/60 p-1 lg:flex" aria-label={d.common.mainNav}>
      {NAV_PRIMARY.map(({ href, key, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {d.nav[key]}
          </Link>
        );
      })}
    </nav>
  );
}

/** Full vertical navigation used inside the menu panel. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { d } = useI18n();
  return (
    <nav className="grid grid-cols-2 gap-1.5" aria-label={d.common.mainNav}>
      {[...NAV_PRIMARY, ...NAV_SECONDARY].map(({ href, key, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors",
              active ? "border-transparent bg-primary text-primary-foreground" : "bg-card/60 text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{d.nav[key]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
