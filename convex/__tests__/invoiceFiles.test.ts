import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestMembership,
  createTestOrg,
  signIn,
  TEST_WALLETS,
} from "./factories";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const source = "%PDF-1.7\nSource invoice fixture\n%%EOF";
async function setup() {
  const t = convexTest(schema);
  const ids = await t.run((ctx) =>
    createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin, plan: "pro" }),
  );
  const admin = await signIn(t, "admin"),
    clerk = await signIn(t, "clerk"),
    viewer = await signIn(t, "viewer"),
    outsider = await signIn(t, "nonMember");
  await t.run((ctx) =>
    createTestMembership(ctx, ids.orgId, clerk.userId, { role: "clerk" }),
  );
  const viewerMembership = await t.run((ctx) =>
    createTestMembership(ctx, ids.orgId, viewer.userId, { role: "viewer" }),
  );
  const beneficiaryId = await t.run((ctx) =>
    createTestBeneficiary(ctx, ids.orgId),
  );
  const upload = (
    overrides: {
      body?: string;
      sessionToken?: string;
      type?: string;
      requestId?: string;
    } = {},
  ) =>
    t.fetch(`/invoice-files?orgId=${ids.orgId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${overrides.sessionToken ?? admin.sessionToken}`,
        "Content-Type": overrides.type ?? "application/pdf",
        "X-File-Name": encodeURIComponent("Supplier café.pdf"),
        "X-Request-Id": overrides.requestId ?? crypto.randomUUID(),
      },
      body: overrides.body ?? source,
    });
  const file = async () => {
    const r = await upload();
    expect(r.status).toBe(200);
    return ((await r.json()) as { fileId: Id<"invoiceFiles"> }).fileId;
  };
  const download = (
    fileId: Id<"invoiceFiles">,
    sessionToken = admin.sessionToken,
  ) =>
    t.fetch(`/invoice-files?fileId=${fileId}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
  const fields = {
    orgId: ids.orgId,
    sessionToken: admin.sessionToken,
    beneficiaryId,
    invoiceNumber: "INV-1042",
    amount: "1250.50",
    token: "USDC",
    dueDate: Date.now() + 86400_000,
  };
  return {
    t,
    ids,
    admin,
    clerk,
    viewer,
    outsider,
    viewerMembership,
    file,
    upload,
    download,
    fields,
  };
}

it("validates file signatures and upload permissions before making private documents available", async () => {
  const { upload, t, viewer, outsider, clerk } = await setup();
  expect((await upload({ body: "<html>fake pdf</html>" })).status).toBe(400);
  expect((await upload({ type: "image/png" })).status).toBe(400);
  expect((await upload({ body: "" })).status).toBe(400);
  expect((await upload({ sessionToken: viewer.sessionToken })).status).toBe(
    400,
  );
  expect((await upload({ sessionToken: outsider.sessionToken })).status).toBe(
    400,
  );
  expect(
    await t.run((ctx) => ctx.db.query("invoiceFiles").collect()),
  ).toHaveLength(0);
  expect((await upload({ sessionToken: clerk.sessionToken })).status).toBe(200);
});

it("recovers a lost upload response with the same receipt, refuses changed retries and discards duplicate blobs", async () => {
  const { t, upload } = await setup();
  const requestId = crypto.randomUUID();
  const first = await (await upload({ requestId })).json();
  expect(await (await upload({ requestId })).json()).toEqual(first);
  expect((await upload({ requestId, body: source + "changed" })).status).toBe(
    400,
  );
  expect(
    await t.run((ctx) => ctx.db.query("invoiceFiles").collect()),
  ).toHaveLength(1);
  expect(
    await t.run((ctx) => ctx.db.system.query("_storage").collect()),
  ).toHaveLength(1);
  expect(JSON.stringify(first)).not.toContain("storageId");
});

it("downloads require current membership; unlinked documents are private to their uploader", async () => {
  const { t, file, download, fields, viewer, viewerMembership, outsider } =
    await setup();
  const fileId = await file();
  expect((await download(fileId, viewer.sessionToken)).status).toBe(403);
  const invoiceId = await t.mutation(api.invoices.create, {
    ...fields,
    sourceFileIds: [fileId],
    sourceReviewed: true,
  });
  const response = await download(fileId, viewer.sessionToken);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(source);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Disposition")).toContain("attachment;");
  expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
  const list = await t.query(api.invoiceFiles.list, {
    invoiceId,
    sessionToken: viewer.sessionToken,
  });
  expect(list).toHaveLength(1);
  expect(JSON.stringify(list)).not.toContain("storageId");
  expect((await download(fileId, outsider.sessionToken)).status).toBe(403);
  await expect(
    t.query(api.invoiceFiles.list, {
      invoiceId,
      sessionToken: outsider.sessionToken,
    }),
  ).rejects.toThrow(/Not a member/);
  await t.run((ctx) => ctx.db.patch(viewerMembership, { status: "removed" }));
  expect((await download(fileId, viewer.sessionToken)).status).toBe(403);
});

it("requires explicit review and binds sources atomically to one bill with the reviewing member and checksum", async () => {
  const { t, file, fields, admin } = await setup();
  const fileId = await file();
  await expect(
    t.mutation(api.invoices.create, { ...fields, sourceFileIds: [fileId] }),
  ).rejects.toThrow(/Review the source document/);
  expect(await t.run((ctx) => ctx.db.query("invoices").collect())).toHaveLength(
    0,
  );
  expect((await t.run((ctx) => ctx.db.get(fileId)))?.invoiceId).toBeUndefined();
  const invoiceId = await t.mutation(api.invoices.create, {
    ...fields,
    sourceFileIds: [fileId],
    sourceReviewed: true,
  });
  expect(await t.run((ctx) => ctx.db.get(invoiceId))).toMatchObject({
    sourceReviewedBy: admin.userId,
    sourceReviewedAt: Date.now(),
  });
  expect(await t.run((ctx) => ctx.db.get(fileId))).toMatchObject({ invoiceId });
  await expect(
    t.mutation(api.invoices.create, {
      ...fields,
      invoiceNumber: "Another bill",
      sourceFileIds: [fileId],
      sourceReviewed: true,
    }),
  ).rejects.toThrow(/unavailable for this bill/);
  const events = await t.run((ctx) => ctx.db.query("auditLog").collect());
  expect(
    events.some(
      (e) =>
        e.action === "invoice.source_reviewed" &&
        JSON.stringify(e.metadata).includes(fileId),
    ),
  ).toBe(true);
});

it("refuses another member or workspace claiming an unlinked source, and prevents expired attachment reuse", async () => {
  const { t, ids, file, fields, clerk, outsider } = await setup();
  const fileId = await file();
  await expect(
    t.mutation(api.invoices.create, {
      ...fields,
      sessionToken: clerk.sessionToken,
      sourceFileIds: [fileId],
      sourceReviewed: true,
    }),
  ).rejects.toThrow(/unavailable/);
  const other = await t.run(async (ctx) => {
    const other = await createTestOrg(ctx, outsider.userId);
    const beneficiaryId = await createTestBeneficiary(ctx, other.orgId);
    return { ...other, beneficiaryId };
  });
  await expect(
    t.mutation(api.invoices.create, {
      ...fields,
      orgId: other.orgId,
      beneficiaryId: other.beneficiaryId,
      sessionToken: outsider.sessionToken,
      sourceFileIds: [fileId],
      sourceReviewed: true,
    }),
  ).rejects.toThrow(/unavailable/);
  await t.run((ctx) => ctx.db.patch(fileId, { expiresAt: Date.now() - 1 }));
  await expect(
    t.mutation(api.invoices.create, {
      ...fields,
      orgId: ids.orgId,
      sourceFileIds: [fileId],
      sourceReviewed: true,
    }),
  ).rejects.toThrow(/unavailable/);
});

it("recovers bill creation after a lost response without a second bill or second source review", async () => {
  const { t, fields, file } = await setup();
  const request = {
    ...fields,
    requestId: crypto.randomUUID(),
    sourceFileIds: [await file()],
    sourceReviewed: true,
  };
  const invoiceId = await t.mutation(api.invoices.create, request);
  expect(await t.mutation(api.invoices.create, request)).toBe(invoiceId);
  await expect(
    t.mutation(api.invoices.create, { ...request, amount: "2500" }),
  ).rejects.toThrow(/already been saved/);
  expect(await t.run((ctx) => ctx.db.query("invoices").collect())).toHaveLength(
    1,
  );
  expect(
    (await t.run((ctx) => ctx.db.query("auditLog").collect())).filter(
      (e) => e.action === "invoice.source_reviewed",
    ),
  ).toHaveLength(1);
});

it("rejects unreviewed or stale edits and retains a saved source after the bill is voided", async () => {
  const { t, file, fields, admin, download } = await setup();
  const fileId = await file();
  const invoiceId = await t.mutation(api.invoices.create, {
    ...fields,
    sourceFileIds: [fileId],
    sourceReviewed: true,
  });
  const update = {
    invoiceId,
    sessionToken: admin.sessionToken,
    invoiceNumber: fields.invoiceNumber,
    amount: "2000",
    token: fields.token,
    dueDate: fields.dueDate,
  };
  await expect(t.mutation(api.invoices.update, update)).rejects.toThrow(
    /Review the source document/,
  );
  expect((await t.run((ctx) => ctx.db.get(invoiceId)))?.amount).toBe("1250.5");
  await expect(
    t.mutation(api.invoices.update, {
      ...update,
      sourceReviewed: true,
      expectedUpdatedAt: Date.now() - 1,
    }),
  ).rejects.toThrow(/changed while/);
  await t.mutation(api.invoices.update, {
    ...update,
    sourceReviewed: true,
    expectedUpdatedAt: Date.now(),
  });
  await t.mutation(api.invoices.voidBill, {
    invoiceId,
    sessionToken: admin.sessionToken,
  });
  expect((await download(fileId)).status).toBe(200);
  await expect(
    t.mutation(internal.invoiceFiles.discard, {
      fileId,
      sessionToken: admin.sessionToken,
    }),
  ).rejects.toThrow(/retained with their invoice or bill/);
});

it("prunes abandoned sources without deleting attached accounting evidence", async () => {
  const { t, file, fields } = await setup();
  const abandoned = await file(),
    attached = await file();
  await t.mutation(api.invoices.create, {
    ...fields,
    sourceFileIds: [attached],
    sourceReviewed: true,
  });
  await t.run((ctx) => ctx.db.patch(abandoned, { expiresAt: Date.now() - 1 }));
  expect(await t.mutation(internal.invoiceFiles.prune, {})).toBe(1);
  expect(await t.run((ctx) => ctx.db.get(abandoned))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(attached))).not.toBeNull();
  expect(
    await t.run((ctx) => ctx.db.system.query("_storage").collect()),
  ).toHaveLength(1);
});
