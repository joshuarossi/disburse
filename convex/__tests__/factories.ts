import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";

type Role = "admin" | "approver" | "initiator" | "clerk" | "viewer";
type Plan = "trial" | "starter" | "team" | "pro";
type BeneficiaryType = "individual" | "business";

/**
 * Create a test user
 */
export async function createTestUser(
  ctx: MutationCtx,
  overrides: {
    walletAddress?: string;
    email?: string;
  } = {}
): Promise<Id<"users">> {
  const now = Date.now();
  const userId = await ctx.db.insert("users", {
    walletAddress: overrides.walletAddress || `0x${randomHex(40)}`,
    email: overrides.email,
    createdAt: now,
  });
  return userId;
}

/**
 * Create a test organization with membership and billing
 */
export async function createTestOrg(
  ctx: MutationCtx,
  userId: Id<"users">,
  overrides: {
    name?: string;
    role?: Role;
    plan?: Plan;
    trialEndsAt?: number;
    paidThroughAt?: number;
    billingStatus?: "active" | "trial" | "expired" | "cancelled";
  } = {}
): Promise<{
  orgId: Id<"orgs">;
  membershipId: Id<"orgMemberships">;
  billingId: Id<"billing">;
}> {
  const now = Date.now();
  
  // Create org
  const orgId = await ctx.db.insert("orgs", {
    name: overrides.name || `Test Org ${randomHex(8)}`,
    createdBy: userId,
    createdAt: now,
  });

  // Create membership
  const membershipId = await ctx.db.insert("orgMemberships", {
    orgId,
    userId,
    role: overrides.role || "admin",
    status: "active",
    createdAt: now,
  });

  // Create billing record
  const plan = overrides.plan || "trial";
  const billingId = await ctx.db.insert("billing", {
    orgId,
    plan,
    trialEndsAt: overrides.trialEndsAt ?? (plan === "trial" ? now + 30 * 24 * 60 * 60 * 1000 : undefined),
    paidThroughAt: overrides.paidThroughAt,
    status: overrides.billingStatus || (plan === "trial" ? "trial" : "active"),
    createdAt: now,
    updatedAt: now,
  });

  return { orgId, membershipId, billingId };
}

/**
 * Create a test membership (for adding additional users to an org)
 */
export async function createTestMembership(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
  overrides: {
    role?: Role;
    status?: "active" | "invited" | "removed";
  } = {}
): Promise<Id<"orgMemberships">> {
  const now = Date.now();
  return await ctx.db.insert("orgMemberships", {
    orgId,
    userId,
    role: overrides.role || "viewer",
    status: overrides.status || "active",
    createdAt: now,
  });
}

/**
 * Create a test Safe linked to an org
 */
export async function createTestSafe(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  overrides: {
    chainId?: number;
    safeAddress?: string;
  } = {}
): Promise<Id<"safes">> {
  const now = Date.now();
  return await ctx.db.insert("safes", {
    orgId,
    chainId: overrides.chainId || 11155111, // Sepolia
    safeAddress: overrides.safeAddress || `0x${randomHex(40)}`,
    createdAt: now,
  });
}

/**
 * Create a test beneficiary
 */
