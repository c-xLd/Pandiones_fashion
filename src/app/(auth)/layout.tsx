import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/studio/language-switcher";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { d } = await getI18n();
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Soft accent glow behind the form. */}
      <div className="flow-gradient pointer-events-none absolute left-1/2 top-1/3 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-[120px]" aria-hidden />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flow-gradient mb-4 h-10 w-10 rounded-xl" aria-hidden />
          <p lang="en" className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">{d.common.brand}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{d.auth.title}</h1>
        </div>
        {children}
        <LanguageSwitcher className="mx-auto mt-4 w-40" />
      </div>
    </main>
  );
}
