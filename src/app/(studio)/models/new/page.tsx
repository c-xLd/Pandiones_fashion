import { requirePageContext } from "@/server/context";
import { createModelProfile } from "@/server/actions/models";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { ModelForm } from "../model-form";

export const metadata = { title: "New model" };

export default async function NewModelPage() {
  await requirePageContext("editor");
  return (
    <>
      <PageHeader title="New model profile" description="Add reference images or generate a reference portrait after creating the profile." />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <ModelForm action={createModelProfile} />
        </CardContent>
      </Card>
    </>
  );
}
