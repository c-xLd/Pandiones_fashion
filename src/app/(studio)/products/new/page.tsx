import { requirePageContext } from "@/server/context";
import { createProduct } from "@/server/actions/products";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { ProductForm } from "../product-form";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  await requirePageContext("editor");
  return (
    <>
      <PageHeader title="New product" description="You can upload reference images after the product is created." />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <ProductForm action={createProduct} />
        </CardContent>
      </Card>
    </>
  );
}
