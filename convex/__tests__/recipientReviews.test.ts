import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestUser,
  createTestMembership,
  signIn,
  TEST_WALLETS,
} from "./factories";
import { CHAIN_TOKENS } from "../../shared/chains";
import { lookalikeAddress } from "../../shared/recipientAssurance";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const original = `0x1234${"0".repeat(32)}abcd`;
const lookalike = `0x1234${"f".repeat(32)}abcd`;
const proof = {
  reason:
    "Confirmed every character by calling the established recipient contact.",
  verificationMethod: "known_contact" as const,
  confirmedIndependently: true,
  decision: "approved" as const,
};

async function setup(secondApprover = true) {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const beneficiaryId = await createTestBeneficiary(ctx, ids.orgId, {
      name: "Maya Chen",
      walletAddress: original,
    });
    if (secondApprover) {
      const reviewer = await createTestUser(ctx, {
        walletAddress: TEST_WALLETS.approver,
      });
      await createTestMembership(ctx, ids.orgId, reviewer, {
        role: "approver",
      });
    }
    return { ...ids, beneficiaryId };
  });
  const { sessionToken } = await signIn(t, "admin");
  const fields = {
    orgId: ids.orgId,
    sessionToken,
    name: "Payroll",
    purpose: "payroll" as const,
    token: "USDC",
    chainId: 11155111,
    recipients: [{ beneficiaryId: ids.beneficiaryId, amount: "1" }],
  };
  return { t, ids, sessionToken, fields };
}

it("keeps new recipients unpayable until independent review and records the exact evidence", async () => {
  const { t, ids, sessionToken, fields } = await setup();
  const { beneficiaryId } = await t.mutation(api.beneficiaries.create, {
    orgId: ids.orgId,
    sessionToken,
    type: "individual",
    name: "New employee",
    beneficiaryAddress: TEST_WALLETS.viewer,
    preferredToken: "USDC",
    preferredChainId: 11155111,
  });
  const payment = { ...fields, recipients: [{ beneficiaryId, amount: "1" }] };
  await expect(t.mutation(api.paymentRuns.create, payment)).rejects.toThrow(
    "review pending",
  );
  const review = await t.query(api.recipientReviews.get, {
    beneficiaryId,
    sessionToken,
  });
  expect(review).toMatchObject({
    independentRequired: true,
    canDecide: false,
    isRequester: true,
  });
  await expect(
    t.mutation(api.recipientReviews.decide, {
      changeId: review.pending!._id,
      sessionToken,
      ...proof,
    }),
  ).rejects.toThrow("Another approver");
  const approver = await signIn(t, "approver");
  await t.mutation(api.recipientReviews.decide, {
    changeId: review.pending!._id,
    sessionToken: approver.sessionToken,
    ...proof,
  });
  const { disbursementId } = await t.mutation(api.paymentRuns.create, payment);
  await expect(
    t.query(api.recipientReviews.assertPayable, {
      disbursementId,
      sessionToken,
    }),
  ).resolves.toBe(true);
  const saved = await t.run((ctx) => ctx.db.get(beneficiaryId));
  expect(saved).toMatchObject({
    payoutVersion: 1,
    payoutReviewStatus: "approved",
    preferredToken: "USDC",
    preferredChainId: 11155111,
  });
  expect(saved?.pendingPayoutChangeId).toBeUndefined();
  const evidence = await t.run((ctx) => ctx.db.get(review.pending!._id));
  expect(evidence).toMatchObject({
    status: "approved",
    reason: proof.reason,
    verificationMethod: "known_contact",
  });
  await expect(
    t.mutation(api.recipientReviews.decide, {
      changeId: review.pending!._id,
      sessionToken: approver.sessionToken,
      ...proof,
    }),
  ).rejects.toThrow("no longer current");
});

