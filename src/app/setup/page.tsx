import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { LanguageSwitcher } from "@/components/studio/language-switcher";

export const generateMetadata = pageMetadata((d) => d.setup.metaTitle);
export const dynamic = "force-dynamic";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "BACKGROUND_JOB_SECRET",
  "GEMINI_API_KEY",
  "GEMINI_IMAGE_MODEL",
] as const;

function isSet(name: (typeof REQUIRED)[number]): boolean {
  if (name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") {
    return Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  }
  if (name === "SUPABASE_SECRET_KEY") return Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  return Boolean(process.env[name]);
}

export default async function SetupPage() {
  const { d } = await getI18n();
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">{d.meta.appName}</p>
          <h1 className="text-2xl font-semibold">{d.setup.title}</h1>
        </div>
        <LanguageSwitcher className="w-40" />
      </div>
      <p className="text-sm text-muted-foreground">{d.setup.body}</p>
      <ul className="divide-y rounded-lg border">
        {REQUIRED.map((name) => (
          <li key={name} className="flex items-center justify-between gap-4 p-3 text-sm">
            <div>
              <code className="font-medium">{name}</code>
              <p className="text-muted-foreground">{d.setup.vars[name]}</p>
            </div>
            <span className={isSet(name) ? "text-success" : "text-destructive"}>{isSet(name) ? d.setup.set : d.setup.missing}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
