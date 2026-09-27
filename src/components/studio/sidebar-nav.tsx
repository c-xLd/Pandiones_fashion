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

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Shirt },
  { href: "/models", label: "Models", icon: UserRound },
  { href: "/presets", label: "Shoot presets", icon: SlidersHorizontal },
  { href: "/shoots/new", label: "New shoot", icon: Camera },
  { href: "/review", label: "Review", icon: ClipboardCheck },
  { href: "/jobs", label: "Jobs", icon: ListChecks },
  { href: "/video", label: "Video studio", icon: Clapperboard },
  { href: "/library", label: "Media library", icon: Images },
  { href: "/costs", label: "Costs & usage", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => {
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
