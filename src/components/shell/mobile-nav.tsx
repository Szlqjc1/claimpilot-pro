"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { Brand, NavLinks, SidebarFooter } from "./nav";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label="Open navigation" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line lg:hidden">
          <Menu className="h-4 w-4" aria-hidden />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-navy-950">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">Main navigation</Dialog.Description>
          <div className="flex items-center justify-between pr-3">
            <Brand />
            <Dialog.Close aria-label="Close navigation" className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-navy-900">
              <X className="h-4 w-4" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="flex-1 py-2">
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
          <SidebarFooter />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
