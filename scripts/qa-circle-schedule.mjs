// Real scheduled-payment APIs, Base Sepolia only. Journals are exclusive and
// never contain wallet keys or application sessions. Each submission is saved
// before POST; --status only recovers the original operation.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { createPublicClient, erc20Abi, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import { circleConfiguration } from "../shared/circleExecution.ts";
import {
  circleRootSigningData,
  decodeCircleRequest,
} from "../shared/circleRequest.ts";
import { nestedSigningData } from "../shared/safeSignatures.ts";
import { assertPaymentIntent } from "../shared/paymentIntent.ts";
import { userErrorMessage } from "../src/lib/userErrors.ts";
const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const run = option("run"),
  sharedRun = option("share-with"),
  mode = ["prepare", "approve", "arm", "cancel", "status"].filter((s) =>
    process.argv.includes(`--${s}`),
  );
if (
  !run ||
  !/^[a-z0-9-]{1,40}$/.test(run) ||
  (sharedRun && !/^[a-z0-9-]{1,40}$/.test(sharedRun)) ||
  mode.length !== 1
)
  throw new Error("Choose a unique run and one operation.");
if (
  !process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") ||
  process.env.VITE_CONVEX_URL !== "https://fortunate-cat-122.convex.cloud"
)
  throw new Error("Use the isolated development backend.");
const directory = ".local/qa/circle-schedule";
await mkdir(directory, { recursive: true, mode: 0o700 });
const filename = `${directory}/${run}.json`,
  json = (x) =>
    JSON.stringify(x, (_, v) => (typeof v === "bigint" ? String(v) : v), 2);
let saved = await readFile(filename, "utf8")
  .then(JSON.parse)
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
if (mode[0] === "prepare" ? !!saved : !saved)
  throw new Error("Prepare a fresh run, or resume its saved journal.");
const owner = privateKeyToAccount(
  JSON.parse(await readFile(".local/qa/wallet.json", "utf8")).privateKey,
);
const safe = "0x1d724C69fEB3C75Ed33511E3a09aF5b4D0377aB5",
  config = circleConfiguration(84532);
