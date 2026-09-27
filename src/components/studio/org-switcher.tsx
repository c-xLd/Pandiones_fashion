"use client";
import { useRef } from "react";
import { switchOrganization } from "@/server/actions/auth";
import { NativeSelect } from "@/components/ui/native-select";

export function OrgSwitcher({
  memberships,
  activeId,
}: {
  memberships: { organizationId: string; organizationName: string; role: string }[];
  activeId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  if (memberships.length <= 1) {
    const m = memberships[0];
    return (
      <div className="px-1 text-sm">
        <p className="font-medium">{m?.organizationName}</p>
        <p className="text-xs capitalize text-muted-foreground">{m?.role}</p>
      </div>
    );
  }
  return (
    <form ref={formRef} action={switchOrganization}>
      <label htmlFor="org-switch" className="sr-only">
        Organization
      </label>
      <NativeSelect
        id="org-switch"
        name="organizationId"
        defaultValue={activeId}
        onChange={() => formRef.current?.requestSubmit()}
      >
        {memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.organizationName} ({m.role})
          </option>
        ))}
      </NativeSelect>
    </form>
  );
}
