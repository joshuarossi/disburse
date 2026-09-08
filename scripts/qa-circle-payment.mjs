// The real application approval, fee and settlement APIs. Base Sepolia only.
// --prepare creates a reviewed test payment. --execute sends that original
// payment once; --status only reconciles it. No native gas or provider account.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { createPublicClient, erc20Abi, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import {
  decodeCircleRequest,
  circleRootSigningData,
} from "../shared/circleRequest.ts";
import {
  approvalSigningData,
  nestedSigningData,
} from "../shared/safeSignatures.ts";
import { circleConfiguration } from "../shared/circleExecution.ts";
import { userErrorMessage } from "../src/lib/userErrors.ts";
const run = process.argv.find((a) => a.startsWith("--run="))?.slice(6);
if (!run || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(run))
  throw new Error("Choose --run=name.");
const cancel = process.argv.includes("--cancel");
const receivableId = process.argv
  .find((a) => a.startsWith("--receivable="))
  ?.slice(13);
const prepare = process.argv.includes("--prepare"),
  resume = process.argv.includes("--resume-preparation"),
  execute = process.argv.includes("--execute"),
  resumeApprovals = process.argv.includes("--resume-approvals"),
  status = process.argv.includes("--status");
if (
  [prepare, resume, execute, resumeApprovals, status].filter(Boolean).length !==
  1
)
  throw new Error("Choose preparation, execution or status checking.");
if (
  !process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") ||
  process.env.VITE_CONVEX_URL !== "https://fortunate-cat-122.convex.cloud"
)
  throw new Error(
    "This test only runs against the isolated development backend.",
  );
const directory = ".local/qa/circle-payment";
await mkdir(directory, { recursive: true, mode: 0o700 });
const path = `${directory}/${run}.json`,
  json = (value) =>
    JSON.stringify(
      value,
      (_, item) => (typeof item === "bigint" ? item.toString() : item),
      2,
    );
let saved = await readFile(path, "utf8")
  .then(JSON.parse)
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
if ((prepare && saved) || (!prepare && !saved))
  throw new Error(
    "Use a fresh run for preparation and the saved run for execution or status.",
  );
if (resume && (!saved.disbursementId || saved.executionId))
  throw new Error(
    "Only a saved payment with no execution request can resume preparation.",
  );
const owner = privateKeyToAccount(
  JSON.parse(await readFile(".local/qa/wallet.json", "utf8")).privateKey,
);
const safe = "0x1d724C69fEB3C75Ed33511E3a09aF5b4D0377aB5",
  config = circleConfiguration(84532);
