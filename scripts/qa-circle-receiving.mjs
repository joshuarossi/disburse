// Live Base Sepolia receiving setup and collection. No native-gas submission.
// Each paid attempt has an exclusive local journal before any signature/send.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { createPublicClient, erc20Abi, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import {
  circleRootSigningData,
  decodeCircleRequest,
} from "../shared/circleRequest.ts";
import { nestedSigningData } from "../shared/safeSignatures.ts";
import { circleConfiguration } from "../shared/circleExecution.ts";
import { userErrorMessage } from "../src/lib/userErrors.ts";
const option = (name) =>
  process.argv
    .find((v) => v.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const run = option("run"),
  action = ["prepare", "execute", "status", "issue", "resume-approvals"].filter(
    (v) => process.argv.includes(`--${v}`),
  );
if (!run || !/^[a-z0-9-]{1,40}$/.test(run) || action.length !== 1)
  throw new Error("Choose a unique --run and one action.");
if (
  !process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") ||
  process.env.VITE_CONVEX_URL !== "https://fortunate-cat-122.convex.cloud"
)
  throw new Error("Only the isolated development backend is allowed.");
const directory = ".local/qa/circle-receiving";
await mkdir(directory, { recursive: true, mode: 0o700 });
const path = `${directory}/${run}.json`,
  json = (value) =>
    JSON.stringify(
      value,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );
let saved = await readFile(path, "utf8")
  .then(JSON.parse)
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
const fresh = ["prepare", "issue"].includes(action[0]);
if (fresh === !!saved)
  throw new Error(
    "New work needs a fresh run. Execution/status need the original saved run.",
  );
const previous = JSON.parse(
  await readFile(".local/qa/circle-payment/app-usdc-fees-1.json", "utf8"),
);
const owner = privateKeyToAccount(
  JSON.parse(await readFile(".local/qa/wallet.json", "utf8")).privateKey,
);
const reader = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com", {
    retryCount: 0,
    timeout: 20000,
  }),
});
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
const config = circleConfiguration(84532),
  safe = "0x1d724C69fEB3C75Ed33511E3a09aF5b4D0377aB5";
let sessionToken;
const save = async (fields) => {
  saved = { ...saved, ...fields };
  await writeFile(path, json(saved), { mode: 0o600 });
};
async function balances() {
  const [ownerETH, safeETH, safeUSDC] = await Promise.all([
    reader.getBalance({ address: owner.address }),
    reader.getBalance({ address: safe }),
    reader.readContract({
      address: config.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [safe],
    }),
  ]);
  if (ownerETH || safeETH)
    throw new Error("This acceptance test requires zero ETH in both wallets.");
  return { ownerETH, safeETH, safeUSDC };
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
  if (fresh) {
    saved = {
      stage: "preparing",
      source: option("invoice")
        ? { receivableId: option("invoice") }
        : { receivingSetupSafeId: previous.safeId },
    };
    await writeFile(path, json(saved), { flag: "wx", mode: 0o600 });
    await save({ initial: await balances() });
  }
  if (action[0] === "issue") {
    const invoiceId = await client.mutation(api.receivables.create, {
      orgId: previous.orgId,
      safeId: previous.safeId,
      sessionToken,
      number: `QA-${run}`,
      customerName: "QA receiving customer",
      description: "Isolated testnet invoice",
      token: "USDC",
      dueDate: Date.now() + 86400000,
      items: [
        { description: "Acceptance test", quantity: 1, unitPrice: "0.1" },
      ],
    });
    await save({ invoiceId });
    await client.action(api.receivableActions.issue, {
      invoiceId,
      sessionToken,
    });
    const invoice = await client.query(api.receivables.get, {
      invoiceId,
      sessionToken,
    });
    await save({ stage: "issued", receivingAddress: invoice.receivingAddress });
    console.log(
      json({
        stage: saved.stage,
        invoiceId,
        receivingAddress: invoice.receivingAddress,
      }),
    );
  } else if (action[0] === "prepare") {
    const executionId = await client.action(api.circlePayments.prepare, {
      ...saved.source,
      sessionToken,
    });
    await save({ executionId });
    const e = await client.query(api.circlePayments.get, {
        ...saved.source,
        sessionToken,
      }),
      request = decodeCircleRequest(e.record);
    if (
      !request.directCall ||
      request.safe.toLowerCase() !== safe.toLowerCase() ||
      BigInt(request.permit.amount) > 650000n
    )
      throw new Error(
        "The operation exceeds this test or its 0.65 USDC fee limit.",
      );
    await save({
      stage: "prepared",
      originalHash: request.originalHash,
      maximumFee: request.permit.amount,
      transaction: request.transaction,
    });
    console.log(
      json({
        stage: saved.stage,
        executionId,
        maximumFee: saved.maximumFee,
        initial: saved.initial,
      }),
    );
  } else if (["execute", "resume-approvals"].includes(action[0])) {
    if (saved.stage !== (action[0] === "execute" ? "prepared" : "approving"))
      throw new Error(
        "This attempt already started. Check the original request.",
      );
    await balances();
    await save({ stage: "approving" });
    const identity = { executionId: saved.executionId, sessionToken };
    for (const stage of ["fee", "operation"]) {
      const e = await client.query(api.circlePayments.get, {
        ...saved.source,
        sessionToken,
      });
      if (e.stage === "ready" || (stage === "fee" && e.stage === "operation"))
        continue;
      const r = decodeCircleRequest(e.record);
      if (
        e.stage !== stage ||
        r.originalHash !== saved.originalHash ||
        r.safe.toLowerCase() !== safe.toLowerCase() ||
        BigInt(r.permit.amount) > 650000n ||
        JSON.stringify(r.transaction) !== JSON.stringify(saved.transaction)
      )
        throw new Error("The saved operation changed.");
      const approvals = await client.action(
          api.circlePayments.approvals,
          identity,
        ),
        p = approvals.paths[0];
      if (p.approved) {
        await client.action(api.circlePayments.advance, identity);
        continue;
      }
      const signature = await owner.sign({
        hash: nestedSigningData(84532, p.path, circleRootSigningData(r, stage))
          .hash,
      });
      await client.action(api.circlePayments.approve, {
        ...identity,
        stage,
        revision: e.revision,
        path: p.path,
        signature,
      });
    }
    await save({ stage: "submitting" });
    await client.action(api.circlePayments.submit, identity);
    await save({ stage: "submitted" });
    console.log(json({ stage: saved.stage, executionId: saved.executionId }));
  } else {
    await client.action(api.circlePayments.recheck, {
      executionId: saved.executionId,
      sessionToken,
    });
    const e = await client.query(api.circlePayments.get, {
      ...saved.source,
      sessionToken,
    });
    const receiving = await client.action(api.receivableServices.status, {
      safeId: previous.safeId,
      sessionToken,
    });
    const invoice = saved.source.receivableId
      ? await client.query(api.receivables.get, {
          invoiceId: saved.source.receivableId,
          sessionToken,
        })
      : null;
    const result = {
      execution: e.stage,
      txHash: e.txHash,
      userOpHash: e.userOpHash,
      fee: e.fee,
      receivingReady: receiving.ready,
      ...(invoice
        ? { received: invoice.received, forwarded: invoice.forwarded }
        : {}),
      after: await balances(),
    };
    await save({ result });
    console.log(json(result));
  }
} catch (error) {
  console.error(
    json({
      stage: saved?.stage,
      error: userErrorMessage(
        error,
        "The test stopped. Inspect the original saved request before continuing.",
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
