"use client";
import { useRef } from "react";
import { switchOrganization } from "@/server/actions/auth";
import { NativeSelect } from "@/components/ui/native-select";
import { useI18n } from "@/lib/i18n/client";
import type { OrgRole } from "@/lib/domain/schemas";

export function OrgSwitcher({
  memberships,
  activeId,
}: {
  memberships: { organizationId: string; organizationName: string; role: OrgRole }[];
  activeId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { d } = useI18n();
  if (memberships.length <= 1) {
    const m = memberships[0];
    return (
      <div className="px-1 text-sm">
        <p className="font-medium">{m?.organizationName}</p>
        <p className="text-xs capitalize text-muted-foreground">{m ? d.enums.role[m.role] : null}</p>
      </div>
    );
  }
  return (
    <form ref={formRef} action={switchOrganization}>
      <label htmlFor="org-switch" className="sr-only">
        {d.common.organization}
      </label>
      <NativeSelect
        id="org-switch"
        name="organizationId"
        defaultValue={activeId}
        onChange={() => formRef.current?.requestSubmit()}
      >
        {memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.organizationName} ({d.enums.role[m.role]})
          </option>
        ))}
      </NativeSelect>
    </form>
  );
}
