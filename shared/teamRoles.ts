export const teamRoles = {
  admin: [
    "Administrator",
    "Manage the workspace, team, and payment instructions.",
  ],
  approver: [
    "Approver",
    "Review and manage payments. Signing also requires account ownership.",
  ],
  initiator: [
    "Payment preparer",
    "Create and manage payments within app limits. Account owners can also sign payments.",
  ],
  clerk: [
    "Bookkeeper",
    "Maintain recipients and bills, and view payment records.",
  ],
  viewer: ["Viewer", "Read records and reports without changing payments."],
} as const;
export type TeamRole = keyof typeof teamRoles;
