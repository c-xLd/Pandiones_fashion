import { requirePageContext } from "@/server/context";
import { PageHeader } from "@/components/studio/page-header";
import { BulkImport } from "./bulk-import";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata((d) => d.bulkImport.metaTitle);

export default async function ImportPage() {
  await requirePageContext("editor");
  const { d } = await getI18n();
  return (
    <>
      <PageHeader title={d.bulkImport.title} description={d.bulkImport.description} />
      <BulkImport />
    </>
  );
}