const reader = createPublicClient({
  chain: baseSepolia,
  transport: http(undefined, { timeout: 20000, retryCount: 0 }),
});
const feeSource = () =>
  saved.cancellationId
    ? { cancellationId: saved.cancellationId }
    : { disbursementId: saved.disbursementId };
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
let sessionToken;
const save = async (update) => {
  saved = { ...saved, ...update };
  await writeFile(path, json(saved), { mode: 0o600 });
};
async function balances() {
  const [ownerETH, safeETH, ownerUSDC, safeUSDC] = await Promise.all([
    reader.getBalance({ address: owner.address }),
    reader.getBalance({ address: safe }),
    reader.readContract({
      address: config.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner.address],
    }),
    reader.readContract({
      address: config.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [safe],
    }),
  ]);
  if (ownerETH || safeETH)
    throw new Error(
      "The test requires zero native ETH in both the signer and company account.",
    );
  return { ownerETH, safeETH, ownerUSDC, safeUSDC };
}
try {
  if (
    (await reader.getChainId()) !== 84532 ||
    owner.address.toLowerCase() !== "0x01585228489577cdcdbd5ebb822c7c439a2c564c"
  )
    throw new Error("Unexpected test network or signer.");
  const challenge = await client.mutation(api.auth.generateNonce, {
    walletAddress: owner.address,
  });
  sessionToken = (
    await client.mutation(api.auth.verifySignature, {
      walletAddress: owner.address,
      message: challenge.message,
      signature: await owner.signMessage({ message: challenge.message }),
    })
  ).token;
  if (prepare || resume) {
    if (prepare) {
      await writeFile(
        path,
        json({
          stage: "preparing",
          chainId: 84532,
          safe,
          owner: owner.address,
          kind: cancel ? "cancellation" : "payment",
        }),
        { flag: "wx", mode: 0o600 },
      );
      saved = JSON.parse(await readFile(path, "utf8"));
      const initial = await balances();
      const { orgId } = await client.mutation(api.orgs.create, {
        sessionToken,
        name: `USDC execution QA ${run}`,
      });
      await save({ orgId, initial });
      const { safeId } = await client.action(api.safes.link, {
        orgId,
        sessionToken,
        safeAddress: safe,
        chainId: 84532,
        name: "Payments",
      });
      const invoice = receivableId
        ? await client.query(api.receivables.get, {
            invoiceId: receivableId,
            sessionToken,
          })
        : null;
      if (
        invoice &&
        (invoice.chainId !== 84532 ||
          invoice.tokenAddress.toLowerCase() !== config.token.toLowerCase() ||
          invoice.treasury.toLowerCase() !== safe.toLowerCase() ||
          !invoice.receivingAddress)
      )
        throw new Error(
          "Choose an issued invoice belonging to this test account and USDC network.",
        );
      const { beneficiaryId } = await client.mutation(
        api.beneficiaries.create,
        {
          orgId,
          sessionToken,
          type: "individual",
          name: invoice ? "QA invoice" : "QA wallet",
          beneficiaryAddress: invoice?.receivingAddress ?? owner.address,
          preferredToken: "USDC",
          preferredChainId: 84532,
        },
      );
      const review = await client.query(api.recipientReviews.get, {
        beneficiaryId,
        sessionToken,
      });
      await client.mutation(api.recipientReviews.decide, {
        changeId: review.pending._id,
        sessionToken,
        decision: "approved",
        confirmedIndependently: true,
        verificationMethod: "verified_portal",
        reason:
          "Test recipient verified against the locally held QA wallet signer.",
      });
      const { disbursementId } = await client.mutation(
        api.disbursements.create,
        {
          orgId,
          safeId,
          sessionToken,
          beneficiaryId,
          chainId: 84532,
          token: "USDC",
          amount: "0.1",
          memo: `Customer-paid execution QA ${run}`,
        },
      );
      await save({
        safeId,
        beneficiaryId,
        disbursementId,
        ...(invoice
          ? {
              receivableId: invoice._id,
              receivingAddress: invoice.receivingAddress,
            }
          : {}),
      });
    }
    const disbursementId = saved.disbursementId;
    const identity = { disbursementId, sessionToken };
    await save({ stage: "preparing_approval" });
    const signing = await client.action(
        api.accountApprovals.forSigning,
        identity,
      ),
      approvalPath = signing.paths[0].path;
    await save({ stage: "saving_approval" });
    const signature = await owner.sign({
      hash: approvalSigningData(
        84532,
        approvalPath,
        signing.proposal.safeTransactionData,
      ).hash,
    });
    let safeTxHash = await client.action(api.accountApprovals.save, {
      ...identity,
      proposal: signing.proposal,
      path: approvalPath,
      signature,
    });
    await client.mutation(api.disbursements.updateStatus, {
      ...identity,
      safeTxHash,
      status: "proposed",
    });
    await save({ stage: "quoting", safeTxHash });
    if (saved.kind === "cancellation") {
      const cancellationId = await client.action(
        api.accountCancellations.create,
        identity,
      );
      await save({ cancellationId, paymentSafeTxHash: safeTxHash });
      const c = await client.action(api.accountCancellations.approvals, {
          cancellationId,
          sessionToken,
        }),
        path = c.paths[0].path;
      const signature = await owner.sign({
        hash: approvalSigningData(84532, path, c.proposal.safeTransactionData)
          .hash,
      });
      safeTxHash = c.proposal.safeTxHash;
      await client.action(api.accountCancellations.approve, {
        cancellationId,
        sessionToken,
        safeTxHash,
        path,
        signature,
      });
      await save({ safeTxHash });
    }
    const executionId = await client.action(api.circlePayments.prepare, {
      ...feeSource(),
      sessionToken,
    });
    await save({ executionId });
    const execution = await client.query(api.circlePayments.get, {
        ...feeSource(),
        sessionToken,
      }),
      request = decodeCircleRequest(execution.record);
    if (BigInt(request.permit.amount) > 600000n)
      throw new Error("This test permits at most 0.60 USDC in execution fees.");
    await save({
      stage: "prepared",
      executionId,
      safeTxHash,
      maximumFee: request.permit.amount,
    });
    console.log(
      json({
        stage: "prepared",
        disbursementId,
        executionId,
        maximumFee: request.permit.amount,
        initial: saved.initial,
      }),
    );
  } else if (execute || resumeApprovals) {
    if (saved.stage !== (resumeApprovals ? "approving" : "prepared"))
      throw new Error(
        "This run already attempted execution. Check its status; do not resubmit it.",
      );
    await balances();
    await save({ stage: "approving" });
    const identity = { executionId: saved.executionId, sessionToken };
    for (const stage of ["fee", "operation"]) {
      const execution = await client.query(api.circlePayments.get, {
        ...feeSource(),
        sessionToken,
      });
      if (
        execution.stage === "ready" ||
        (stage === "fee" && execution.stage === "operation")
      )
        continue;
      if (execution.stage !== stage)
        throw new Error("The original approval step changed.");
      const request = decodeCircleRequest(execution.record);
      if (
        request.safe.toLowerCase() !== safe.toLowerCase() ||
        request.originalHash !== saved.safeTxHash ||
        BigInt(request.permit.amount) > 600000n
      )
        throw new Error("The saved payment or fee changed.");
      const approvals = await client.action(
          api.circlePayments.approvals,
          identity,
        ),
        path = approvals.paths[0].path;
      if (approvals.paths[0].approved) {
        await client.action(api.circlePayments.advance, identity);
        continue;
      }
      const signature = await owner.sign({
        hash: nestedSigningData(
          84532,
          path,
          circleRootSigningData(request, stage),
        ).hash,
      });
      await client.action(api.circlePayments.approve, {
        ...identity,
        stage,
        revision: execution.revision,
        path,
        signature,
      });
    }
    await save({ stage: "submitting" });
    await client.action(api.circlePayments.submit, identity);
    await save({ stage: "submitted" });
    console.log(json({ stage: "submitted", executionId: saved.executionId }));
  } else {
    await client.action(api.circlePayments.recheck, {
      executionId: saved.executionId,
      sessionToken,
    });
    const execution = await client.query(api.circlePayments.get, {
      ...feeSource(),
      sessionToken,
    });
    const payment = await client.query(api.disbursements.getWithRecipients, {
      disbursementId: saved.disbursementId,
      sessionToken,
    });
    const cancellation = saved.cancellationId
      ? await client.query(api.accountCancellationData.get, {
          disbursementId: saved.disbursementId,
          sessionToken,
        })
      : null;
    const after = await balances();
    await save({
      result: {
        executionStage: execution.stage,
        paymentStatus: payment.status,
        ...(cancellation
          ? { cancellationStatus: cancellation.cancellation?.status }
          : {}),
        userOpHash: execution.userOpHash,
        txHash: execution.txHash,
        fee: execution.fee,
        after,
      },
    });
    console.log(json(saved.result));
  }
} catch (error) {
  await writeFile(`${path}.error.log`, String(error?.stack ?? error), {
    mode: 0o600,
  });
  console.error(
    json({
      stage: saved?.stage ?? "stopped",
      error: userErrorMessage(
        error,
        "The application test stopped. Inspect the original saved request before continuing.",
      ),
    }),
  );
  process.exitCode = 1;
} finally {
  if (sessionToken)
    await client
      .mutation(api.auth.logout, { token: sessionToken })
      .catch(() => {});
}
