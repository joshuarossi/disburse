import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  createTestMembership,
  signIn,
  TEST_WALLETS,
} from "./factories";
import { paymentFollowup } from "../../shared/paymentFollowup";

const rpc = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  readContract: vi.fn(),
  identity: vi.fn(),
}));
vi.mock("../lib/safeVerification", async (original) => ({
  ...(await original<typeof import("../lib/safeVerification")>()),
  getChainClient: () => rpc,
}));
vi.mock("../lib/safeIdentity", () => ({ assertSafeIdentity: rpc.identity }));
const DAY = 86400_000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 6, 12));
  rpc.getBlockNumber.mockResolvedValue(123n);
  rpc.readContract.mockResolvedValue([TEST_WALLETS.approver]);
  rpc.identity.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin, plan: "pro" }),
  );
  const admin = await signIn(t, "admin"),
    approver = await signIn(t, "approver"),
    outsider = await signIn(t, "nonMember");
  const memberId = await t.run((ctx) =>
    createTestMembership(ctx, ids.orgId, approver.userId, { role: "approver" }),
  );
  const beneficiaryId = await t.run((ctx) =>
    createTestBeneficiary(ctx, ids.orgId),
  );
  const paymentId = await t.run(async (ctx) => {
    const id = await createTestDisbursement(
      ctx,
      ids.orgId,
      ids.safeId,
      beneficiaryId,
      ids.userId,
    );
    await ctx.db.patch(id, {
      scheduledAt: Date.now() + 2 * DAY,
      followupAt: Date.now(),
      name: "Payroll",
    });
    return id;
  });
  const list = (
    sessionToken = admin.sessionToken,
    environment: "test" | "production" = "test",
  ) =>
    t.query(api.paymentFollowups.list, {
      orgId: ids.orgId,
      sessionToken,
      environment,
    });
  const claim = async () => {
    await t.mutation(internal.paymentFollowups.due, {});
    const p = await t.run((ctx) => ctx.db.get(paymentId));
    return { disbursementId: paymentId, attempt: p!.followupAttempt! };
  };
  const process = async () => {
    const attempt = await claim();
    await t.action(internal.paymentFollowupChecks.process, attempt);
    return attempt;
  };
  const wake = () =>
    t.run((ctx) => ctx.db.patch(paymentId, { followupAt: Date.now() }));
  return {
    t,
    ids,
    admin,
    approver,
    outsider,
    memberId,
    paymentId,
    beneficiaryId,
    list,
    claim,
    process,
    wake,
  };
}

it("opens at three days, escalates at 24 hours and the exact pay deadline, with settlement grace periods", () => {
  const payAt = Date.now() + 4 * DAY;
  const decide = (status: string, now: number) =>
    paymentFollowup({ status, scheduledAt: payAt }, now);
  expect(decide("draft", payAt - 3 * DAY - 1)).toMatchObject({
    phase: null,
    nextAt: payAt - 3 * DAY,
  });
  expect(decide("draft", payAt - 3 * DAY)).toMatchObject({
    phase: "review",
    nextAt: payAt - DAY,
  });
  expect(decide("proposed", payAt - DAY)).toMatchObject({
    phase: "due_soon",
    nextAt: payAt,
  });
  expect(decide("pending", payAt)).toMatchObject({ phase: "approval_late" });
  expect(decide("scheduled", payAt + 5 * 60000 - 1).phase).toBeNull();
  expect(decide("scheduled", payAt + 5 * 60000).phase).toBe("payment_late");
  expect(decide("relaying", payAt + 10 * 60000 - 1).phase).toBeNull();
  expect(decide("relaying", payAt + 10 * 60000).phase).toBe(
    "settlement_delayed",
  );
  for (const status of ["executed", "cancelled"])
    expect(decide(status, payAt + DAY)).toMatchObject({
      phase: null,
      nextAt: 0,
    });
  expect(paymentFollowup({ status: "draft" }, payAt).nextAt).toBe(0);
  expect(decide("failed", payAt).phase).toBe("failed");
  expect(decide("pending", payAt).revisionKey).not.toBe(
    decide("pending", payAt + DAY).revisionKey,
  );
});

