import { formatUnits } from "viem";
export const treasuryRequestStatuses = {
  quoted: "Ready for review",
  approving: "Needs approval",
  processing: "Processing",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Review expired",
  failed: "Not completed",
};
export const treasuryUnits = (amount: string) => formatUnits(BigInt(amount), 6);
