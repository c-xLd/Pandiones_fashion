import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/studio/language-switcher";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { d } = await getI18n();
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">{d.common.brand}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{d.auth.title}</h1>
        </div>
        {children}
        <LanguageSwitcher className="mx-auto mt-4 w-40" />
      </div>
    </main>
  );
}
