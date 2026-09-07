import { fingerprint } from "./fingerprint";
import { assertValidAddress } from "./validation";
import { validateSavedPayoutInstructions } from "./payoutInstructions";

export type ImportedRecipient = {
  name: string;
  type?: "individual" | "business";
  email?: string;
  walletAddress?: string;
  notes?: string;
  preferredToken?: string;
  preferredChainId?: number;
  sourceSystem?: string;
  sourceId?: string;
};
export type ImportDirectoryRecipient = ImportedRecipient & {
  _id: string;
  walletAddress: string;
  isActive: boolean;
  updatedAt: number;
  pendingPayoutChangeId?: string;
  payoutVersion?: number;
  payoutReviewStatus?: string;
};
export type ImportDifference = {
  field: keyof ImportedRecipient;
  label: string;
  before: string;
  after: string;
  payout: boolean;
};
export const importFingerprint = fingerprint;
export const recipientFingerprint = (r: ImportDirectoryRecipient) =>
  importFingerprint([
    r._id,
    r.name,
    r.type,
    r.email,
    r.walletAddress.toLowerCase(),
    r.notes,
    r.preferredToken,
    r.preferredChainId,
    r.sourceSystem,
    r.sourceId,
    r.isActive,
    r.updatedAt,
    r.pendingPayoutChangeId,
    r.payoutVersion,
    r.payoutReviewStatus,
  ]);

