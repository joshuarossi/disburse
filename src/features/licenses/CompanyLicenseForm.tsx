import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import {
  billingAccess,
  DAY,
  hasPaidTerm,
  type LicenseTier,
} from "../../../shared/billing";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import {
  fieldClass,
  LicenseField,
  TierSelect,
} from "./LicenseFields";
import { tierLimits } from "./licensePresentation";
import { useLicenseCommand } from "./useLicenseCommand";

function localDateTime(time: number) {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function CompanyLicenseForm({
  company,
  tiers,
  sessionToken,
  onReload,
}: {
  company: FunctionReturnType<typeof api.licenseAdmin.company>;
  tiers: LicenseTier[];
  sessionToken: string;
  onReload: () => void;
}) {
  const { billing } = company;
  const [revision, setRevision] = useState(billing.licenseRevision ?? 0);
  const [mode, setMode] = useState<"trial" | "complimentary" | "standard">(
    billing.licenseGrant?.kind ?? "standard",
  );
  const [tierKey, setTier] = useState(
    billing.licenseGrant?.tier.key ?? billing.trialTier?.key ?? billing.plan,
  );
  const [fallback, setFallback] = useState(billing.fallbackTier?.key ?? "free");
  const [permanent, setPermanent] = useState(
    billing.licenseGrant?.expiresAt === undefined,
  );
  const [date, setDate] = useState(
    localDateTime(
      billing.licenseGrant?.expiresAt ??
        Math.max(billing.trialEndsAt ?? 0, Date.now() + 30 * DAY),
    ),
  );
  const [reason, setReason] = useState("");
  const save = useMutation(api.licenseAdmin.changeCompany),
    command = useLicenseCommand();
  const stale = revision !== (billing.licenseRevision ?? 0);
  const tier = tiers.find((t) => t.key === tierKey)!;
  const expiresAt =
    mode === "trial" || (mode === "complimentary" && !permanent)
      ? new Date(date).getTime()
      : undefined;
  const proposed = billingAccess({
    ...billing,
    licenseGrant:
      mode === "standard"
        ? undefined
        : { kind: mode, tier, grantedAt: Date.now(), expiresAt },
    trialEndsAt: mode === "trial" ? expiresAt : billing.trialEndsAt,
    fallbackTier: tiers.find((t) => t.key === fallback),
  });
  const paid = hasPaidTerm(billing);
  return (
    <section
      className="workspace-panel p-5 sm:p-6"
      aria-label="Company license"
    >
      <h2 className="text-xl font-semibold">{company.org.name}</h2>
      <p className="workspace-description mt-1">
        Current access: {company.access.effectiveTier.name} ·{" "}
        {company.access.source === "paid"
          ? "Paid subscription"
          : "No subscription charge"}
      </p>
      <form
        className="mt-5 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const input = {
            sessionToken,
            orgId: company.org.id,
            expectedRevision: revision,
            mode,
            tierKey,
            expiresAt,
            fallbackTierKey: fallback,
            reason,
          };
          void command.run(
            input,
            async (requestId) => {
              const next = await save({ ...input, requestId });
              setRevision(next);
            },
            "Company license saved. No subscription payment was created.",
          );
        }}
      >
        {command.error && <Notice>{command.error}</Notice>}
        {command.success && <Notice tone="success">{command.success}</Notice>}
        {stale && (
          <Notice>
            This license changed while the form was open.{" "}
            <button type="button" className="underline" onClick={onReload}>
              Reload current license
            </button>{" "}
            before saving.
          </Notice>
        )}
        <fieldset className="space-y-5" disabled={command.busy}>
          <LicenseField label="Access arrangement">
            <select
              className={fieldClass}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="standard">Use normal subscription or trial</option>
              <option value="trial">Set or extend a trial</option>
              <option value="complimentary">Grant complimentary access</option>
            </select>
          </LicenseField>
          {mode !== "standard" && (
            <>
              <TierSelect
                label="Access tier"
                tiers={tiers}
                value={tierKey}
                onChange={setTier}
              />
              {mode === "complimentary" && (
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={permanent}
                    onChange={(e) => setPermanent(e.target.checked)}
                  />
                  Never expires
                </label>
              )}
              {(mode === "trial" || !permanent) && (
                <LicenseField label="Access ends, your local time">
                  <input
                    className={fieldClass}
                    type="datetime-local"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </LicenseField>
              )}
            </>
          )}
          <TierSelect
            label="Free tier after trial or paid access ends"
            tiers={tiers}
            value={fallback}
            onChange={setFallback}
          />
          <p className="workspace-description !text-xs">
            The fallback has no end date or subscription charge. Existing
            members and records remain when a lower limit takes effect. Limits
            apply when adding recipients or reserving member seats.
          </p>
          <div
            className="rounded-lg border border-[var(--ws-border)] p-4 space-y-2"
            aria-label="License preview"
          >
            <p className="font-semibold">
              After saving:{" "}
              {proposed.isActive ? proposed.effectiveTier.name : "Access ended"}
            </p>
            <p className="workspace-description">
              {tierLimits(proposed.effectiveTier)}
            </p>
            <p className="workspace-description">
              {proposed.expiresAt
                ? `Current access ends ${new Date(proposed.expiresAt).toLocaleString()}.`
                : proposed.isActive
                  ? "No expiry date. No subscription charge."
                  : "New payments require an active license. Records and funds remain accessible."}
            </p>
            <p className="workspace-description">
              Customers pay all network and provider fees, including on free
              tiers.
            </p>
            {paid && (
              <p className="workspace-description">
                The paid term through{" "}
                {new Date(billing.paidThroughAt!).toLocaleString()} stays on
                record. This grant creates no refund or paid credit. A later
                subscription payment replaces the grant.
              </p>
            )}
          </div>
          <LicenseField label="Reason for this change">
            <textarea
              className={fieldClass}
              required
              minLength={5}
              maxLength={1000}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example, complimentary access for a pilot customer"
            />
          </LicenseField>
          <p className="workspace-description !text-xs">
            The reason is visible to license operators. The company sees the
            resulting access and an audit event.
          </p>
          <Button type="submit" disabled={stale || command.busy}>
            {command.busy ? "Saving license…" : "Save company license"}
          </Button>
        </fieldset>
      </form>
      <div className="mt-7 border-t border-[var(--ws-border)] pt-5">
        <h3 className="font-semibold">Recent license changes</h3>
        {company.changes.length ? (
          <ul className="mt-3 space-y-3">
            {company.changes.map((change) => (
              <li key={change._id} className="text-sm">
                <p>{change.reason}</p>
                <p className="workspace-description !text-xs">
                  {new Date(change.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="workspace-description mt-2">No operator changes yet.</p>
        )}
      </div>
    </section>
  );
}
