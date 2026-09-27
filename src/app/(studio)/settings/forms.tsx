"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage } from "@/components/forms/form-message";
import { ORG_ROLES } from "@/lib/domain/schemas";
import { addMember, checkProviders, updateMemberRole, updateOrganizationSettings, type ProviderCheck } from "@/server/actions/settings";

export function OrgSettingsForm({
  name,
  budget,
  alertPercent,
  hardLimit,
  readOnly,
}: {
  name: string;
  budget: number | null;
  alertPercent: number;
  hardLimit: boolean;
  readOnly: boolean;
}) {
  const [state, action] = useActionState(updateOrganizationSettings, null);
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="org-name">Organization name</Label>
          <Input id="org-name" name="name" defaultValue={name} required minLength={2} maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="budget">Monthly budget (USD)</Label>
          <Input id="budget" name="monthlyBudgetUsd" type="number" min={0} step="0.01" defaultValue={budget ?? ""} placeholder="no budget" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alert">Alert threshold (%)</Label>
          <Input id="alert" name="budgetAlertPercent" type="number" min={1} max={100} defaultValue={alertPercent} />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Checkbox name="budgetHardLimit" defaultChecked={hardLimit} />
          Block new generations when the monthly budget is exhausted (based on recorded and estimated costs)
        </label>
      </fieldset>
      <FormMessage state={state} />
      {!readOnly && <SubmitButton pendingText="Saving…">Save settings</SubmitButton>}
    </form>
  );
}

export function AddMemberForm() {
  const [state, action] = useActionState(addMember, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[220px] flex-1 space-y-1.5">
        <Label htmlFor="member-email">Email of an existing account</Label>
        <Input id="member-email" name="email" type="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="member-role">Role</Label>
        <NativeSelect id="member-role" name="role" defaultValue="editor" className="w-32">
          {ORG_ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </NativeSelect>
      </div>
      <SubmitButton pendingText="Adding…">Add member</SubmitButton>
      <div className="w-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function MemberRoleSelect({ memberId, role, disabled }: { memberId: string; role: string; disabled: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <NativeSelect
        aria-label="Member role"
        className="h-8 w-28"
        value={value}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          setValue(next);
          start(async () => {
            const res = await updateMemberRole(memberId, next);
            if (!res.ok) {
              setValue(prev);
              setError(res.error);
            } else setError(null);
            router.refresh();
          });
        }}
      >
        {ORG_ROLES.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </NativeSelect>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ProviderCheckButton() {
  const [pending, start] = useTransition();
  const [checks, setChecks] = useState<ProviderCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await checkProviders();
            if (res.ok) setChecks(res.data);
            else setError(res.error);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <PlugZap />} Verify provider models now
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {checks && (
        <ul className="divide-y rounded-md border text-sm">
          {checks.map((c) => (
            <li key={c.name} className="flex items-start justify-between gap-3 p-2">
              <span className="font-medium">{c.name}</span>
              <span className={c.ok ? "text-success" : "text-destructive"}>{c.ok ? "OK" : c.configured ? "Problem" : "Not configured"} — {c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
