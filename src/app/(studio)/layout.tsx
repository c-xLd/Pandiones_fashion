import { LogOut } from "lucide-react";
import { requirePageContext } from "@/server/context";
import { signOut } from "@/server/actions/auth";
import { SidebarNav } from "@/components/studio/sidebar-nav";
import { MobileNav } from "@/components/studio/mobile-nav";
import { OrgSwitcher } from "@/components/studio/org-switcher";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card p-4 lg:flex">
        <div className="mb-6 px-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-brand">Pandiones</p>
          <p className="text-lg font-semibold tracking-tight">Fashion Studio</p>
        </div>
        <SidebarNav />
        <div className="mt-auto space-y-3 border-t pt-4">
          <OrgSwitcher memberships={ctx.memberships} activeId={ctx.org.organizationId} />
          <form action={signOut} className="flex items-center justify-between gap-2 px-1">
            <span className="truncate text-xs text-muted-foreground" title={ctx.email ?? undefined}>
              {ctx.email}
            </span>
            <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
              <LogOut />
            </Button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b bg-card px-4 py-3 lg:hidden">
          <MobileNav />
          <p className="font-semibold">Pandiones Studio</p>
          <form action={signOut} className="ml-auto">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
