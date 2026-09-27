import { requirePageContext } from "@/server/context";
import { createProduct } from "@/server/actions/products";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { ProductForm } from "../product-form";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata((d) => d.products.newTitle);

export default async function NewProductPage() {
  await requirePageContext("editor");
  const { d } = await getI18n();
  return (
    <>
      <PageHeader title={d.products.newTitle} description={d.products.newDescription} />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <ProductForm action={createProduct} />
        </CardContent>
      </Card>
    </>
  );
}
