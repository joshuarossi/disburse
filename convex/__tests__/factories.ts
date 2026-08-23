import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { api } from "../_generated/api";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

type Role = "admin" | "approver" | "initiator" | "clerk" | "viewer";
type Plan = "trial" | "starter" | "team" | "pro";
type BeneficiaryType = "individual" | "business";

// ─── Signed-auth helpers ─────────────────────────────────────────────────────
// Backend identity now comes exclusively from server-verified SIWE sessions.
// Tests therefore authenticate through the REAL crypto path: generateNonce →
// sign message with a viem account → verifySignature → session token.

const TEST_PRIVATE_KEYS = {
  admin: "0x0000000000000000000000000000000000000000000000000000000000000001",
  approver: "0x0000000000000000000000000000000000000000000000000000000000000002",
  initiator: "0x0000000000000000000000000000000000000000000000000000000000000003",
  clerk: "0x0000000000000000000000000000000000000000000000000000000000000004",
  viewer: "0x0000000000000000000000000000000000000000000000000000000000000005",
  nonMember: "0x0000000000000000000000000000000000000000000000000000000000000006",
} as const;

export type TestRoleName = keyof typeof TEST_PRIVATE_KEYS;

/** viem accounts whose addresses match TEST_WALLETS below */
export const TEST_ACCOUNTS: Record<TestRoleName, PrivateKeyAccount> =
  Object.fromEntries(
    Object.entries(TEST_PRIVATE_KEYS).map(([role, key]) => [
      role,
      privateKeyToAccount(key as `0x${string}`),
    ])
  ) as Record<TestRoleName, PrivateKeyAccount>;

/**
 * Perform a real signed sign-in for a deterministic test wallet and return
 * the opaque session token issued by convex/auth.verifySignature.
 * The nonce is consumed exactly as in production.
 */
export async function signIn(
  t: {
    mutation: (fnRef: unknown, args: unknown) => Promise<any>;
  },
  roleName: TestRoleName
): Promise<{ sessionToken: string; userId: Id<"users">; walletAddress: string }> {
  const account = TEST_ACCOUNTS[roleName];
  const walletAddress = account.address;

  // Server builds the SIWE message and registers a single-use nonce
  const { message } = (await t.mutation(api.auth.generateNonce, {
    walletAddress,
  })) as { message: string };

  // Sign it cryptographically (no network needed for EOA accounts)
  const signature = await account.signMessage({ message });

  // Server verifies signature, consumes nonce, issues token
  const result = (await t.mutation(api.auth.verifySignature, {
    walletAddress,
    signature,
    message,
  })) as { token: string; userId: Id<"users"> };

  return {
    sessionToken: result.token,
    userId: result.userId,
    walletAddress,
  };
}

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
    // Production stores addresses lowercase — match that here
    walletAddress: (overrides.walletAddress || `0x${randomHex(40)}`).toLowerCase(),
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
    tokenHash?: string;
    expiresAt?: number;
  } = {}
): Promise<Id<"sessions">> {
  const now = Date.now();
  return await ctx.db.insert("sessions", {
    userId,
    walletAddress: walletAddress.toLowerCase(),
    // Authenticated session by default (tokenHash set); pass nonce-only rows
    // explicitly when testing pending sign-in nonces.
    nonce: overrides.nonce,
    tokenHash: overrides.tokenHash ?? randomHex(64),
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
 * Test wallet addresses — derived from TEST_ACCOUNTS private keys so the
 * addresses, signatures, and sessions all match deterministically.
 */
export const TEST_WALLETS = {
  admin: TEST_ACCOUNTS.admin.address,
  approver: TEST_ACCOUNTS.approver.address,
  initiator: TEST_ACCOUNTS.initiator.address,
  clerk: TEST_ACCOUNTS.clerk.address,
  viewer: TEST_ACCOUNTS.viewer.address,
  nonMember: TEST_ACCOUNTS.nonMember.address,
} as const;