export async function createTestBeneficiary(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  overrides: {
    type?: BeneficiaryType;
    name?: string;
    walletAddress?: string;
    notes?: string;
    isActive?: boolean;
  } = {}
): Promise<Id<"beneficiaries">> {
  const now = Date.now();
  return await ctx.db.insert("beneficiaries", {
    orgId,
    type: overrides.type ?? "individual", // Optional in schema but we always set it in tests
    name: overrides.name || `Test Beneficiary ${randomHex(8)}`,
    walletAddress: overrides.walletAddress || `0x${randomHex(40)}`,
    notes: overrides.notes,
    isActive: overrides.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Create a test disbursement
 */
export async function createTestDisbursement(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  safeId: Id<"safes">,
  beneficiaryId: Id<"beneficiaries">,
  createdBy: Id<"users">,
  overrides: {
    token?: string;
    amount?: string;
    memo?: string;
    status?: "draft" | "pending" | "proposed" | "executed" | "failed" | "cancelled";
    safeTxHash?: string;
    txHash?: string;
    type?: "single" | "batch";
  } = {}
): Promise<Id<"disbursements">> {
  const safe = await ctx.db.get(safeId);
  const chainId = safe?.chainId ?? 11155111;
  const now = Date.now();
  return await ctx.db.insert("disbursements", {
    orgId,
    safeId,
    chainId,
    beneficiaryId: overrides.type === "batch" ? undefined : beneficiaryId,
    token: overrides.token || "USDC",
    amount: overrides.type === "batch" ? undefined : (overrides.amount || "100"),
    totalAmount: overrides.type === "batch" ? (overrides.amount || "100") : undefined,
    type: overrides.type || "single",
    memo: overrides.memo,
    status: overrides.status || "draft",
    safeTxHash: overrides.safeTxHash,
    txHash: overrides.txHash,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Create a test batch disbursement with recipients
 */
export async function createTestBatchDisbursement(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  safeId: Id<"safes">,
  recipientData: Array<{
    beneficiaryId: Id<"beneficiaries">;
    amount: string;
  }>,
  createdBy: Id<"users">,
  overrides: {
    token?: string;
    memo?: string;
    status?: "draft" | "pending" | "proposed" | "executed" | "failed" | "cancelled";
    safeTxHash?: string;
    txHash?: string;
  } = {}
): Promise<{
  disbursementId: Id<"disbursements">;
  recipientIds: Id<"disbursementRecipients">[];
}> {
  const safe = await ctx.db.get(safeId);
  const chainId = safe?.chainId ?? 11155111;
  const now = Date.now();
  
  // Calculate total
  const totalAmount = recipientData.reduce((sum, r) => sum + parseFloat(r.amount), 0).toString();
  
  // Create disbursement
  const disbursementId = await ctx.db.insert("disbursements", {
    orgId,
    safeId,
    chainId,
    type: "batch",
    token: overrides.token || "USDC",
    totalAmount,
    memo: overrides.memo,
    status: overrides.status || "draft",
    safeTxHash: overrides.safeTxHash,
    txHash: overrides.txHash,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });

  // Create recipients
  const recipientIds: Id<"disbursementRecipients">[] = [];
  for (const recipient of recipientData) {
    // Get beneficiary to get wallet address
    const beneficiary = await ctx.db.get(recipient.beneficiaryId);
    if (!beneficiary) {
      throw new Error(`Beneficiary ${recipient.beneficiaryId} not found`);
    }
    
    const recipientId = await ctx.db.insert("disbursementRecipients", {
      disbursementId,
      beneficiaryId: recipient.beneficiaryId,
      recipientAddress: beneficiary.walletAddress,
      amount: recipient.amount,
      createdAt: now,
    });
    recipientIds.push(recipientId);
  }

  return { disbursementId, recipientIds };
}

/**
 * Create a test session
 */
export async function createTestSession(
  ctx: MutationCtx,
  userId: Id<"users">,
  walletAddress: string,
  overrides: {
    nonce?: string;
    expiresAt?: number;
  } = {}
): Promise<Id<"sessions">> {
  const now = Date.now();
  return await ctx.db.insert("sessions", {
    userId,
    walletAddress: walletAddress.toLowerCase(),
    nonce: overrides.nonce || crypto.randomUUID(),
    expiresAt: overrides.expiresAt ?? now + 7 * 24 * 60 * 60 * 1000,
    createdAt: now,
  });
}

/**
 * Create a test audit log entry
 */
export async function createTestAuditLog(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  actorUserId: Id<"users">,
  overrides: {
    action?: string;
    objectType?: string;
    objectId?: string;
    metadata?: unknown;
  } = {}
): Promise<Id<"auditLog">> {
  return await ctx.db.insert("auditLog", {
    orgId,
    actorUserId,
    action: overrides.action || "test.action",
    objectType: overrides.objectType || "test",
    objectId: overrides.objectId || "test-id",
    metadata: overrides.metadata,
    timestamp: Date.now(),
  });
}

/**
 * Helper to create a full org setup with user, org, membership, billing, and safe
 */
export async function createFullOrgSetup(
  ctx: MutationCtx,
  overrides: {
    walletAddress?: string;
    orgName?: string;
    role?: Role;
    plan?: Plan;
  } = {}
): Promise<{
  userId: Id<"users">;
  walletAddress: string;
  orgId: Id<"orgs">;
  membershipId: Id<"orgMemberships">;
  billingId: Id<"billing">;
  safeId: Id<"safes">;
  safeAddress: string;
}> {
  const walletAddress = overrides.walletAddress || `0x${randomHex(40)}`;
  const safeAddress = `0x${randomHex(40)}`;
  
  const userId = await createTestUser(ctx, { walletAddress });
  const { orgId, membershipId, billingId } = await createTestOrg(ctx, userId, {
    name: overrides.orgName,
    role: overrides.role,
    plan: overrides.plan,
  });
  const safeId = await createTestSafe(ctx, orgId, { safeAddress });

  return {
    userId,
    walletAddress,
    orgId,
    membershipId,
    billingId,
    safeId,
    safeAddress,
  };
}

/**
 * Generate random hex string
 */
function randomHex(length: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Test wallet addresses for consistent testing
 */
export const TEST_WALLETS = {
  admin: "0x1234567890123456789012345678901234567890",
  approver: "0x2345678901234567890123456789012345678901",
  initiator: "0x3456789012345678901234567890123456789012",
  clerk: "0x4567890123456789012345678901234567890123",
  viewer: "0x5678901234567890123456789012345678901234",
  nonMember: "0x6789012345678901234567890123456789012345",
} as const;
