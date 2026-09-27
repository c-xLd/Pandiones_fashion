import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">The item does not exist or belongs to another organization.</p>
      <Button asChild>
        <Link href="/">Back to studio</Link>
      </Button>
    </main>
  );
}
