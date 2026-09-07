/** Real authenticated dev-backend QA, isolated from existing organizations. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

if (
  !process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") ||
  !process.env.VITE_CONVEX_URL
) {
  throw new Error(
    "Requires an explicitly configured development Convex deployment",
  );
}
const directory = ".local/qa";
if (!existsSync(`${directory}/wallet.json`))
  throw new Error(
    "Run bun run qa:testnet first to create the isolated QA wallet",
  );
const { privateKey } = JSON.parse(
  readFileSync(`${directory}/wallet.json`, "utf8"),
);
const wallet = privateKeyToAccount(privateKey);
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
const path = `${directory}/workspace-report.json`;
const report = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : {
      wallet: wallet.address,
      deployment: process.env.CONVEX_DEPLOYMENT,
      checks: [],
    };
if (
  report.wallet !== wallet.address ||
  report.deployment !== process.env.CONVEX_DEPLOYMENT
)
  throw new Error("QA state belongs to another wallet or deployment");
report.checks = [];
const save = () => writeFileSync(path, JSON.stringify(report, null, 2));
const passed = (name) => {
  report.checks.push({ name, status: "passed" });
  save();
  console.log(`PASS ${name}`);
};
const rejected = async (name, work, expected) => {
  try {
    await work();
  } catch (error) {
    if (!expected.test(String(error)))
      throw new Error(`${name}: received an unexpected error`);
    passed(name);
    return;
  }
  throw new Error(`${name}: unexpectedly accepted`);
};
const nonce = await client.mutation(api.auth.generateNonce, {
  walletAddress: wallet.address,
});
const signature = await wallet.signMessage({ message: nonce.message });
const session = await client.mutation(api.auth.verifySignature, {
  walletAddress: wallet.address,
  signature,
  message: nonce.message,
});
const sessionToken = session.token;
try {
  const verified = await client.query(api.auth.validateSession, {
    token: sessionToken,
  });
  if (verified?.walletAddress !== wallet.address.toLowerCase())
    throw new Error("Session identity mismatch");
  passed("SIWE signature establishes the correct identity");
  await rejected(
    "SIWE nonce cannot be replayed",
    () =>
      client.mutation(api.auth.verifySignature, {
        walletAddress: wallet.address,
        signature,
        message: nonce.message,
      }),
    /nonce/i,
  );
  if (!report.orgId) {
    const { orgId } = await client.mutation(api.orgs.create, {
      sessionToken,
      name: "Disburse QA · Sepolia only",
    });
    report.orgId = orgId;
    save();
  }
  const scope = { orgId: report.orgId, sessionToken };
  await client.query(api.orgs.listMembers, scope);
  passed("Isolated workspace membership authenticates");
  await rejected(
    "Unauthenticated workspace access is denied",
    () =>
      client.query(api.orgs.listMembers, {
        ...scope,
        sessionToken: "invalid-qa-session-token",
      }),
    /session|auth/i,
  );
  if (!report.beneficiaryIds) {
    const imported = await client.mutation(api.beneficiaries.createBulk, {
      ...scope,
      allowMissingPaymentDetails: true,
      beneficiaries: [
        {
          type: "individual",
          name: "QA Employee Complete",
          email: "complete@example.invalid",
          beneficiaryAddress: wallet.address,
          preferredChainId: 11155111,
          preferredToken: "USDC",
        },
        {
          type: "individual",
          name: "QA Employee Details Needed",
          email: "incomplete@example.invalid",
          beneficiaryAddress: "",
        },
      ],
    });
    if (imported.count !== 2)
      throw new Error("Import did not create both recipients");
    report.beneficiaryIds = imported.beneficiaryIds;
    save();
  }
  passed("Employee import accepts complete and identity-only records");
  const invoice = {
    ...scope,
    beneficiaryId: report.beneficiaryIds[0],
    invoiceNumber: "QA-EXACT-0001",
    amount: "1.000001",
    token: "USDC",
    dueDate: Date.now() + 86400000,
  };
  if (!report.invoiceId) {
    report.invoiceId = await client.mutation(api.invoices.create, invoice);
    save();
  }
  const invoices = await client.query(api.invoices.list, scope);
  if (
    !invoices.some((i) => i._id === report.invoiceId && i.amount === "1.000001")
  )
    throw new Error("Invoice amount lost precision");
  passed("Invoice persists all six decimal places");
  await rejected(
    "Duplicate invoice number is rejected",
    () => client.mutation(api.invoices.create, invoice),
    /already|duplicate/i,
  );
  await rejected(
    "Negative invoice is rejected",
    () =>
      client.mutation(api.invoices.create, {
        ...invoice,
        invoiceNumber: "QA-INVALID",
        amount: "-1",
      }),
    /amount|positive|decimal/i,
  );
  await rejected(
    "Invalid recipient address is rejected",
    () =>
      client.mutation(api.beneficiaries.create, {
        ...scope,
        type: "individual",
        name: "QA Invalid",
        beneficiaryAddress: "0x123",
      }),
    /address/i,
  );
  report.checkedAt = new Date().toISOString();
  save();
} finally {
  await client.mutation(api.auth.logout, { token: sessionToken });
  if (
    (await client.query(api.auth.validateSession, { token: sessionToken })) !==
    null
  )
    throw new Error("Logout did not revoke the session");
  passed("Logout revokes the session");
}