it("verifies live account identity at one block, assigns current approvers and never creates or sends a payment", async () => {
  const { t, paymentId, approver, list, process } = await setup();
  await process();
  expect(rpc.identity).toHaveBeenCalledWith(
    rpc,
    expect.any(String),
    11155111,
    123n,
  );
  expect(rpc.readContract).toHaveBeenCalledWith(
    expect.objectContaining({ functionName: "getOwners", blockNumber: 123n }),
  );
  expect((await list(approver.sessionToken)).items[0]).toMatchObject({
    phase: "review",
    unread: true,
    assigned: true,
    disbursementId: paymentId,
  });
  expect(
    await t.run((ctx) => ctx.db.query("disbursements").collect()),
  ).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.get(paymentId))).toMatchObject({
    status: "draft",
    followupAt: Date.now() + 3600_000,
  });
  expect(
    await t.run((ctx) => ctx.db.query("relayJobs").collect()),
  ).toHaveLength(0);
  expect(
    await t.run((ctx) => ctx.db.query("emailDeliveries").collect()),
  ).toHaveLength(0);
});

it("leases work, refuses old attempts and retries a payment changed while its account was checked", async () => {
  const { t, paymentId, claim } = await setup();
  const first = await claim();
  expect(await t.mutation(internal.paymentFollowups.due, {})).toBe(0);
  const source = await t.query(internal.paymentFollowups.context, first);
  vi.setSystemTime(Date.now() + 120001);
  const second = await claim();
  expect(second.attempt).toBe(first.attempt + 1);
  expect(await t.query(internal.paymentFollowups.context, first)).toBeNull();
  const record = {
    ...second,
    inputKey: source!.inputKey,
    phase: source!.decision.phase,
    owners: [TEST_WALLETS.approver],
    ownershipBlock: "123",
  };
  await t.run((ctx) =>
    ctx.db.patch(paymentId, { scheduledAt: Date.now() + 10 * DAY }),
  );
  expect(await t.mutation(internal.paymentFollowups.record, record)).toBe(
    false,
  );
  expect((await t.run((ctx) => ctx.db.get(paymentId)))?.followupAt).toBe(
    Date.now(),
  );
  expect(
    await t.run((ctx) => ctx.db.query("paymentNotifications").collect()),
  ).toHaveLength(0);
});

it("rejects a skipped account check if the review window opens while a worker is running", async () => {
  const { t, paymentId, claim } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(paymentId, { scheduledAt: Date.now() + 3 * DAY + 1000 }),
  );
  const attempt = await claim(),
    source = await t.query(internal.paymentFollowups.context, attempt);
  expect(source!.decision.phase).toBeNull();
  vi.setSystemTime(Date.now() + 1001);
  expect(
    await t.mutation(internal.paymentFollowups.record, {
      ...attempt,
      inputKey: source!.inputKey,
      phase: null,
      owners: [],
    }),
  ).toBe(false);
  expect(
    await t.run((ctx) => ctx.db.query("paymentNotifications").collect()),
  ).toHaveLength(0);
  await expect(
    t.mutation(internal.paymentFollowups.record, {
      ...attempt,
      inputKey: source!.inputKey,
      phase: "review",
      owners: [],
    }),
  ).rejects.toThrow(/verified/);
});

it("preserves unavailable ownership as an error, retries it, then assigns newly verified owners", async () => {
  const { list, process, approver, wake } = await setup();
  rpc.getBlockNumber.mockRejectedValueOnce(new Error("RPC down"));
  await process();
  const failed = (await list()).items[0];
  expect(failed.ownershipError).toMatch(/could not be verified/);
  expect((await list(approver.sessionToken)).items[0].assigned).toBe(false);
  await wake();
  await process();
  const recovered = (await list(approver.sessionToken)).items[0];
  expect(recovered).toMatchObject({
    assigned: true,
    unread: true,
    revision: failed.revision + 1,
  });
  expect(recovered.ownershipError).toBeUndefined();
});

