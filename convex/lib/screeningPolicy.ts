import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { sourceRecord } from "../ofacData";
import {
  screeningEvidenceKey,
  screeningInputFingerprint,
  screeningIssue,
} from "../../shared/screeningEvidence";
import { fingerprint } from "../../shared/fingerprint";

export async function checkRecipientScreening(
  ctx: Pick<QueryCtx, "db">,
  orgId: Id<"orgs">,
  recipientIds: Id<"beneficiaries">[],
) {
  if (recipientIds.length > 1000)
    throw new Error("Review payment groups of at most 1,000 recipients.");
  const org = await ctx.db.get(orgId),
    source = await sourceRecord(ctx),
    enforcement = org?.screeningEnforcement ?? "warn";
  const flagged: Array<{
    beneficiaryId: Id<"beneficiaries">;
    beneficiaryName: string;
    status: string;
    reason: string;
    evidenceKey: string;
  }> = [];
  for (const beneficiaryId of new Set(recipientIds)) {
    const recipient = await ctx.db.get(beneficiaryId);
    if (!recipient || recipient.orgId !== orgId)
      throw new Error("Recipient does not belong to this workspace.");
    if (enforcement === "off") continue;
    const result = await ctx.db
      .query("screeningResults")
      .withIndex("by_beneficiary", (q) => q.eq("beneficiaryId", beneficiaryId))
      .unique();
    const issue = screeningIssue(
      recipient,
      result,
      source,
      org?.screeningMaxAgeHours,
    );
    if (issue)
      flagged.push({
        beneficiaryId,
        beneficiaryName: recipient.name,
        ...issue,
        evidenceKey: fingerprint([
          result ? screeningEvidenceKey(result) : null,
          screeningInputFingerprint(recipient),
          source?.activeDatasetId,
          issue.status,
        ]),
      });
  }
  return { clear: flagged.length === 0, flagged, enforcement };
}
