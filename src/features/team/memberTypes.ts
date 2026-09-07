import type { Id } from "../../../convex/_generated/dataModel";
import { teamRoles as roles } from "../../../shared/teamRoles";
export { roles };
export type TeamMember = {
  membershipId: Id<"orgMemberships">;
  name?: string;
  email?: string;
  emailVerifiedAt?: number;
  invitationExpiresAt?: number;
  paymentPolicy?: { token: string; perPayment?: string; perMonth?: string };
  walletAddress: string;
  role: keyof typeof roles;
  status: string;
};