export function normalizeImport(row: ImportedRecipient): ImportedRecipient {
  const name = row.name.trim();
  const email = row.email?.trim().toLowerCase() || undefined;
  const walletAddress = row.walletAddress?.trim().toLowerCase() || undefined;
  const sourceId = row.sourceId?.trim() || undefined;
  const sourceSystem = sourceId
    ? row.sourceSystem?.trim().toLowerCase() || "csv"
    : undefined;
  if (!name || name.length > 200)
    throw new Error("Use a recipient name between 1 and 200 characters");
  if (
    email &&
    (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new Error("Invalid recipient email");
  if (walletAddress)
    assertValidAddress(walletAddress, "recipient payment address");
  if (!email && !walletAddress && !sourceId)
    throw new Error("Provide an email, payment address or existing source ID");
  if ((sourceId?.length ?? 0) > 200 || (sourceSystem?.length ?? 0) > 80)
    throw new Error("Source ID or system name is too long");
  if ((row.notes?.length ?? 0) > 5000)
    throw new Error("Keep recipient notes within 5,000 characters");
  const normalized = {
    name,
    type: row.type,
    email,
    walletAddress,
    notes: row.notes?.trim() || undefined,
    preferredToken: row.preferredToken?.trim().toUpperCase() || undefined,
    preferredChainId: row.preferredChainId,
    sourceId,
    sourceSystem,
  };
  validateSavedPayoutInstructions(normalized);
  return normalized;
}

const labels: Record<keyof ImportedRecipient, string> = {
  name: "Name",
  type: "Recipient type",
  email: "Email",
  walletAddress: "Payment address",
  notes: "Notes",
  preferredToken: "Requested currency",
  preferredChainId: "Payment network",
  sourceSystem: "Source system",
  sourceId: "Source employee or vendor ID",
};
const payoutFields = new Set([
  "walletAddress",
  "preferredToken",
  "preferredChainId",
]);
const sourceKey = (r: ImportedRecipient) =>
  r.sourceId ? `${r.sourceSystem ?? "csv"}:${r.sourceId}` : undefined;

export function planRecipientImport(
  rows: ImportedRecipient[],
  directory: ImportDirectoryRecipient[],
) {
  const normalized = rows.map((row) => {
    try {
      return { row: normalizeImport(row), error: null };
    } catch (e) {
      return {
        row,
        error: e instanceof Error ? e.message : "Invalid recipient",
      };
    }
  });
  const counts = new Map<string, number>();
  const keys = (r: ImportedRecipient) =>
    [
      r.walletAddress ? `address:${r.walletAddress.toLowerCase()}` : undefined,
      r.email ? `email:${r.email.toLowerCase()}` : undefined,
      sourceKey(r) ? `source:${sourceKey(r)}` : undefined,
    ].filter((v): v is string => !!v);
  for (const { row } of normalized)
    for (const key of keys(row)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const index = new Map<string, ImportDirectoryRecipient[]>();
  for (const r of directory)
    for (const key of keys(r)) index.set(key, [...(index.get(key) ?? []), r]);
  const matchedIds = new Map<string, number>();
  const plans = normalized.map(({ row, error }) => {
    const errors: string[] = error ? [error] : [];
    if (keys(row).some((key) => (counts.get(key) ?? 0) > 1))
      errors.push("Duplicate source ID, email or address in this file");
    const matches = [
      ...new Map(
        keys(row)
          .flatMap((key) => index.get(key) ?? [])
          .map((r) => [r._id, r]),
      ).values(),
    ];
    if (matches.length > 1)
      errors.push(
        "Source ID, email or address matches more than one recipient. Resolve the directory conflict first.",
      );
    const existing = matches.length === 1 ? matches[0] : undefined;
    if (existing)
      matchedIds.set(existing._id, (matchedIds.get(existing._id) ?? 0) + 1);
    if (existing && !existing.isActive)
      errors.push(
        "This recipient is archived. Restore and review the record in Recipients first.",
      );
    if (
      existing?.sourceId &&
      row.sourceId &&
      sourceKey(existing) !== sourceKey(row)
    )
      errors.push(
        "This record is already linked to a different source ID. Review its identity before changing the source.",
      );
    if (!existing && !row.email && !row.walletAddress)
      errors.push("A new recipient needs an email or payment address");
    const proposed: ImportedRecipient = existing
      ? {
          name: row.name,
          type: row.type ?? existing.type ?? "individual",
          email: row.email ?? existing.email,
          walletAddress: row.walletAddress ?? existing.walletAddress,
          notes: row.notes ?? existing.notes,
          preferredToken: row.preferredToken ?? existing.preferredToken,
          preferredChainId: row.preferredChainId ?? existing.preferredChainId,
          sourceId: row.sourceId ?? existing.sourceId,
          sourceSystem: row.sourceSystem ?? existing.sourceSystem,
        }
      : {
          ...row,
          type: row.type ?? "individual",
          walletAddress: row.walletAddress ?? "",
        };
    const differences: ImportDifference[] = existing
      ? (Object.keys(labels) as Array<keyof ImportedRecipient>).flatMap(
          (field) => {
            const before =
              existing[field] == null ? "" : String(existing[field]);
            const after =
              proposed[field] == null ? "" : String(proposed[field]);
            if (
              field === "walletAddress" || field === "email"
                ? before.toLowerCase() === after.toLowerCase()
                : before === after
            )
              return [];
            return [
              {
                field,
                label: labels[field],
                before,
                after,
                payout: payoutFields.has(field),
              },
            ];
          },
        )
      : [];
    const payoutChanged = differences.some((d) => d.payout);
    if (existing?.pendingPayoutChangeId && payoutChanged)
      errors.push(
        "Payout review is already pending. Complete or withdraw it before importing another change.",
      );
    try {
      validateSavedPayoutInstructions(proposed);
    } catch (e) {
      errors.push(
        e instanceof Error ? e.message : "Invalid payout instructions",
      );
    }
    return {
      row,
      proposed,
      existingId: existing?._id,
      expectedFingerprint: existing
        ? recipientFingerprint(existing)
        : undefined,
      recommendation: (!existing
        ? "create"
        : differences.length
          ? "update"
          : "skip") as "create" | "update" | "skip",
      differences,
      payoutChanged,
      errors,
    };
  });
  for (const plan of plans)
    if (plan.existingId && (matchedIds.get(plan.existingId) ?? 0) > 1)
      plan.errors.push(
        "Multiple rows update the same recipient. Keep one row for that person.",
      );
  return plans;
}
