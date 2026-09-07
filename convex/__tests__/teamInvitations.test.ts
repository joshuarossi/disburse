import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { createFullOrgSetup, signIn, TEST_WALLETS } from "./factories";
import { openEmail, sealEmail } from "../lib/email";
import { getOrgLimits } from "../billing";
import { hashSessionToken } from "../lib/rbac";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("RESEND_API_KEY", "re_unit_test_only");
  vi.stubEnv("EMAIL_FROM", "Disburse <team@example.invalid>");
  vi.stubEnv("PUBLIC_APP_URL", "https://app.example.invalid");
  vi.stubEnv("EMAIL_OUTBOX_KEY", "12".repeat(32));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function setup(plan: "pro" | "starter" | "team" = "pro") {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin, plan }),
  );
  const admin = await signIn(t, "admin"),
    invitee = await signIn(t, "initiator"),
    outsider = await signIn(t, "viewer");
  let sequence = 0;
  const request = (extra = {}) => ({
    orgId: ids.orgId,
    sessionToken: admin.sessionToken,
    requestId: `invitation-request-${++sequence}`,
    email: "Jordan@Example.invalid",
    name: "Jordan Patel",
    role: "initiator" as const,
    ...extra,
  });
  const create = async (args = request()) => {
    const result = await t.action(api.teamInvitationEmail.send, args);
    const row = await t.run((ctx) => ctx.db.get(result.invitationId));
    const delivery = await t.run((ctx) => ctx.db.get(row!.deliveryId!));
    const payload = openEmail(delivery!.sealedPayload!, delivery!.context);
    const token = /\/invite#([a-f0-9]{64})/.exec(payload.text)![1];
    return { args, row: row!, delivery: delivery!, payload, token };
  };
  const accept = (token: string) =>
    t.mutation(api.teamInvitations.accept, {
      token,
      sessionToken: invitee.sessionToken,
      confirmWallet: true,
    });
  return { t, ids, admin, invitee, outsider, request, create, accept };
}

it("creates an encrypted delivery without access, and retries one unchanged invitation request", async () => {
  const { t, ids, admin, create } = await setup();
  const first = await create();
  expect(first.row.tokenHash).toBe(await hashSessionToken(first.token));
  expect(first.delivery.sealedPayload).not.toContain(first.token);
  expect(first.payload.to).toEqual(["jordan@example.invalid"]);
  expect(() =>
    openEmail(first.delivery.sealedPayload!, "another-context"),
  ).toThrow();
  expect(
    await t.run((ctx) => ctx.db.query("orgMemberships").collect()),
  ).toHaveLength(1);
  expect(await t.action(api.teamInvitationEmail.send, first.args)).toEqual({
    invitationId: first.row._id,
  });
  await expect(
    t.action(api.teamInvitationEmail.send, {
      ...first.args,
      email: "changed@example.invalid",
    }),
  ).rejects.toThrow(/request changed/);
  const publicRows = await t.query(api.teamInvitations.list, {
    orgId: ids.orgId,
    sessionToken: admin.sessionToken,
  });
  expect(publicRows).toHaveLength(1);
  expect(JSON.stringify(publicRows)).not.toContain(first.token);
  expect(JSON.stringify(publicRows)).not.toContain(first.row.tokenHash);
  const send = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-message-1" }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", send);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(send).toHaveBeenCalledTimes(1);
  expect(await t.run((ctx) => ctx.db.get(first.delivery._id))).toMatchObject({
    status: "submitted",
    providerId: "provider-message-1",
  });
  expect(
    (await t.run((ctx) => ctx.db.get(first.delivery._id)))?.sealedPayload,
  ).toBeUndefined();
});

