import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  signIn,
  TEST_WALLETS,
} from "./factories";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const recipientId = await createTestBeneficiary(ctx, ids.orgId, {
      name: "Maya Chen",
      walletAddress: "0x1111111111111111111111111111111111111111",
    });
    await ctx.db.patch(recipientId, {
      email: "private@example.com",
      notes: "Internal only",
      preferredToken: "USDC",
      preferredChainId: 11155111,
    });
    return { ...ids, recipientId };
  });
  const { sessionToken } = await signIn(t, "admin");
  const args = {
    beneficiaryId: ids.recipientId,
    sessionToken,
    environment: "test" as const,
  };
  const create = () => t.action(api.recipientCollectionActions.create, args);
  const submission = (token: string) => ({
    token,
    walletAddress: "0x2222222222222222222222222222222222222222",
    preferredChainId: 11155111,
    preferredToken: "USDC",
    confirmed: true,
  });
  return { t, ids, args, create, submission };
}

it("issues a hashed, expiring link without disclosing saved payment or personal details", async () => {
  const { t, ids, create } = await setup();
  const link = await create();
  expect(link.token).toMatch(/^[a-f0-9]{64}$/);
  expect(link.expiresAt).toBe(Date.now() + 7 * 86400_000);
  const record = await t.run((ctx) =>
    ctx.db.query("recipientCollections").first(),
  );
  expect(record?.tokenHash).not.toBe(link.token);
  expect(JSON.stringify(record)).not.toContain(link.token);
  const page = await t.query(api.recipientCollections.publicRequest, {
    token: link.token,
  });
  expect(page).toMatchObject({
    state: "requested",
    recipientName: "Maya Chen",
    options: [{ chainId: 11155111 }],
  });
  expect(JSON.stringify(page)).not.toMatch(
    /private@example|Internal only|0x1111111111111111111111111111111111111111/,
  );
  expect(
    await t.query(api.recipientCollections.publicRequest, {
      token: ids.recipientId,
    }),
  ).toBeNull();
  expect(
    await t.query(api.recipientCollections.publicRequest, {
      token: "a".repeat(64),
    }),
  ).toBeNull();
});

it("preserves approved instructions, queues a sourced review and safely replays a lost response", async () => {
  const { t, ids, args, create, submission } = await setup();
  const link = await create();
  await t.mutation(api.recipientCollections.submit, submission(link.token));
  await t.mutation(api.recipientCollections.submit, submission(link.token));
  const saved = await t.run((ctx) => ctx.db.get(ids.recipientId));
  expect(saved).toMatchObject({
    walletAddress: "0x1111111111111111111111111111111111111111",
    payoutVersion: 1,
    payoutReviewStatus: "approved",
  });
  expect(saved?.detailRequestId).toBeUndefined();
  const changes = await t.run((ctx) =>
    ctx.db.query("recipientChanges").collect(),
  );
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    status: "pending",
    collectionId: expect.any(String),
    requestedBy: ids.userId,
    proposed: {
      walletAddress: "0x2222222222222222222222222222222222222222",
      preferredToken: "USDC",
      preferredChainId: 11155111,
    },
  });
  expect(
    await t.query(api.recipientCollections.history, {
      beneficiaryId: ids.recipientId,
      sessionToken: args.sessionToken,
    }),
  ).toMatchObject({ canCreate: false, requests: [{ state: "submitted" }] });
  await expect(
    t.mutation(api.recipientCollections.submit, {
      ...submission(link.token),
      walletAddress: "0x3333333333333333333333333333333333333333",
    }),
  ).rejects.toThrow(/already submitted/);
  await expect(create()).rejects.toThrow(/pending payout/);
  await expect(
    t.mutation(api.recipientReviews.decide, {
      changeId: changes[0]._id,
      sessionToken: args.sessionToken,
      decision: "approved",
      reason: "Link submission alone",
    }),
  ).rejects.toThrow(/independent/);
  await t.mutation(api.recipientReviews.decide, {
    changeId: changes[0]._id,
    sessionToken: args.sessionToken,
    decision: "approved",
    reason: "Confirmed with our established contact on a video call.",
    verificationMethod: "known_contact",
    confirmedIndependently: true,
  });
  expect(
    await t.query(api.recipientCollections.publicRequest, {
      token: link.token,
    }),
  ).toMatchObject({ state: "approved" });
  expect(await t.run((ctx) => ctx.db.get(ids.recipientId))).toMatchObject({
    walletAddress: "0x2222222222222222222222222222222222222222",
    payoutVersion: 2,
  });
});

