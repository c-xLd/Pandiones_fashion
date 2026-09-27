"use client";
import { useState, useTransition } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { ASSET_ROLES } from "@/lib/domain/schemas";
import { updateAssetRole } from "@/server/actions/products";
import { useI18n } from "@/lib/i18n/client";

export function AssetRoleSelect({ assetId, role, disabled }: { assetId: string; role: string; disabled?: boolean }) {
  const { d } = useI18n();
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <NativeSelect
        aria-label={d.product.imageRole}
        className="h-8 text-xs"
        value={value}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          setValue(next);
          start(async () => {
            const res = await updateAssetRole(assetId, next);
            if (!res.ok) {
              setValue(prev);
              setError(res.error);
            } else setError(null);
          });
        }}
      >
        {ASSET_ROLES.map((r) => (
          <option key={r} value={r}>
            {d.enums.assetRole[r]}
          </option>
        ))}
      </NativeSelect>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
