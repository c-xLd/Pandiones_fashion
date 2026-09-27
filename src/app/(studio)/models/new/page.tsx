import { requirePageContext } from "@/server/context";
import { createModelProfile } from "@/server/actions/models";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { ModelForm } from "../model-form";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata((d) => d.models.newTitle);

export default async function NewModelPage() {
  await requirePageContext("editor");
  const { d } = await getI18n();
  return (
    <>
      <PageHeader title={d.models.newTitle} description={d.models.newDescription} />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <ModelForm action={createModelProfile} />
        </CardContent>
      </Card>
    </>
  );
}