it("holds a lookalike address change and invalidates previous payment approvals when it is approved", async () => {
  const { t, ids, sessionToken, fields } = await setup();
  const { disbursementId } = await t.mutation(api.paymentRuns.create, fields);
  await t.mutation(api.disbursements.updateStatus, {
    disbursementId,
    sessionToken,
    status: "pending",
  });
  await t.mutation(api.beneficiaries.update, {
    beneficiaryId: ids.beneficiaryId,
    sessionToken,
    beneficiaryAddress: lookalike,
    preferredToken: "USDC",
    preferredChainId: 11155111,
  });
  expect(await t.run((ctx) => ctx.db.get(ids.beneficiaryId))).toMatchObject({
    walletAddress: original,
    payoutVersion: 1,
  });
  const review = await t.query(api.recipientReviews.get, {
    beneficiaryId: ids.beneficiaryId,
    sessionToken,
  });
  expect(review.lookalikes).toEqual(["Maya Chen"]);
  await expect(
    t.query(api.recipientReviews.assertPayable, {
      disbursementId,
      sessionToken,
    }),
  ).rejects.toThrow("review pending");
  const approver = await signIn(t, "approver");
  await t.mutation(api.recipientReviews.decide, {
    changeId: review.pending!._id,
    sessionToken: approver.sessionToken,
    ...proof,
  });
  await expect(
    t.query(api.recipientReviews.assertPayable, {
      disbursementId,
      sessionToken,
    }),
  ).rejects.toThrow("prior approvals cannot be used");
  const payment = await t.query(api.disbursements.getWithRecipients, {
    disbursementId,
    sessionToken,
  });
  expect(payment?.payoutReviewError).toContain(
    "prior approvals cannot be used",
  );
  expect(payment?.recipients[0]).toMatchObject({
    recipientAddress: original,
    payoutVersion: 1,
  });
  await t.mutation(api.disbursements.updateStatus, {
    disbursementId,
    sessionToken,
    status: "cancelled",
  });
  const replacement = await t.mutation(api.paymentRuns.create, fields);
  expect(
    (
      await t.query(api.disbursements.getWithRecipients, {
        disbursementId: replacement.disbursementId,
        sessionToken,
      })
    )?.recipients[0],
  ).toMatchObject({ recipientAddress: lookalike, payoutVersion: 2 });
});

it("never creates or updates a recipient from an unsolicited incoming dust transfer", async () => {
  const { t, ids, sessionToken } = await setup();
  await t.mutation(internal.depositsData.upsertDeposit, {
    orgId: ids.orgId,
    safeId: ids.safeId,
    chainId: 11155111,
    safeAddress: ids.safeAddress,
    toAddress: ids.safeAddress,
    fromAddress: lookalike,
    tokenAddress: CHAIN_TOKENS[11155111].USDC.address,
    tokenSymbol: "USDC",
    decimals: 6,
    amountRaw: "1",
    amount: "0.000001",
    txHash: `0x${"a".repeat(64)}`,
    transferId: `e${"a".repeat(64)}1`,
    timestamp: Date.now(),
    source: "safe_tx_service",
  });
  const directory = await t.query(api.beneficiaries.list, {
    orgId: ids.orgId,
    sessionToken,
    activeOnly: true,
  });
  expect(directory).toHaveLength(1);
  expect(directory[0]).toMatchObject({
    walletAddress: original,
    payoutVersion: 1,
    payoutReviewStatus: "approved",
  });
  expect(lookalikeAddress(original, lookalike)).toBe(true);
  expect(lookalikeAddress(original, original)).toBe(false);
});

