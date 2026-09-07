export type OrgRole = "admin" | "approver" | "initiator" | "clerk" | "viewer";

export const ORG_READER_ROLES: readonly OrgRole[] = [
  "admin",
  "approver",
  "initiator",
  "clerk",
  "viewer",
];
export const PAYMENT_OPERATOR_ROLES: readonly OrgRole[] = [
  "admin",
  "approver",
  "initiator",
];
export const RECORD_EDITOR_ROLES: readonly OrgRole[] = [
  "admin",
  "approver",
  "initiator",
  "clerk",
];
// Recipient editors and reviewers are separate capabilities.
export const RECIPIENT_EDITOR_ROLES: readonly OrgRole[] = [
  "admin",
  "initiator",
  "clerk",
];
export const ACCOUNTING_EDITOR_ROLES: readonly OrgRole[] = [
  "admin",
  "approver",
  "clerk",
];
export const SCREENING_REVIEWER_ROLES: readonly OrgRole[] = ["admin"];
