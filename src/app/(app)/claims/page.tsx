import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { claimFiltersSchema } from "@/lib/domain/schemas";
import { CLAIM_STATUSES } from "@/lib/domain/constants";
import { getClaimsPage, PAGE_SIZE } from "@/lib/kpi/queries";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ClaimFilters } from "@/components/claims/filters";
import { ClaimsTable } from "@/components/claims/claims-table";
import { Pagination } from "@/components/claims/pagination";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Claims" };

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const filters = claimFiltersSchema.parse(raw);
  const list = await getClaimsPage(filters);
  const tabHref = (status?: string) => {
    const sp = new URLSearchParams(Object.entries(raw).filter((e): e is [string, string] => !!e[1] && e[0] !== "page" && e[0] !== "status"));
    if (status) sp.set("status", status);
    const s = sp.toString();
    return `/claims${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Claims queue"
        subtitle={`${list.total} claim(s) · ${list.period.label}`}
        actions={
          <Link href="/claims/new" className={buttonVariants({ variant: "navy" })}>
            <Plus className="h-4 w-4" aria-hidden /> New Claim
          </Link>
        }
      />
      <nav aria-label="Status" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {[undefined, ...CLAIM_STATUSES].map((s) => {
          const active = filters.status === s;
          return (
            <Link
              key={s ?? "all"}
              href={tabHref(s)}
              aria-current={active ? "page" : undefined}
              className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap", active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
            >
              {s ?? "All"}
            </Link>
          );
        })}
      </nav>
      <Card className="mb-4 p-4">
        <Suspense>
          <ClaimFilters showStatus={false} />
        </Suspense>
      </Card>
      <Card>
        <ClaimsTable rows={list.rows} />
        <Pagination basePath="/claims" params={raw} page={list.page} pageCount={list.pageCount} total={list.total} pageSize={PAGE_SIZE} />
      </Card>
    </>
  );
}
