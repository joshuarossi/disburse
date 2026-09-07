import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { isBillOverdue } from "../../shared/dueDate";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  signIn,
  TEST_WALLETS,
} from "./factories";

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const org = await createFullOrgSetup(ctx, {
      walletAddress: TEST_WALLETS.admin,
    });
    const beneficiaryId = await createTestBeneficiary(ctx, org.orgId);
    return { orgId: org.orgId, beneficiaryId };
  });
  const { sessionToken } = await signIn(t, "admin");
  return {
    t,
    args: {
      ...ids,
      sessionToken,
      invoiceNumber: "INV-001",
      amount: "0.1",
      token: "USDC",
      dueDate: Date.now() + 86400000,
    },
  };
}

describe("vendor invoices", () => {
  it("does not mark a bill overdue until the calendar due date has ended", () => {
    const due = Date.UTC(2026, 8, 5);
    expect(isBillOverdue(due, due + 86_399_999)).toBe(false);
    expect(isBillOverdue(due, due + 86_400_000)).toBe(true);
  });
  it("will not pay a bill on a network conflicting with its recipient instructions", async () => {
    const { t, args } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(args.beneficiaryId, {
        preferredChainId: 8453,
        preferredToken: "USDC",
      }),
    );
    const invoiceId = await t.mutation(api.invoices.create, args);
    await expect(
      t.mutation(api.invoices.preparePayment, {
        orgId: args.orgId,
        sessionToken: args.sessionToken,
        invoiceIds: [invoiceId],
        chainId: 11155111,
      }),
    ).rejects.toThrow("different network");
    expect(await t.run((ctx) => ctx.db.get(invoiceId))).not.toHaveProperty(
      "disbursementId",
    );
  });
  it("rejects a duplicate invoice number for the same vendor", async () => {
    const { t, args } = await setup();
    await t.mutation(api.invoices.create, args);
    await expect(
      t.mutation(api.invoices.create, { ...args, invoiceNumber: " inv-001 " }),
    ).rejects.toThrow("already has an invoice");
  });
  it("combines invoices per vendor with exact amounts and prevents a second payment", async () => {
    const { t, args } = await setup();
    const first = await t.mutation(api.invoices.create, args);
    const second = await t.mutation(api.invoices.create, {
      ...args,
      invoiceNumber: "INV-002",
      amount: "0.2",
    });
    const paymentArgs = {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
      invoiceIds: [first, second],
      chainId: 11155111,
      payDate: Date.now() + 86400000,
    };
    const payment = await t.mutation(api.invoices.preparePayment, paymentArgs);
    expect(
      await t.run((ctx) => ctx.db.get(payment.disbursementId)),
    ).toMatchObject({ totalAmount: "0.3", status: "draft" });
    expect(
      await t.run((ctx) => ctx.db.query("disbursementRecipients").collect()),
    ).toHaveLength(1);
    await expect(
      t.mutation(api.invoices.preparePayment, paymentArgs),
    ).rejects.toThrow("already has a payment");
    const invoices = await t.query(api.invoices.list, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
    });
    expect(invoices.every((i) => i.status === "in_payment")).toBe(true);
    await t.run((ctx) =>
      ctx.db.patch(payment.disbursementId, { status: "executed" }),
    );
    expect(
      (
        await t.query(api.invoices.list, {
          orgId: args.orgId,
          sessionToken: args.sessionToken,
        })
      ).every((i) => i.status === "paid"),
    ).toBe(true);
  });
  it("rejects mixed currencies", async () => {
    const { t, args } = await setup();
    const first = await t.mutation(api.invoices.create, args);
    const second = await t.mutation(api.invoices.create, {
      ...args,
      invoiceNumber: "INV-002",
      token: "USDT",
    });
    await expect(
      t.mutation(api.invoices.preparePayment, {
        orgId: args.orgId,
        sessionToken: args.sessionToken,
        invoiceIds: [first, second],
        chainId: 11155111,
        payDate: Date.now() + 86400000,
      }),
    ).rejects.toThrow("same currency");
  });
  it("prevents access by a non-member", async () => {
    const { t, args } = await setup();
    const outsider = await signIn(t, "nonMember");
    await expect(
      t.query(api.invoices.list, {
        orgId: args.orgId,
        sessionToken: outsider.sessionToken,
      }),
    ).rejects.toThrow("Not a member");
  });
});

describe("bill corrections", () => {
  it("supports payment as soon as approved", async () => {
    const { t, args } = await setup();
    const invoiceId = await t.mutation(api.invoices.create, args);
    const { disbursementId } = await t.mutation(api.invoices.preparePayment, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
      invoiceIds: [invoiceId],
      chainId: 11155111,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(disbursementId)))?.scheduledAt,
    ).toBeUndefined();
  });
  it("preserves a voided bill and prevents preparing it for payment", async () => {
    const { t, args } = await setup();
    const invoiceId = await t.mutation(api.invoices.create, args);
    await t.mutation(api.invoices.voidBill, {
      invoiceId,
      sessionToken: args.sessionToken,
    });
    expect(
      (
        await t.query(api.invoices.list, {
          orgId: args.orgId,
          sessionToken: args.sessionToken,
        })
      )[0].status,
    ).toBe("void");
    await expect(
      t.mutation(api.invoices.preparePayment, {
        orgId: args.orgId,
        sessionToken: args.sessionToken,
        invoiceIds: [invoiceId],
        chainId: 11155111,
      }),
    ).rejects.toThrow("voided");
  });
  it("requires cancelling the linked payment before editing or voiding a bill", async () => {
    const { t, args } = await setup();
    const invoiceId = await t.mutation(api.invoices.create, args);
    const { disbursementId } = await t.mutation(api.invoices.preparePayment, {
      orgId: args.orgId,
      sessionToken: args.sessionToken,
      invoiceIds: [invoiceId],
      chainId: 11155111,
    });
    const fields = {
      invoiceId,
      sessionToken: args.sessionToken,
      invoiceNumber: args.invoiceNumber,
      amount: "125",
      token: args.token,
      dueDate: args.dueDate,
    };
    await expect(t.mutation(api.invoices.update, fields)).rejects.toThrow(
      "Cancel the linked",
    );
    await expect(
      t.mutation(api.invoices.voidBill, {
        invoiceId,
        sessionToken: args.sessionToken,
      }),
    ).rejects.toThrow("pending or completed");
    await t.mutation(api.disbursements.updateStatus, {
      disbursementId,
      sessionToken: args.sessionToken,
      status: "cancelled",
    });
    await t.mutation(api.invoices.update, fields);
    expect(await t.run((ctx) => ctx.db.get(invoiceId))).toMatchObject({
      amount: "125",
    });
    expect(await t.run((ctx) => ctx.db.get(disbursementId))).toMatchObject({
      totalAmount: "0.1",
      status: "cancelled",
    });
  });
});
