export const metadata = { title: "Setup required" };
export const dynamic = "force-dynamic";

const REQUIRED = [
  ["NEXT_PUBLIC_SUPABASE_URL", "Supabase project URL"],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "Supabase publishable key (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)"],
  ["SUPABASE_SECRET_KEY", "Supabase secret key (or legacy SUPABASE_SERVICE_ROLE_KEY) — server only"],
  ["BACKGROUND_JOB_SECRET", "Shared secret for the worker endpoint (32+ chars)"],
  ["GEMINI_API_KEY", "Google Gemini API key — server only"],
  ["GEMINI_IMAGE_MODEL", "Verified image-generation model ID"],
] as const;

function isSet(name: string): boolean {
  if (name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") {
    return Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  }
  if (name === "SUPABASE_SECRET_KEY") return Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  return Boolean(process.env[name]);
}

export default function SetupPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">Pandiones Studio</p>
        <h1 className="text-2xl font-semibold">Setup required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The studio needs server configuration before it can start. Copy <code>.env.example</code> to <code>.env.local</code>,
          fill in the values, apply the database migrations and restart. Full instructions are in <code>docs/SETUP.md</code>.
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {REQUIRED.map(([name, description]) => (
          <li key={name} className="flex items-center justify-between gap-4 p-3 text-sm">
            <div>
              <code className="font-medium">{name}</code>
              <p className="text-muted-foreground">{description}</p>
            </div>
            <span className={isSet(name) ? "text-success" : "text-destructive"}>{isSet(name) ? "set" : "missing"}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
