import type { PreparedOwnerProposal } from "./ownerProposal";
export type ApprovalGroup = {
  path: string[];
  address: string;
  owners: string[];
  threshold: number;
  confirmedOwners: string[];
};
export type AccountApprovalView = {
  proposal: PreparedOwnerProposal;
  paths: Array<{ path: string[]; labels: string[]; approved: boolean }>;
  groups: ApprovalGroup[];
  names: Array<{ address: string; name: string }>;
  ready: boolean;
  blockedReason: string | null;
  currentNonce: number;
};
