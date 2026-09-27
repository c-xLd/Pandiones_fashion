"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function StudioError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg space-y-3 rounded-xl border p-6 text-center">
      <h2 className="text-lg font-semibold">This page could not be loaded</h2>
      <p className="text-sm text-muted-foreground">
        An unexpected error occurred. {error.digest ? `Reference: ${error.digest}` : ""}
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
