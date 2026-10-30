import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export default function ClaimNotFound() {
  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="py-8">
        <h1 className="text-lg font-semibold">Claim not found</h1>
        <p className="mt-1 text-[13px] text-muted">Check the claim ID, or return to the queue.</p>
        <Link href="/claims" className="mt-4 inline-block text-[13px] font-medium text-info hover:underline">
          ← Back to claims
        </Link>
      </CardContent>
    </Card>
  );
}
