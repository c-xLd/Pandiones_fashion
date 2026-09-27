"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SidebarNav } from "./sidebar-nav";
import { LanguageSwitcher } from "./language-switcher";
import { useI18n } from "@/lib/i18n/client";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { d } = useI18n();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="lg:hidden" aria-label={d.common.openNavigation}>
          <Menu />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs" closeLabel={d.common.cancel}>
        <DialogTitle>{d.common.navigation}</DialogTitle>
        <SidebarNav onNavigate={() => setOpen(false)} />
        <LanguageSwitcher />
      </DialogContent>
    </Dialog>
  );
}
