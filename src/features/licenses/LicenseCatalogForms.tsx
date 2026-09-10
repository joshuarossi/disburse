import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { fieldClass, LicenseField, TierSelect } from "./LicenseFields";
import { tierLimits } from "./licensePresentation";
import { useLicenseCommand } from "./useLicenseCommand";
type Catalog = FunctionReturnType<typeof api.licenseAdmin.catalog>;

export function CreateLicenseTier({
  catalog,
  sessionToken,
}: {
  catalog: Catalog;
  sessionToken: string;
}) {
  useWorkspaceLanguage();
  const [name, setName] = useState(""),
    [users, setUsers] = useState("1"),
    [recipients, setRecipients] = useState("25"),
    [reason, setReason] = useState("");
  const create = useMutation(api.licenseAdmin.createTier),
    command = useLicenseCommand();
  return (
    <section
      className="workspace-panel p-5 sm:p-6"
      aria-label={tx("Free tier catalog")}
    >
      <h2 className="text-xl font-semibold">{tx("Free tier catalog")}</h2>
      <p className="workspace-description mt-2">
        {tx(
          "Create a reusable tier with no subscription charge. You can also grant any existing paid tier for free.",
        )}
      </p>
      <ul className="divide-y divide-[var(--ws-border)] mt-4">
        {catalog.tiers.map((tier) => (
          <li key={tier.key} className="py-3">
            <p className="font-medium text-sm">{tier.name}</p>
            <p className="workspace-description !text-xs">{tierLimits(tier)}</p>
          </li>
        ))}
      </ul>
      <form
        className="border-t border-[var(--ws-border)] mt-4 pt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const input = {
            sessionToken,
            name,
            maxUsers: users === "" ? null : Number(users),
            maxBeneficiaries: recipients === "" ? null : Number(recipients),
            reason,
          };
          void command.run(
            input,
            async (requestId) => {
              await create({ ...input, requestId });
              setName("");
              setReason("");
            },
            "Free tier created. Assign it to a company or signup program when ready.",
          );
        }}
      >
        {command.error && <Notice>{command.error}</Notice>}
        {command.success && <Notice tone="success">{command.success}</Notice>}
        <fieldset className="space-y-4" disabled={command.busy}>
          <LicenseField label={tx("New tier name")}>
            <input
              className={fieldClass}
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tx("For example, Community")}
            />
          </LicenseField>
          <div className="grid gap-4 sm:grid-cols-2">
            <LicenseField label={tx("Member seats")}>
              <input
                className={fieldClass}
                type="number"
                min={1}
                max={100000}
                step={1}
                value={users}
                onChange={(e) => setUsers(e.target.value)}
                placeholder={tx("Unlimited")}
              />
            </LicenseField>
            <LicenseField label={tx("Saved recipients")}>
              <input
                className={fieldClass}
                type="number"
                min={1}
                max={100000}
                step={1}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder={tx("Unlimited")}
              />
            </LicenseField>
          </div>
          <p className="workspace-description !text-xs">
            {tx(
              "Leave a limit blank for unlimited. Account controls, payment fees, and technical service limits still apply. Existing tier definitions stay fixed.",
            )}
          </p>
          <LicenseField label={tx("Reason for creating this tier")}>
            <textarea
              className={fieldClass}
              required
              minLength={5}
              maxLength={1000}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </LicenseField>
          <Button type="submit" disabled={command.busy}>
            {command.busy ? tx("Creating tier…") : tx("Create free tier")}
          </Button>
        </fieldset>
      </form>
    </section>
  );
}

export function SignupProgram({
  catalog,
  sessionToken,
  onReload,
}: {
  catalog: Catalog;
  sessionToken: string;
  onReload: () => void;
}) {
  useWorkspaceLanguage();
  const [days, setDays] = useState(String(catalog.program.trialDays)),
    [tier, setTier] = useState(catalog.program.trialTier.key);
  const [fallback, setFallback] = useState(
      catalog.program.fallbackTier?.key ?? "free",
    ),
    [reason, setReason] = useState("");
  const [revision, setRevision] = useState(catalog.program.revision);
  const save = useMutation(api.licenseAdmin.setProgram),
    command = useLicenseCommand(),
    stale = revision !== catalog.program.revision;
  return (
    <section
      className="workspace-panel p-5 sm:p-6"
      aria-label={tx("Signup program")}
    >
      <h2 className="text-xl font-semibold">{tx("New company access")}</h2>
      <p className="workspace-description mt-2">
        {tx(
          "Choose the trial and free fallback for companies created after this change. Existing companies keep their terms.",
        )}
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const input = {
            sessionToken,
            expectedRevision: revision,
            trialDays: Number(days),
            trialTierKey: tier,
            fallbackTierKey: fallback,
            reason,
          };
          void command.run(
            input,
            async (requestId) => {
              const next = await save({ ...input, requestId });
              setRevision(next);
            },
            "Signup program saved for future companies.",
          );
        }}
      >
        {command.error && <Notice>{command.error}</Notice>}
        {command.success && <Notice tone="success">{command.success}</Notice>}
        {stale && (
          <Notice>
            {tx("The signup program changed.")}{" "}
            <button type="button" className="underline" onClick={onReload}>
              {tx("Reload current program")}
            </button>{" "}
            {tx("before saving.")}
          </Notice>
        )}
        <fieldset className="space-y-4" disabled={command.busy}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDays("30");
              setTier("pro");
              setFallback("free");
            }}
          >
            {tx("Use 30 days Pro, then Free")}
          </Button>
          <LicenseField label={tx("Trial length in days")}>
            <input
              className={fieldClass}
              type="number"
              required
              min={0}
              max={3650}
              step={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </LicenseField>
          {Number(days) > 0 && (
            <TierSelect
              label={tx("Trial tier")}
              tiers={catalog.tiers}
              value={tier}
              onChange={setTier}
            />
          )}
          <TierSelect
            label={tx("Lifetime free tier")}
            tiers={catalog.tiers}
            value={fallback}
            onChange={setFallback}
          />
          <p className="workspace-description">
            {Number(days) > 0
              ? tx("{{value1}} days of {{value2}}, then ", {
                  value1: days,
                  value2: catalog.tiers.find((t) => t.key === tier)?.name,
                })
              : tx("Starts on ")}
            {fallback
              ? tx("{{value1}} with no subscription charge or expiry date.", {
                  value1: catalog.tiers.find((t) => t.key === fallback)?.name,
                })
              : tx("a paid plan is needed to submit new payments.")}{" "}
            {tx("Customers pay their own network and provider fees.")}
          </p>
          <LicenseField label={tx("Reason for the signup change")}>
            <textarea
              className={fieldClass}
              required
              minLength={5}
              maxLength={1000}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </LicenseField>
          <Button
            type="submit"
            disabled={stale || command.busy || (!Number(days) && !fallback)}
          >
            {command.busy ? tx("Saving program…") : tx("Save signup program")}
          </Button>
        </fieldset>
      </form>
    </section>
  );
}
