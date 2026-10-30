import { Brand, NavLinks, SidebarFooter } from "./nav";

export function Sidebar() {
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col bg-navy-950 lg:flex">
      <Brand />
      <div className="flex-1 overflow-y-auto py-2">
        <NavLinks />
      </div>
      <SidebarFooter />
    </aside>
  );
}
