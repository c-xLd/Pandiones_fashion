import { requirePageContext } from "@/server/context";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { QuickAddForm } from "@/components/studio/quick-add-form";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata((d) => d.quickAdd.modelTitle);

export default async function NewModelPage() {
  await requirePageContext("editor");
  const { d } = await getI18n();
  return (
    <>
      <PageHeader title={d.quickAdd.modelTitle} description={d.quickAdd.modelBody} />
      <Card className="max-w-2xl">
        <CardContent className="pt-5">
          <QuickAddForm kind="model" />
        </CardContent>
      </Card>
    </>
  );
}