it("binds email to the cryptographically authenticated wallet only after explicit acceptance, and rejects other-wallet replay", async () => {
  const { t, ids, invitee, outsider, create, accept } = await setup();
  const invitation = await create();
  await expect(
    t.query(api.orgs.listMembers, {
      orgId: ids.orgId,
      sessionToken: invitee.sessionToken,
    }),
  ).rejects.toThrow(/Not a member/);
  await expect(
    t.mutation(api.teamInvitations.accept, {
      token: invitation.token,
      sessionToken: invitee.sessionToken,
      confirmWallet: false,
    }),
  ).rejects.toThrow(/Confirm/);
  expect(await accept(invitation.token)).toEqual({ orgId: ids.orgId });
  expect(await accept(invitation.token)).toEqual({ orgId: ids.orgId });
  const member = await t.run((ctx) =>
    ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", ids.orgId).eq("userId", invitee.userId),
      )
      .unique(),
  );
  expect(member).toMatchObject({
    email: "jordan@example.invalid",
    emailVerifiedAt: Date.now(),
    role: "initiator",
    status: "active",
  });
  expect(await t.run((ctx) => ctx.db.query("safes").collect())).toHaveLength(1);
  await expect(
    t.mutation(api.teamInvitations.accept, {
      token: invitation.token,
      sessionToken: outsider.sessionToken,
      confirmWallet: true,
    }),
  ).rejects.toThrow(/unavailable/);
  await t.mutation(api.orgs.updateMember, {
    orgId: ids.orgId,
    sessionToken: invitee.sessionToken,
    membershipId: member!._id,
    name: "Jordan Patel",
    email: "replacement@example.invalid",
    role: "initiator",
  });
  expect(
    (await t.run((ctx) => ctx.db.get(member!._id)))?.emailVerifiedAt,
  ).toBeUndefined();
});

it("resending replaces the token and revocation preserves history without leaving a usable link", async () => {
  const { t, ids, admin, create, request, accept } = await setup();
  const first = await create();
  const second = await create(request({ replaces: first.row._id }));
  expect(second.token).not.toBe(first.token);
  expect(
    await t.query(api.teamInvitations.get, { token: first.token }),
  ).toBeNull();
  await expect(accept(first.token)).rejects.toThrow(/unavailable/);
  const revoke = {
    orgId: ids.orgId,
    sessionToken: admin.sessionToken,
    invitationId: second.row._id,
  };
  await t.mutation(api.teamInvitations.revoke, revoke);
  await t.mutation(api.teamInvitations.revoke, revoke);
  expect(
    await t.query(api.teamInvitations.get, { token: second.token }),
  ).toBeNull();
  expect(
    (await t.run((ctx) => ctx.db.get(second.delivery._id)))?.sealedPayload,
  ).toBeUndefined();
  expect(
    await t.run((ctx) => ctx.db.query("teamInvitations").collect()),
  ).toHaveLength(2);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetch).not.toHaveBeenCalled();
});

it("expires email and wallet invitations and invalidates invitations when the inviting administrator loses authority", async () => {
  const { t, ids, admin, invitee, create, accept } = await setup();
  const first = await create();
  await t.run((ctx) =>
    ctx.db.patch(first.row._id, { expiresAt: Date.now() - 1 }),
  );
  expect(
    await t.query(api.teamInvitations.get, { token: first.token }),
  ).toBeNull();
  await expect(accept(first.token)).rejects.toThrow(/unavailable/);
  const second = await create();
  await t.run((ctx) => ctx.db.patch(ids.membershipId, { role: "viewer" }));
  expect(
    await t.query(api.teamInvitations.get, { token: second.token }),
  ).toBeNull();
  await expect(accept(second.token)).rejects.toThrow(/unavailable/);
  await t.run((ctx) => ctx.db.patch(ids.membershipId, { role: "admin" }));
  const wallet = await t.mutation(api.orgs.inviteMember, {
    orgId: ids.orgId,
    sessionToken: admin.sessionToken,
    memberWalletAddress: invitee.walletAddress,
    role: "viewer",
  });
  await t.run((ctx) =>
    ctx.db.patch(wallet.membershipId, { invitationExpiresAt: Date.now() - 1 }),
  );
  await expect(
    t.mutation(api.orgs.acceptInvite, {
      orgId: ids.orgId,
      sessionToken: invitee.sessionToken,
    }),
  ).rejects.toThrow(/expired/);
});

