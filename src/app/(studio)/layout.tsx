import Link from "next/link";
import { LogOut } from "lucide-react";
import { requirePageContext } from "@/server/context";
import { signOut } from "@/server/actions/auth";
import { TopNav } from "@/components/studio/sidebar-nav";
import { MobileNav } from "@/components/studio/mobile-nav";
import { OrgSwitcher } from "@/components/studio/org-switcher";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/studio/language-switcher";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const { d } = await getI18n();
  const initial = (ctx.email ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-transparent bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-4 md:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label={d.meta.appName}>
            <span className="flow-gradient h-7 w-7 rounded-lg" aria-hidden />
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight">{d.common.brand}</span>
              <span className="block text-[11px] text-muted-foreground">{d.common.studio}</span>
            </span>
          </Link>
          <div className="flex flex-1 justify-center">
            <TopNav />
          </div>
          <MobileNav>
            <OrgSwitcher memberships={ctx.memberships} activeId={ctx.org.organizationId} />
            <LanguageSwitcher />
            <form action={signOut} className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground" title={ctx.email ?? undefined}>
                {ctx.email}
              </span>
              <Button type="submit" variant="outline" size="sm">
                <LogOut /> {d.common.signOut}
              </Button>
            </form>
          </MobileNav>
          <span
            className="hidden h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-medium sm:flex"
            title={`${ctx.email ?? ""} · ${ctx.org.organizationName}`}
            aria-hidden
          >
            {initial}
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-10 pt-4 md:px-8">{children}</main>
    </div>
  );
}
