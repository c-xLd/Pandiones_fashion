export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">Pandiones</p>
          <h1 className="text-2xl font-semibold tracking-tight">AI Fashion Studio</h1>
        </div>
        {children}
      </div>
    </main>
  );
}