it("does not allow cross-workspace reads, writes or a different wallet when a known wallet was required", async () => {
  const { t, ids, outsider, create, request, accept } = await setup();
  const invitation = await create(
    request({ expectedWallet: outsider.walletAddress }),
  );
  await expect(accept(invitation.token)).rejects.toThrow(/wallet named/);
  await expect(
    t.query(api.teamInvitations.list, {
      orgId: ids.orgId,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow(/Not a member/);
  await expect(
    t.mutation(api.teamInvitations.revoke, {
      orgId: ids.orgId,
      sessionToken: outsider.sessionToken,
      invitationId: invitation.row._id,
    }),
  ).rejects.toThrow(/Not a member/);
  await expect(
    t.action(
      api.teamInvitationEmail.send,
      request({ sessionToken: outsider.sessionToken }),
    ),
  ).rejects.toThrow(/Not a member/);
  expect(
    await t.query(api.teamInvitations.get, { token: "x".repeat(64) }),
  ).toBeNull();
});

it("reserves plan seats across both invitation methods and releases expired email reservations", async () => {
  const { t, ids, admin, create, request, outsider } = await setup("team");
  const limit = await t.run((ctx) => getOrgLimits(ctx, ids.orgId));
  let invitation: Awaited<ReturnType<typeof create>> | undefined;
  for (let i = 1; i < limit.maxUsers; i++)
    invitation = await create(request({ email: `member${i}@example.invalid` }));
  await expect(
    t.action(api.teamInvitationEmail.send, request()),
  ).rejects.toThrow(/seat/);
  await expect(
    t.mutation(api.orgs.inviteMember, {
      orgId: ids.orgId,
      sessionToken: admin.sessionToken,
      memberWalletAddress: outsider.walletAddress,
      role: "viewer",
    }),
  ).rejects.toThrow(/maximum/);
  expect(invitation).toBeDefined();
  await t.run((ctx) =>
    ctx.db.patch(invitation!.row._id, { expiresAt: Date.now() - 1 }),
  );
  await expect(create()).resolves.toBeDefined();
});

it("retries an unconfirmed provider response with the exact encrypted message and idempotency key", async () => {
  const { t, create } = await setup();
  const invitation = await create();
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("Lost response after submission"))
    .mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-recovered" }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", send);
  await t.action(internal.emailDelivery.deliver, {
    deliveryId: invitation.delivery._id,
  });
  expect(
    await t.run((ctx) => ctx.db.get(invitation.delivery._id)),
  ).toMatchObject({ status: "unknown", attempts: 1 });
  await t.action(internal.emailDelivery.deliver, {
    deliveryId: invitation.delivery._id,
  });
  expect(
    await t.run((ctx) => ctx.db.get(invitation.delivery._id)),
  ).toMatchObject({ status: "submitted", attempts: 2 });
  const first = send.mock.calls[0][1],
    second = send.mock.calls[1][1];
  expect(first.body).toEqual(second.body);
  expect(first.headers["Idempotency-Key"]).toBe(
    second.headers["Idempotency-Key"],
  );
  await t.action(internal.emailDelivery.deliver, {
    deliveryId: invitation.delivery._id,
  });
  expect(send).toHaveBeenCalledTimes(2);
});

it("rejects stale delivery workers and stops retries before the provider idempotency window expires", async () => {
  const { t, create } = await setup();
  const { delivery } = await create();
  const first = await t.mutation(internal.emailDeliveryData.claim, {
    deliveryId: delivery._id,
  });
  expect(
    await t.mutation(internal.emailDeliveryData.claim, {
      deliveryId: delivery._id,
    }),
  ).toBeNull();
  vi.setSystemTime(Date.now() + 2 * 60_000 + 1);
  const second = await t.mutation(internal.emailDeliveryData.claim, {
    deliveryId: delivery._id,
  });
  await t.mutation(internal.emailDeliveryData.complete, {
    deliveryId: delivery._id,
    attempt: first!.attempt,
    providerId: "stale-worker",
  });
  expect(
    (await t.run((ctx) => ctx.db.get(delivery._id)))?.providerId,
  ).toBeUndefined();
  await t.mutation(internal.emailDeliveryData.complete, {
    deliveryId: delivery._id,
    attempt: second!.attempt,
    retryable: true,
  });
  vi.setSystemTime(Date.now() + 23 * 3600_000);
  expect(
    await t.mutation(internal.emailDeliveryData.claim, {
      deliveryId: delivery._id,
    }),
  ).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(delivery._id))).toMatchObject({
    status: "unknown",
  });
  expect(
    (await t.run((ctx) => ctx.db.get(delivery._id)))?.sealedPayload,
  ).toBeUndefined();
});

