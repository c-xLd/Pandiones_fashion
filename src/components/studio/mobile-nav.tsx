"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SidebarNav } from "./sidebar-nav";
import { useI18n } from "@/lib/i18n/client";

/** Menu panel with every section plus account controls (passed as children). */
export function MobileNav({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { d } = useI18n();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full border bg-card/60" aria-label={d.common.openNavigation}>
          <Menu />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" closeLabel={d.common.cancel}>
        <DialogTitle>{d.create.menu}</DialogTitle>
        <SidebarNav onNavigate={() => setOpen(false)} />
        {children ? <div className="space-y-3 border-t pt-4">{children}</div> : null}
      </DialogContent>
    </Dialog>
  );
}
