import { requirePageContext } from "@/server/context";
import { PageHeader } from "@/components/studio/page-header";
import { BulkImport } from "./bulk-import";

export const metadata = { title: "Bulk import" };

export default async function ImportPage() {
  await requirePageContext("editor");
  return (
    <>
      <PageHeader
        title="Bulk import"
        description={
          <>
            Name files <code>SKU_role.jpg</code> (roles: front, back, side, detail, fabric, other), e.g. <code>PX-1042_back.jpg</code> or{" "}
            <code>PX-1042-detail-2.png</code>. Products that do not exist yet are created as drafts.
          </>
        }
      />
      <BulkImport />
    </>
  );
}
