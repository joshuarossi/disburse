import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestMembership,
  signIn,
  TEST_WALLETS,
} from "./factories";

describe("OFAC name-screening boundaries", () => {
  it("does not allow an outsider or read-only member to trigger an organization scan", async () => {
    const t = convexTest(schema);
    const ids = await t.run((ctx) =>
      createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
    );
    const outsider = await signIn(t, "nonMember");
    await expect(
      t.action(api.screening.screenAllBeneficiaries, {
        orgId: ids.orgId,
        sessionToken: outsider.sessionToken,
      }),
    ).rejects.toThrow(/member/);
    await expect(
      t.action(api.screening.screenAllBeneficiaries, {
        orgId: ids.orgId,
        sessionToken: "invalid",
      }),
    ).rejects.toThrow();
    const viewer = await signIn(t, "viewer");
    await t.run((ctx) =>
      createTestMembership(ctx, ids.orgId, viewer.userId, { role: "viewer" }),
    );
    await expect(
      t.action(api.screening.screenAllBeneficiaries, {
        orgId: ids.orgId,
        sessionToken: viewer.sessionToken,
      }),
    ).rejects.toThrow(/permission|role|access/i);
    expect(
      await t.run((ctx) => ctx.db.query("screeningResults").collect()),
    ).toEqual([]);
  });
  it("does not label a recipient clear when the underlying list is empty", async () => {
    const t = convexTest(schema);
    await expect(
      t.action(internal.screening.screenName, { name: "Customer Name" }),
    ).rejects.toThrow(/list is unavailable/);
    expect(
      await t.run((ctx) => ctx.db.query("screeningResults").collect()),
    ).toEqual([]);
  });
  it("does not reveal a different organization recipient through the payment screening query", async () => {
    const t = convexTest(schema);
    const first = await t.run((ctx) =>
      createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
    );
    const other = await t.run((ctx) =>
      createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.nonMember }),
    );
    await t.run((ctx) =>
      ctx.db.patch(first.orgId, { screeningEnforcement: "block" }),
    );
    const { sessionToken } = await signIn(t, "admin");
    const recipientId = await t.run((ctx) =>
      createTestBeneficiary(ctx, other.orgId),
    );
    await expect(
      t.query(api.screeningQueries.checkBeneficiaries, {
        orgId: first.orgId,
        sessionToken,
        beneficiaryIds: [recipientId],
      }),
    ).rejects.toThrow(/does not belong/);
    await expect(
      t.mutation(internal.screeningMutations.upsertScreeningResult, {
        orgId: first.orgId,
        beneficiaryId: recipientId,
        status: "clear",
        matches: [],
      }),
    ).rejects.toThrow(/does not belong/);
  });
});