const reader = createPublicClient({
  chain: baseSepolia,
  transport: http(undefined, { retryCount: 0, timeout: 20000 }),
});
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
const save = async (update) => {
  saved = { ...saved, ...update };
  await writeFile(filename, json(saved), { mode: 0o600 });
};
const balances = async () => {
  const [ownerETH, safeETH, ownerUSDC, safeUSDC, safeNonce] = await Promise.all(
    [
      reader.getBalance({ address: owner.address }),
      reader.getBalance({ address: safe }),
      ...[owner.address, safe].map((address) =>
        reader.readContract({
          address: config.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
      ),
      reader.readContract({
        address: safe,
        abi: parseAbi(["function nonce() view returns(uint256)"]),
        functionName: "nonce",
      }),
    ],
  );
  if (ownerETH || safeETH)
    throw new Error("Both test accounts must hold zero native ETH.");
  return { ownerETH, safeETH, ownerUSDC, safeUSDC, safeNonce };
};
let sessionToken;
try {
  if (
    (await reader.getChainId()) !== 84532 ||
    owner.address.toLowerCase() !== "0x01585228489577cdcdbd5ebb822c7c439a2c564c"
  )
    throw new Error("Unexpected test signer or network.");
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
  if (mode[0] === "prepare") {
    const minutes = Number(option("minutes") ?? 5);
    if (!Number.isInteger(minutes) || minutes < 2 || minutes > 1440)
      throw new Error("Choose a test date from two minutes to one day ahead.");
    await writeFile(filename, json({ stage: "preparing" }), {
      flag: "wx",
      mode: 0o600,
    });
    saved = { stage: "preparing" };
    const initial = await balances();
    let orgId, safeId, beneficiaryId;
    if (sharedRun) {
      const original = JSON.parse(
        await readFile(`${directory}/${sharedRun}.json`, "utf8"),
      );
      ({ orgId, safeId, beneficiaryId } = original);
      if (
        original.safe !== safe ||
        original.owner !== owner.address ||
        !orgId ||
        !safeId ||
        !beneficiaryId
      )
        throw new Error(
          "The shared test workspace does not match this account.",
        );
    } else {
      ({ orgId } = await client.mutation(api.orgs.create, {
        sessionToken,
        name: `Scheduled USDC QA ${run}`,
      }));
      ({ safeId } = await client.action(api.safes.link, {
        orgId,
        sessionToken,
        safeAddress: safe,
        chainId: 84532,
        name: "Payments",
      }));
      ({ beneficiaryId } = await client.mutation(api.beneficiaries.create, {
        orgId,
        sessionToken,
        type: "individual",
        name: "QA wallet",
        beneficiaryAddress: owner.address,
        preferredToken: "USDC",
        preferredChainId: 84532,
      }));
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
        reason: "Verified against the locally held test wallet.",
      });
    }
    await save({
      orgId,
      safeId,
      beneficiaryId,
      safe,
      owner: owner.address,
      initial,
    });
    const payAt = Date.now() + minutes * 60000;
    const { disbursementId } = await client.mutation(api.disbursements.create, {
      orgId,
      safeId,
      beneficiaryId,
      sessionToken,
      chainId: 84532,
      token: "USDC",
      amount: "0.1",
      memo: `Scheduled QA ${run}`,
      scheduledAt: payAt,
    });
    await save({ disbursementId, payAt });
    const scheduleId = await client.mutation(api.paymentSchedules.create, {
      disbursementId,
      sessionToken,
    });
    await save({ scheduleId });
    const executionId = await client.action(api.circlePayments.prepare, {
      paymentScheduleId: scheduleId,
      sessionToken,
    });
    await save({ executionId, stage: "prepared" });
    console.log(
      json({
        stage: "prepared",
        scheduleId,
        executionId,
        payAt: new Date(payAt).toISOString(),
        initial,
      }),
    );
  } else if (mode[0] === "approve") {
    if (!["prepared", "approving"].includes(saved.stage))
      throw new Error("This request has already been approved or submitted.");
    await save({ stage: "approving" });
    for (const stage of ["fee", "operation"]) {
      const execution = await client.query(api.circlePayments.get, {
        paymentScheduleId: saved.scheduleId,
        sessionToken,
      });
      if (
        execution.stage === "ready" ||
        (stage === "fee" && execution.stage === "operation")
      )
        continue;
      if (execution.stage !== stage || !execution.concurrentFees)
        throw new Error("The expected queued request is unavailable.");
      const request = decodeCircleRequest(execution.record);
      if (
        request.safe.toLowerCase() !== safe.toLowerCase() ||
        request.validAfter !== Math.ceil(saved.payAt / 1000) ||
        request.validUntil !== request.validAfter + 86400 ||
        request.operation.nonce >> 64n === 0n ||
        BigInt(request.permit.amount) > 2000000n
      )
        throw new Error(
          "The scheduled intent or fee exceeds this test authorization.",
        );
      assertPaymentIntent(
        {
          ...request.transaction,
          value: "0",
          operation: request.transaction.operation ?? 0,
        },
        {
          token: "USDC",
          tokenAddress: config.token,
          recipients: [{ recipientAddress: owner.address, amount: "0.1" }],
        },
        [],
      );
      const identity = { executionId: execution._id, sessionToken },
        approvals = await client.action(api.circlePayments.approvals, identity),
        path = approvals.paths[0].path;
      await client.action(api.circlePayments.approve, {
        ...identity,
        stage,
        revision: execution.revision,
        path,
        signature: await owner.sign({
          hash: nestedSigningData(
            84532,
            path,
            circleRootSigningData(request, stage),
          ).hash,
        }),
      });
    }
    await save({ stage: "approved" });
    console.log(json({ stage: "approved", executionId: saved.executionId }));
  } else if (mode[0] === "arm") {
    if (saved.stage !== "approved")
      throw new Error("Approve the original request first.");
    await save({ stage: "arming" });
    await client.action(api.paymentSchedules.arm, {
      executionId: saved.executionId,
      sessionToken,
    });
    await save({ stage: "armed" });
    console.log(
      json({ stage: "armed", payAt: new Date(saved.payAt).toISOString() }),
    );
  } else if (mode[0] === "cancel") {
    if (!["approved", "armed", "cancelling"].includes(saved.stage))
      throw new Error("Only an unsubmitted signed schedule can be cancelled.");
    await client.mutation(api.paymentSchedules.stop, {
      disbursementId: saved.disbursementId,
      sessionToken,
    });
    await save({ stage: "cancelling" });
    const source = { scheduleCancellationId: saved.scheduleId, sessionToken };
    const executionId =
      saved.cancellationExecutionId ??
      (await client.action(api.circlePayments.prepare, source));
    await save({ cancellationExecutionId: executionId });
    for (const stage of ["fee", "operation"]) {
      const execution = await client.query(api.circlePayments.get, source);
      if (
        execution.stage === "ready" ||
        (stage === "fee" && execution.stage === "operation")
      )
        continue;
      if (execution.stage !== stage)
        throw new Error("Check the original cancellation request.");
      const request = decodeCircleRequest(execution.record);
      const original = await client.query(api.circlePayments.get, {
        paymentScheduleId: saved.scheduleId,
        sessionToken,
      });
      if (
        request.transaction.to.toLowerCase() !== safe.toLowerCase() ||
        request.transaction.data !== "0x" ||
        request.transaction.operation ||
        request.operation.nonce !==
          decodeCircleRequest(original.record).operation.nonce ||
        BigInt(request.permit.amount) > 2000000n
      )
        throw new Error(
          "The cancellation does not match this original authorization.",
        );
      const identity = { executionId, sessionToken },
        approvals = await client.action(api.circlePayments.approvals, identity),
        path = approvals.paths[0].path;
      await client.action(api.circlePayments.approve, {
        ...identity,
        stage,
        revision: execution.revision,
        path,
        signature: await owner.sign({
          hash: nestedSigningData(
            84532,
            path,
            circleRootSigningData(request, stage),
          ).hash,
        }),
      });
    }
    await save({ stage: "cancellation-submitting" });
    await client.action(api.circlePayments.submit, {
      executionId,
      sessionToken,
    });
    await save({ stage: "cancellation-submitted" });
    console.log(json({ stage: saved.stage, executionId }));
  } else {
    for (const executionId of [
      saved.cancellationExecutionId,
      saved.executionId,
    ].filter(Boolean))
      await client.action(api.circlePayments.recheck, {
        executionId,
        sessionToken,
      });
    const schedule = await client.query(api.paymentSchedules.get, {
      disbursementId: saved.disbursementId,
      sessionToken,
    });
    const execution = await client.query(api.circlePayments.get, {
      paymentScheduleId: saved.scheduleId,
      sessionToken,
    });
    const cancellation = saved.cancellationExecutionId
      ? await client.query(api.circlePayments.get, {
          scheduleCancellationId: saved.scheduleId,
          sessionToken,
        })
      : null;
    const payment = await client.query(api.disbursements.get, {
      disbursementId: saved.disbursementId,
      sessionToken,
    });
    const after = await balances();
    if (after.safeNonce !== BigInt(saved.initial.safeNonce))
      throw new Error("A scheduled operation changed the normal Safe nonce.");
    const result = {
      scheduleStatus: schedule.status,
      paymentStatus: payment.status,
      executionStage: execution.stage,
      txHash: payment.txHash,
      fee: execution.fee,
      cancellationStage: cancellation?.stage,
      cancellationTxHash: cancellation?.txHash,
      cancellationFee: cancellation?.fee,
      error: schedule.error,
      after,
    };
    await save({ result });
    console.log(json(result));
  }
} catch (error) {
  console.error(
    userErrorMessage(
      error,
      "The test step failed. Inspect its saved journal before continuing.",
    ),
  );
  process.exitCode = 1;
} finally {
  if (sessionToken)
    await client.mutation(api.auth.logout, { sessionToken }).catch(() => {});
}