it("keeps read receipts personal and idempotent, reopens at escalation, and rejects stale acknowledgements", async () => {
  const { t, list, process, admin, approver, wake } = await setup();
  await process();
  const n = (await list()).items[0];
  const read = {
    notificationId: n.id,
    revision: n.revision,
    sessionToken: admin.sessionToken,
  };
  await t.mutation(api.paymentFollowups.markRead, read);
  await t.mutation(api.paymentFollowups.markRead, read);
  expect((await list()).items[0].unread).toBe(false);
  expect((await list(approver.sessionToken)).items[0].unread).toBe(true);
  expect(
    await t.run((ctx) => ctx.db.query("paymentNotificationReads").collect()),
  ).toHaveLength(1);
  await wake();
  await process();
  expect((await list()).items[0].revision).toBe(n.revision);
  vi.setSystemTime(Date.now() + DAY);
  await process();
  const nextAdmin = await signIn(t, "admin");
  const escalated = (await list(nextAdmin.sessionToken)).items[0];
  expect(escalated).toMatchObject({
    phase: "due_soon",
    unread: true,
    revision: n.revision + 1,
  });
  expect(
    await t.mutation(api.paymentFollowups.markRead, {
      ...read,
      sessionToken: nextAdmin.sessionToken,
    }),
  ).toBe(false);
});

it("hides resolved payments immediately, keeps activity environments separate and rejects cross-workspace access", async () => {
  const { t, list, process, paymentId, outsider } = await setup();
  await process();
  const n = (await list()).items[0];
  expect((await list(undefined, "production")).items).toHaveLength(0);
  await expect(list(outsider.sessionToken)).rejects.toThrow(/Not a member/);
  await expect(
    t.mutation(api.paymentFollowups.markRead, {
      notificationId: n.id,
      revision: n.revision,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow(/Not a member/);
  await t.run((ctx) => ctx.db.patch(paymentId, { status: "cancelled" }));
  expect((await list()).items).toHaveLength(0);
  await t.run((ctx) => ctx.db.patch(paymentId, { status: "executed" }));
  expect((await list()).items).toHaveLength(0);
});

it("removes assignment immediately when app permission is removed, and refreshes changed on-chain owners", async () => {
  const { t, list, process, memberId, approver, wake } = await setup();
  await process();
  await t.run((ctx) => ctx.db.patch(memberId, { role: "viewer" }));
  expect((await list(approver.sessionToken)).items[0]).toMatchObject({
    assigned: false,
    unread: false,
  });
  await t.run((ctx) => ctx.db.patch(memberId, { role: "approver" }));
  rpc.readContract.mockResolvedValue([TEST_WALLETS.admin]);
  await wake();
  await process();
  expect((await list(approver.sessionToken)).items[0]).toMatchObject({
    assigned: false,
    unread: false,
  });
});

it("backfills historical dated payments once and does not continually scan completed records", async () => {
  const { t, paymentId, claim } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(paymentId, { followupAt: undefined, status: "executed" }),
  );
  await claim();
  expect(await t.run((ctx) => ctx.db.get(paymentId))).toMatchObject({
    followupAt: 0,
  });
  expect(await t.mutation(internal.paymentFollowups.due, {})).toBe(0);
});

it("flags missed recurring preparation once, with no backlog or payment submission", async () => {
  const { t, ids, beneficiaryId, list } = await setup();
  const seriesId = await t.run((ctx) =>
    ctx.db.insert("recurringPayments", {
      orgId: ids.orgId,
      chainId: 11155111,
      name: "Monthly payroll",
      token: "USDC",
      cadence: "monthly",
      anchorDay: 1,
      nextPayDate: Date.now() - DAY,
      recipients: [{ beneficiaryId, amount: "100" }],
      purpose: "payroll",
      status: "active",
      version: 1,
      createdBy: ids.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await t.mutation(internal.paymentRuns.prepareNext, {
    recurringPaymentId: seriesId,
    version: 1,
  });
  await t.mutation(internal.paymentRuns.prepareNext, {
    recurringPaymentId: seriesId,
    version: 1,
  });
  expect((await list()).items[0]).toMatchObject({
    phase: "schedule_paused",
    recurringPaymentId: seriesId,
    assigned: true,
  });
  expect(
    await t.run((ctx) => ctx.db.query("paymentNotifications").collect()),
  ).toHaveLength(1);
  expect(
    await t.run((ctx) => ctx.db.query("disbursements").collect()),
  ).toHaveLength(1);
  await t.run((ctx) =>
    ctx.db.patch(seriesId, { status: "active", pauseReason: undefined }),
  );
  expect((await list()).items).toHaveLength(0);
});
