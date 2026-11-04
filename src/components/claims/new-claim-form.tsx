"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { CATEGORIES } from "@/lib/domain/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function NewClaimForm({ claimant, projects, vendors }: { claimant: { name: string; department: string }; projects: { code: string; name: string }[]; vendors: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="max-w-3xl">
      <CardContent className="py-5">
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const res = await fetch("/api/claims", { method: "POST", body: new FormData(e.currentTarget) });
              const body = (await res.json()) as { claimId?: string; error?: { message: string } };
              if (!res.ok || !body.claimId) throw new Error(body.error?.message ?? `Upload failed (${res.status})`);
              toast.success(`Claim ${body.claimId} created`);
              router.push(`/claims/${body.claimId}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Upload failed");
              setBusy(false);
            }
          }}
        >
          {/* Read-only: the server takes the claimant from the session, not from the form. */}
          <div>
            <p className="mb-1 block text-xs font-medium text-muted">Employee</p>
            <p className="flex h-9 items-center rounded-lg border border-line bg-slate-50 px-3 text-sm" aria-label={`Employee: ${claimant.name} (signed-in user)`}>
              {claimant.name}
            </p>
          </div>
          <div>
            <p className="mb-1 block text-xs font-medium text-muted">Department</p>
            <p className="flex h-9 items-center rounded-lg border border-line bg-slate-50 px-3 text-sm">{claimant.department}</p>
          </div>
          <div>
            <Label htmlFor="n-cat">Category</Label>
            <Select id="n-cat" name="category" required>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="n-proj">Project code</Label>
            <Select id="n-proj" name="projectCode">
              <option value="">— none —</option>
              {projects.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} · {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="n-vendor">Vendor</Label>
            <Input id="n-vendor" name="vendorName" list="vendor-list" required minLength={2} />
            <datalist id="vendor-list">
              {vendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="n-amount">Amount (USD)</Label>
            <Input id="n-amount" name="amount" inputMode="decimal" pattern="\d{1,9}(\.\d{1,2})?" placeholder="1234.56" required />
          </div>
          <div>
            <Label htmlFor="n-inv">Invoice number</Label>
            <Input id="n-inv" name="invoiceNumber" />
          </div>
          <div>
            <Label htmlFor="n-po">PO number</Label>
            <Input id="n-po" name="poNumber" inputMode="numeric" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="n-file">Receipt</Label>
            <Input id="n-file" name="receipt" type="file" accept="image/png,image/jpeg,application/pdf" required className="h-auto py-1.5" />
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-danger sm:col-span-2">
              {error}
            </p>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
              Submit claim
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
