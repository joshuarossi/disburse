/** Exercise public recipient collection against an isolated development organization. No transfers. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { privateKeyToAccount } from "viem/accounts";
import { api } from "../convex/_generated/api.js";

if (!process.env.CONVEX_DEPLOYMENT?.startsWith("dev:"))
  throw new Error("Development backend only");
const directory = ".local/qa";
const workspace = JSON.parse(
  readFileSync(`${directory}/workspace-report.json`, "utf8"),
);
const { privateKey } = JSON.parse(
  readFileSync(`${directory}/wallet.json`, "utf8"),
);
const owner = privateKeyToAccount(privateKey);
if (
  owner.address !== workspace.wallet ||
  workspace.deployment !== process.env.CONVEX_DEPLOYMENT ||
  workspace.orgId !== "k575vpg8mtsn2126zbswdg4rfd8dvk88"
)
  throw new Error("Wrong isolated QA state");
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
const path = `${directory}/recipient-collection.json`;
const record = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { orgId: workspace.orgId };
if (record.orgId !== workspace.orgId)
  throw new Error("Wrong QA recipient journal");
const save = () =>
  writeFileSync(path, JSON.stringify(record, null, 2), { mode: 0o600 });
if (record.recipientId?.beneficiaryId) {
  record.recipientId = record.recipientId.beneficiaryId;
  save();
}
const { message } = await client.mutation(api.auth.generateNonce, {
  walletAddress: owner.address,
});
const { token: sessionToken } = await client.mutation(
  api.auth.verifySignature,
  {
    walletAddress: owner.address,
    message,
    signature: await owner.signMessage({ message }),
  },
);
try {
  if (process.argv.includes("--verify")) {
    if (!record.recipientId || !record.token)
      throw new Error(
        "Create the QA request and submit the browser form first",
      );
    const review = await client.query(api.recipientReviews.get, {
      beneficiaryId: record.recipientId,
      sessionToken,
    });
    if (
      !review.pending ||
      review.pending.collectionId !== record.requestId ||
      review.pending.proposed.walletAddress.toLowerCase() !==
        owner.address.toLowerCase() ||
      review.pending.proposed.preferredChainId !== 11155111 ||
      review.pending.proposed.preferredToken !== "USDC"
    )
      throw new Error(
        "Browser submission did not match the isolated QA instructions",
      );
    if (
      review.recipient.walletAddress ||
      review.recipient.payoutVersion ||
      review.recipient.payoutReviewStatus === "approved"
    )
      throw new Error("Unreviewed public details became approved instructions");
    const receipt = await client.query(api.recipientCollections.publicRequest, {
      token: record.token,
    });
    if (receipt?.state !== "submitted")
      throw new Error("Submission receipt is missing");
    record.verifiedAt = new Date().toISOString();
    record.changeId = review.pending._id;
    save();
    console.log(
      "PASS: browser submission queued one payout review, kept the unreviewed directory unchanged and persisted its public receipt. No funds moved.",
    );
  } else {
    if (!record.recipientId) {
      const created = await client.mutation(api.beneficiaries.create, {
        orgId: workspace.orgId,
        sessionToken,
        name: "QA Recipient Collection",
        email: "qa-recipient@example.invalid",
        beneficiaryAddress: "",
        allowMissingPaymentDetails: true,
        type: "individual",
        notes:
          "Isolated development form test. Do not pay or independently approve this test record.",
      });
      record.recipientId = created.beneficiaryId;
      save();
    }
    if (!record.token) {
      const link = await client.action(api.recipientCollectionActions.create, {
        beneficiaryId: record.recipientId,
        sessionToken,
        environment: "test",
      });
      Object.assign(record, link, {
        url: `http://127.0.0.1:5173/recipient-details#${link.token}`,
        expectedAddress: owner.address,
      });
      save();
    }
    console.log(
      "PASS: isolated QA detail link prepared. Link and receipt stored in the private QA journal; no messages sent or funds moved.",
    );
  }
} finally {
  await client.mutation(api.auth.logout, { token: sessionToken });
}
