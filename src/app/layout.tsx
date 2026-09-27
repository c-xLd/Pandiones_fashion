import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return {
    title: { default: d.meta.appName, template: `%s · ${d.meta.appName}` },
    description: d.meta.description,
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, d } = await getI18n();
  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-screen font-sans">
        <I18nProvider locale={locale} d={d}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
