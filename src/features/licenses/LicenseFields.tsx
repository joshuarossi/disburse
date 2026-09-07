import {
  useId,
  cloneElement,
  type ReactElement,
} from "react";
import type { LicenseTier } from "../../../shared/billing";

export const fieldClass =
  "w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-surface)] px-3 py-2.5 text-sm";
export function LicenseField({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="space-y-2 text-sm">
      <label className="block font-medium" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, { id })}
    </div>
  );
}
export function TierSelect({
  label,
  value,
  onChange,
  tiers,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tiers: LicenseTier[];
}) {
  return (
    <LicenseField label={label}>
      <select
        className={fieldClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {tiers.map((tier) => (
          <option key={tier.key} value={tier.key}>
            {tier.name}
          </option>
        ))}
      </select>
    </LicenseField>
  );
}
