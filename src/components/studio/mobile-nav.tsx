"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SidebarNav } from "./sidebar-nav";
import { InstallApp } from "./install-app";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Menu with every section plus account controls (passed as children). On
 * phones it opens as a bottom sheet from the tab bar ("tab" variant).
 */
export function MobileNav({ children, variant = "header" }: { children?: React.ReactNode; variant?: "header" | "tab" }) {
  const [open, setOpen] = useState(false);
  const { d } = useI18n();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "tab" ? (
          <button
            type="button"
            aria-label={d.common.openNavigation}
            className="flex select-none flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground active:scale-95"
          >
            <span className="flex h-7 w-12 items-center justify-center rounded-full">
              <Menu className="h-[18px] w-[18px]" />
            </span>
            {d.tabs.menu}
          </button>
        ) : (
          <Button variant="ghost" size="icon" className="rounded-full border bg-card/60" aria-label={d.common.openNavigation}>
            <Menu />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        closeLabel={d.common.cancel}
        className={cn(
          "max-w-md",
          // Bottom sheet on phones.
          "max-lg:bottom-0 max-lg:top-auto max-lg:max-h-[85dvh] max-lg:max-w-none max-lg:translate-y-0 max-lg:rounded-b-none max-lg:rounded-t-3xl max-lg:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-lg:[animation:sheet-up_0.25s_cubic-bezier(0.2,0.8,0.2,1)]",
        )}
      >
        <span aria-hidden className="mx-auto -mt-2 h-1.5 w-10 rounded-full bg-muted lg:hidden" />
        <DialogTitle>{d.create.menu}</DialogTitle>
        <SidebarNav onNavigate={() => setOpen(false)} />
        {children ? <div className="space-y-3 border-t pt-4">{children}</div> : null}
        <InstallApp />
      </DialogContent>
    </Dialog>
  );
}