it("revokes replaced links and rejects explicit revocation or expiry without leaking recipient data", async () => {
  const { t, args, ids, create, submission } = await setup();
  const first = await create();
  vi.advanceTimersByTime(1000);
  const second = await create();
  expect(
    await t.query(api.recipientCollections.publicRequest, {
      token: first.token,
    }),
  ).toEqual({ state: "revoked" });
  await expect(
    t.mutation(api.recipientCollections.submit, submission(first.token)),
  ).rejects.toThrow(/no longer available/);
  const history = await t.query(api.recipientCollections.history, {
    beneficiaryId: ids.recipientId,
    sessionToken: args.sessionToken,
  });
  await t.mutation(api.recipientCollections.revoke, {
    requestId: history.requests[0].id,
    sessionToken: args.sessionToken,
  });
  await t.mutation(api.recipientCollections.revoke, {
    requestId: history.requests[0].id,
    sessionToken: args.sessionToken,
  });
  expect(
    await t.query(api.recipientCollections.publicRequest, {
      token: second.token,
    }),
  ).toEqual({ state: "revoked" });
  const third = await create();
  vi.advanceTimersByTime(7 * 86400_000);
  expect(
    await t.query(api.recipientCollections.publicRequest, {
      token: third.token,
    }),
  ).toEqual({ state: "expired" });
  await expect(
    t.mutation(api.recipientCollections.submit, submission(third.token)),
  ).rejects.toThrow(/no longer available/);
});

it("invalidates links after recipient edits, account archival or requester access removal", async () => {
  for (const change of ["recipient", "account", "member"] as const) {
    const { t, ids, create, submission } = await setup();
    const link = await create();
    await t.run(async (ctx) => {
      if (change === "recipient")
        await ctx.db.patch(ids.recipientId, { name: "Changed recipient" });
      if (change === "account")
        await ctx.db.patch(ids.safeId, { isActive: false });
      if (change === "member")
        await ctx.db.patch(ids.membershipId, { status: "removed" });
    });
    const page = await t.query(api.recipientCollections.publicRequest, {
      token: link.token,
    });
    expect(page).toEqual({
      state: change === "recipient" ? "changed" : "unavailable",
    });
    await expect(
      t.mutation(api.recipientCollections.submit, submission(link.token)),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("recipientChanges").collect()),
    ).toHaveLength(0);
  }
});

it("requires an allowed network, canonical currency, nonzero address and recipient confirmation", async () => {
  const { t, create, submission } = await setup();
  const { token } = await create();
  for (const fields of [
    { preferredChainId: 8453 },
    { preferredToken: "FAKE" },
    { preferredToken: "" },
    { walletAddress: "0x0000000000000000000000000000000000000000" },
    { walletAddress: "not-an-address" },
    { confirmed: false },
  ]) {
    await expect(
      t.mutation(api.recipientCollections.submit, {
        ...submission(token),
        ...fields,
      }),
    ).rejects.toThrow();
  }
  expect(
    await t.query(api.recipientCollections.publicRequest, { token }),
  ).toMatchObject({ state: "requested" });
  expect(
    await t.run((ctx) => ctx.db.query("recipientChanges").collect()),
  ).toHaveLength(0);
});

it("checks generation, history and revocation roles and organization boundaries", async () => {
  const { t, ids, args, create } = await setup();
  const link = await create();
  const [record] = await t.run((ctx) =>
    ctx.db.query("recipientCollections").collect(),
  );
  const other = await t.run(async (ctx) => {
    const ids = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.clerk,
    });
    return createTestBeneficiary(ctx, ids.orgId);
  });
  await expect(
    t.action(api.recipientCollectionActions.create, {
      ...args,
      beneficiaryId: other,
    }),
  ).rejects.toThrow(/Not a member/);
  await expect(
    t.query(api.recipientCollections.history, {
      sessionToken: args.sessionToken,
      beneficiaryId: other,
    }),
  ).rejects.toThrow(/Not a member/);
  const otherSession = await signIn(t, "clerk");
  await expect(
    t.mutation(api.recipientCollections.revoke, {
      requestId: record._id,
      sessionToken: otherSession.sessionToken,
    }),
  ).rejects.toThrow(/Not a member/);
  await t.run((ctx) => ctx.db.patch(ids.membershipId, { role: "viewer" }));
  await expect(create()).rejects.toThrow(/Insufficient permissions/);
  await expect(
    t.mutation(api.recipientCollections.revoke, {
      requestId: record._id,
      sessionToken: args.sessionToken,
    }),
  ).rejects.toThrow(/Insufficient permissions/);
  expect(
    await t.query(api.recipientCollections.publicRequest, {
      token: link.token,
    }),
  ).toEqual({ state: "unavailable" });
});
