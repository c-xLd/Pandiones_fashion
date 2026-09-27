"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
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

const NAV: { href: string; key: keyof Dictionary["nav"]; icon: typeof Shirt }[] = [
  { href: "/", key: "dashboard", icon: LayoutDashboard },
  { href: "/products", key: "products", icon: Shirt },
  { href: "/models", key: "models", icon: UserRound },
  { href: "/presets", key: "presets", icon: SlidersHorizontal },
  { href: "/shoots/new", key: "newShoot", icon: Camera },
  { href: "/review", key: "review", icon: ClipboardCheck },
  { href: "/jobs", key: "jobs", icon: ListChecks },
  { href: "/video", key: "video", icon: Clapperboard },
  { href: "/library", key: "library", icon: Images },
  { href: "/costs", key: "costs", icon: Wallet },
  { href: "/settings", key: "settings", icon: Settings },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { d } = useI18n();
  return (
    <nav className="flex flex-col gap-0.5" aria-label={d.common.mainNav}>
      {NAV.map(({ href, key, icon: Icon }) => {
        const label = d.nav[key];
        const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
