import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { createFullOrgSetup, signIn, TEST_WALLETS } from "./factories";
import { parseCsvText } from "../../src/lib/csv";
import { parsePayoutNetwork } from "../../shared/payoutInstructions";

const instances: Array<{ finishAllScheduledFunctions: (advanceTimers: () => void) => Promise<void> }> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  try {
    for (const t of instances) await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally { instances.length = 0; vi.useRealTimers(); }
});

async function setup() {
  const t = convexTest(schema);
  instances.push(t);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
  );
  const { sessionToken } = await signIn(t, "admin");
  return { t, ids, scope: { orgId: ids.orgId, sessionToken } };
}

describe("S01 recipient instructions from import through payment", () => {
  it("preserves imported instructions, completes the address later and creates an exact compatible payment", async () => {
    const { t, scope } = await setup();
    const rows = parseCsvText(
      "First Name,Last Name,Work Email,Currency,Network\nMaya,Chen,maya@example.com,USDC,Sepolia",
    );
    await t.mutation(api.beneficiaries.createBulk, {
      ...scope,
      allowMissingPaymentDetails: true,
      beneficiaries: rows.map((row) => ({
        type: "individual" as const,
        name: row.name,
        email: row.email,
        beneficiaryAddress: row.wallet_address,
        preferredToken: row.preferred_token,
        preferredChainId: parsePayoutNetwork(row.preferred_network!),
      })),
    });
    const [recipient] = await t.query(api.beneficiaries.list, scope);
    expect(recipient).toMatchObject({
      name: "Maya Chen",
      email: "maya@example.com",
      preferredToken: "USDC",
      preferredChainId: 11155111,
      walletAddress: "",
    });
    const payment = {
      ...scope,
      name: "Maya payout",
      purpose: "payroll" as const,
      chainId: 11155111,
      token: "USDC",
      recipients: [{ beneficiaryId: recipient._id, amount: "1.000001" }],
    };
    await expect(t.mutation(api.paymentRuns.create, payment)).rejects.toThrow(
      "Payment details needed",
    );
    await t.mutation(api.beneficiaries.update, {
      sessionToken: scope.sessionToken,
      beneficiaryId: recipient._id,
      beneficiaryAddress: TEST_WALLETS.viewer,
    });
    await expect(t.mutation(api.paymentRuns.create, payment)).rejects.toThrow('review pending');
    const review = await t.query(api.recipientReviews.get, { beneficiaryId: recipient._id, sessionToken: scope.sessionToken });
    await t.mutation(api.recipientReviews.decide, { changeId: review.pending!._id, sessionToken: scope.sessionToken, decision: 'approved', reason: 'Confirmed the exact USDC Sepolia instructions through the known employee contact.', verificationMethod: 'known_contact', confirmedIndependently: true });
    const { disbursementId } = await t.mutation(
      api.paymentRuns.create,
      payment,
    );
    expect(await t.run((ctx) => ctx.db.get(disbursementId))).toMatchObject({
      token: "USDC",
      totalAmount: "1.000001",
      chainId: 11155111,
    });
    const [snapshot] = await t.run((ctx) =>
      ctx.db.query("disbursementRecipients").collect(),
    );
    expect(snapshot).toMatchObject({
      recipientAddress: TEST_WALLETS.viewer.toLowerCase(),
      amount: "1.000001",
    });
    await expect(
      t.mutation(api.disbursements.create, {
        ...scope,
        beneficiaryId: recipient._id,
        chainId: 11155111,
        token: "USDT",
        amount: "1",
      }),
    ).rejects.toThrow("requests USDC");
    await expect(
      t.mutation(api.disbursements.createBatch, {
        ...scope,
        chainId: 11155111,
        token: "USDT",
        recipients: payment.recipients,
      }),
    ).rejects.toThrow("requests USDC");
  });
  it("rejects invalid imported instructions atomically and refuses incompatible recipient edits", async () => {
    const { t, scope } = await setup();
    const maya = {
      type: "individual" as const,
      name: "Maya",
      email: "maya@example.com",
      beneficiaryAddress: "",
      preferredToken: "USDC",
      preferredChainId: 11155111,
    };
    await expect(
      t.mutation(api.beneficiaries.createBulk, {
        ...scope,
        allowMissingPaymentDetails: true,
        beneficiaries: [
          maya,
          {
            ...maya,
            name: "Invalid",
            email: "invalid@example.com",
            preferredChainId: 999,
          },
        ],
      }),
    ).rejects.toThrow("Unsupported payout network");
    expect(await t.query(api.beneficiaries.list, scope)).toHaveLength(0);
    const { beneficiaryId } = await t.mutation(api.beneficiaries.create, {
      ...scope,
      ...maya,
      allowMissingPaymentDetails: true,
    });
    await expect(
      t.mutation(api.beneficiaries.update, {
        sessionToken: scope.sessionToken,
        beneficiaryId,
        preferredToken: "PYUSD",
        preferredChainId: 8453,
      }),
    ).rejects.toThrow("not supported");
    expect(await t.run((ctx) => ctx.db.get(beneficiaryId))).toMatchObject({
      preferredToken: "USDC",
      preferredChainId: 11155111,
    });
  });
});
