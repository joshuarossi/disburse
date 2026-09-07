export function screeningReviewKey(
  flagged: Array<{
    beneficiaryId: string;
    status: string;
    evidenceKey?: string;
  }>,
) {
  return flagged
    .map(
      (row) =>
        `${row.beneficiaryId}:${row.status}${row.evidenceKey ? `:${row.evidenceKey}` : ""}`,
    )
    .sort()
    .join("|");
}
