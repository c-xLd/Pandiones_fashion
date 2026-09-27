import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { d } = await getI18n();
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold">{d.notFound.title}</h1>
      <p className="text-sm text-muted-foreground">{d.notFound.body}</p>
      <Button asChild>
        <Link href="/">{d.common.backToStudio}</Link>
      </Button>
    </main>
  );
}
