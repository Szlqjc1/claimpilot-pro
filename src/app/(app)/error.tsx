"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="flex flex-col items-start gap-3 py-8">
        <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
        <h1 className="text-lg font-semibold">Something went wrong loading this page</h1>
        <p className="text-[13px] text-muted">No data was changed. {error.digest && <span className="font-mono">Ref {error.digest}</span>}</p>
        <Button variant="navy" onClick={reset}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}
