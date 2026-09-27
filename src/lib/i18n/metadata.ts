import "server-only";
import type { Metadata } from "next";
import { getI18n } from "./server";
import type { Dictionary } from "./dictionaries";

/** `export const generateMetadata = pageMetadata((d) => d.products.metaTitle);` */
export function pageMetadata(pick: (d: Dictionary) => string) {
  return async (): Promise<Metadata> => ({ title: pick((await getI18n()).d) });
}