it("verifies delivery webhook signatures, retries early events, rejects forged/replayed events and preserves newer outcomes", async () => {
  const { t, create } = await setup();
  const { delivery } = await create();
  const secret = Buffer.alloc(32, 7);
  vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${secret.toString("base64")}`);
  const signed = (
    type = "email.delivered",
    occurredAt = Date.now(),
    at = Date.now(),
  ) => {
    const id = `event-${type}-${occurredAt}`,
      timestamp = String(Math.floor(at / 1000)),
      payload = JSON.stringify({
        type,
        created_at: new Date(occurredAt).toISOString(),
        data: { email_id: "provider-webhook" },
      });
    const signature = `v1,${createHmac("sha256", secret).update(`${id}.${timestamp}.${payload}`).digest("base64")}`;
    return { id, timestamp, payload, signature };
  };
  const event = signed();
  expect(await t.action(internal.emailDelivery.webhook, event)).toBe(503);
  const claim = await t.mutation(internal.emailDeliveryData.claim, {
    deliveryId: delivery._id,
  });
  await t.mutation(internal.emailDeliveryData.complete, {
    deliveryId: delivery._id,
    attempt: claim!.attempt,
    providerId: "provider-webhook",
  });
  expect(
    await t.action(internal.emailDelivery.webhook, {
      ...event,
      payload: event.payload.replace("delivered", "bounced"),
    }),
  ).toBe(400);
  expect(
    await t.action(
      internal.emailDelivery.webhook,
      signed("email.delivered", Date.now(), Date.now() - 6 * 60_000),
    ),
  ).toBe(400);
  expect(await t.action(internal.emailDelivery.webhook, event)).toBe(200);
  expect(await t.action(internal.emailDelivery.webhook, event)).toBe(200);
  expect(
    await t.action(
      internal.emailDelivery.webhook,
      signed("email.sent", Date.now() - 1000),
    ),
  ).toBe(200);
  expect((await t.run((ctx) => ctx.db.get(delivery._id)))?.status).toBe(
    "delivered",
  );
});

it("requires a configured sender, app origin and encryption key before creating an invitation", async () => {
  const { t, request } = await setup();
  vi.stubEnv("PUBLIC_APP_URL", "https://example.invalid/redirect?to=elsewhere");
  await expect(
    t.action(api.teamInvitationEmail.send, request()),
  ).rejects.toThrow(/application address/);
  vi.stubEnv("PUBLIC_APP_URL", "https://example.invalid");
  vi.stubEnv("EMAIL_OUTBOX_KEY", "");
  await expect(
    t.action(api.teamInvitationEmail.send, request()),
  ).rejects.toThrow(/not available/);
  expect(
    await t.run((ctx) => ctx.db.query("teamInvitations").collect()),
  ).toHaveLength(0);
});

it("retains decryption during a planned delivery-key rotation and rejects tampering", () => {
  const payload = {
    from: "a@example.invalid",
    to: ["b@example.invalid"],
    subject: "Test",
    text: "Private invitation",
    html: "<p>Private invitation</p>",
  };
  const sealed = sealEmail(payload, "context");
  vi.stubEnv("EMAIL_OUTBOX_PREVIOUS_KEY", "12".repeat(32));
  vi.stubEnv("EMAIL_OUTBOX_KEY", "34".repeat(32));
  expect(openEmail(sealed, "context")).toEqual(payload);
  expect(() => openEmail(sealed, "changed-context")).toThrow();
  vi.stubEnv("EMAIL_OUTBOX_PREVIOUS_KEY", "");
  expect(() => openEmail(sealed, "context")).toThrow(/original delivery key/);
});