it("checks a queued managed payment immediately before the provider submission claim", async () => {
  const { t, ids, sessionToken, fields } = await setup();
  const { disbursementId } = await t.mutation(api.paymentRuns.create, fields);
  const jobId = await t.run(async (ctx) => {
    await ctx.db.patch(disbursementId, { status: "relaying" });
    return ctx.db.insert("relayJobs", {
      disbursementId,
      orgId: ids.orgId,
      chainId: 11155111,
      safeTxHash: `0x${"a".repeat(64)}`,
      to: ids.safeAddress,
      data: "0x",
      status: "prepared",
      provider: "gelato_turbo",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  await t.mutation(api.beneficiaries.update, {
    beneficiaryId: ids.beneficiaryId,
    sessionToken,
    beneficiaryAddress: lookalike,
  });
  expect(await t.mutation(internal.relayJobs.begin, { jobId })).toBe(false);
  expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
    status: "exception",
    neverSubmitted: true,
    attempts: 0,
  });
});

it("requires explicit evidence for a sole approver and never auto-approves imported details", async () => {
  const { t, ids, sessionToken } = await setup(false);
  await t.mutation(api.beneficiaries.createBulk, {
    orgId: ids.orgId,
    sessionToken,
    beneficiaries: [
      {
        type: "individual",
        name: "Imported contractor",
        beneficiaryAddress: TEST_WALLETS.viewer,
      },
    ],
  });
  const recipient = (
    await t.query(api.beneficiaries.list, { orgId: ids.orgId, sessionToken })
  ).find((b) => b.name === "Imported contractor")!;
  expect(recipient.payoutReviewStatus).toBe("unreviewed");
  await expect(
    t.mutation(api.recipientReviews.decide, {
      changeId: recipient.pendingPayoutChangeId!,
      sessionToken,
      ...proof,
      confirmedIndependently: false,
    }),
  ).rejects.toThrow("independent trusted contact");
  await t.mutation(api.recipientReviews.decide, {
    changeId: recipient.pendingPayoutChangeId!,
    sessionToken,
    ...proof,
  });
  expect(await t.run((ctx) => ctx.db.get(recipient._id))).toMatchObject({
    payoutReviewStatus: "approved",
    payoutVersion: 1,
  });
});

it("retains rejected and withdrawn changes without overwriting approved instructions", async () => {
  const { t, ids, sessionToken, fields } = await setup();
  const { disbursementId } = await t.mutation(api.paymentRuns.create, fields);
  const args = {
    beneficiaryId: ids.beneficiaryId,
    sessionToken,
    beneficiaryAddress: lookalike,
  };
  await t.mutation(api.beneficiaries.update, args);
  await expect(t.mutation(api.beneficiaries.update, args)).rejects.toThrow(
    "already has payout details awaiting review",
  );
  const pending = (
    await t.query(api.recipientReviews.get, {
      beneficiaryId: ids.beneficiaryId,
      sessionToken,
    })
  ).pending!;
  const approver = await signIn(t, "approver");
  await t.mutation(api.recipientReviews.decide, {
    changeId: pending._id,
    sessionToken: approver.sessionToken,
    decision: "rejected",
    reason: "Recipient confirmed these replacement details were not theirs.",
  });
  await expect(
    t.query(api.recipientReviews.assertPayable, {
      disbursementId,
      sessionToken,
    }),
  ).resolves.toBe(true);
  await t.mutation(api.beneficiaries.update, args);
  const next = (
    await t.query(api.recipientReviews.get, {
      beneficiaryId: ids.beneficiaryId,
      sessionToken,
    })
  ).pending!;
  await t.mutation(api.recipientReviews.withdraw, {
    changeId: next._id,
    sessionToken,
    reason:
      "Request entered in error; retained original verified instructions.",
  });
  expect(await t.run((ctx) => ctx.db.get(ids.beneficiaryId))).toMatchObject({
    walletAddress: original,
    payoutVersion: 1,
  });
  expect(
    (
      await t.query(api.recipientReviews.get, {
        beneficiaryId: ids.beneficiaryId,
        sessionToken,
      })
    ).changes
      .map((c) => c.status)
      .sort(),
  ).toEqual(["rejected", "withdrawn"]);
});

it("requires a first review for legacy records and denies cross-organization review access", async () => {
  const { t, ids, sessionToken, fields } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(ids.beneficiaryId, {
      payoutVersion: undefined,
      payoutReviewStatus: undefined,
    }),
  );
  await expect(t.mutation(api.paymentRuns.create, fields)).rejects.toThrow(
    "review needed",
  );
  const outsider = await signIn(t, "viewer");
  await expect(
    t.query(api.recipientReviews.get, {
      beneficiaryId: ids.beneficiaryId,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.recipientReviews.request, {
      beneficiaryId: ids.beneficiaryId,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow();
  await t.mutation(api.recipientReviews.request, {
    beneficiaryId: ids.beneficiaryId,
    sessionToken,
  });
  expect(
    (
      await t.query(api.recipientReviews.get, {
        beneficiaryId: ids.beneficiaryId,
        sessionToken,
      })
    ).pending?.baseVersion,
  ).toBe(0);
});
