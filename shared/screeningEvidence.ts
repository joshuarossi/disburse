import { fingerprint } from "./fingerprint";
import { SCREENING_ENGINE } from "./sanctions";

export type ScreeningInput = {
  name: string;
  walletAddress: string;
  type?: string;
  email?: string;
  preferredToken?: string;
  preferredChainId?: number;
  payoutVersion?: number;
};
export function screeningInput(recipient: ScreeningInput): ScreeningInput {
  return {
    name: recipient.name,
    walletAddress: recipient.walletAddress.toLowerCase(),
    type: recipient.type,
    email: recipient.email,
    preferredToken: recipient.preferredToken,
    preferredChainId: recipient.preferredChainId,
    payoutVersion: recipient.payoutVersion,
  };
}
export const screeningInputFingerprint = (recipient: ScreeningInput) =>
  fingerprint(screeningInput(recipient));
type Evidence = {
  status: string;
  runId?: string;
  datasetId?: string;
  engine?: string;
  inputFingerprint?: string;
  matchFingerprint?: string;
  screenedAt: number;
  reviewExpiresAt?: number;
  lastError?: string;
};
export function screeningIssue(
  recipient: ScreeningInput,
  result: Evidence | null,
  source: { activeDatasetId?: string; lastCheckedAt?: number } | null,
  maximumAgeHours = 24,
  now = Date.now(),
): { status: string; reason: string } | null {
  if (result?.status === "confirmed_match")
    return {
      status: "confirmed_match",
      reason:
        "A reviewer confirmed an OFAC list match. Review the recipient before proceeding.",
    };
  if (!source?.activeDatasetId || !source.lastCheckedAt)
    return {
      status: "unavailable",
      reason:
        "The versioned OFAC list is unavailable. Refresh the list before screening.",
    };
  if (now - source.lastCheckedAt >= maximumAgeHours * 3600_000)
    return {
      status: "stale",
      reason:
        "The OFAC source has not been checked within your workspace’s freshness limit.",
    };
  if (
    !result?.runId ||
    !result.inputFingerprint ||
    result.engine !== SCREENING_ENGINE
  )
    return {
      status: "pending",
      reason: "A screening check against the current list is needed.",
    };
  if (result.inputFingerprint !== screeningInputFingerprint(recipient))
    return {
      status: "changed",
      reason:
        "Recipient details changed after this check. Run screening again.",
    };
  if (result.lastError || result.status === "unavailable")
    return {
      status: "unavailable",
      reason:
        result.lastError ||
        "The last screening attempt did not complete. Try again.",
    };
  if (result.datasetId !== source.activeDatasetId)
    return {
      status: "stale",
      reason: "The OFAC list changed after this check. Run screening again.",
    };
  if (now - result.screenedAt >= maximumAgeHours * 3600_000)
    return {
      status: "stale",
      reason:
        "This screening result is outside your workspace’s freshness limit.",
    };
  if (result.status === "potential_match")
    return {
      status: "potential_match",
      reason: "An OFAC list match needs a reviewer’s decision.",
    };
  if (
    result.status === "false_positive" &&
    (result.reviewExpiresAt ?? 0) <= now
  )
    return {
      status: "review_expired",
      reason:
        "The previous screening decision expired. Review the evidence again.",
    };
  return null;
}
export function screeningEvidenceKey(result: Evidence) {
  return fingerprint([
    result.runId,
    result.datasetId,
    result.engine,
    result.inputFingerprint,
    result.matchFingerprint,
    result.screenedAt,
    result.status,
    result.reviewExpiresAt,
  ]);
}
