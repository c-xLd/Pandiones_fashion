import type { MetadataRoute } from "next";
import { getI18n } from "@/lib/i18n/server";

/** Web app manifest: installable, full-screen studio on phones (localized). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { locale, d } = await getI18n();
  return {
    name: d.meta.appName,
    short_name: d.common.brand,
    description: d.meta.description,
    lang: locale,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0e0e12",
    theme_color: "#0e0e12",
    categories: ["photo", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
