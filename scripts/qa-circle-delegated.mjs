// Isolated Base Sepolia acceptance. No native-gas signer or paid provider key.
// A journal is written before every signature and the single submission attempt.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import {
  createPublicClient,
  erc20Abi,
  http,
  parseAbi,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import {
  circleRootSigningData,
  decodeCircleRequest,
} from "../shared/circleRequest.ts";
import {
  nestedSigningData,
  approvalSigningData,
} from "../shared/safeSignatures.ts";
import { circleConfiguration } from "../shared/circleExecution.ts";
import { CURRENT_ALLOWANCE } from "../shared/allowanceDeployments.ts";
import { userErrorMessage } from "../src/lib/userErrors.ts";
const opt = (key) =>
  process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const run = opt("run"),
  phase = opt("phase"),
  task = opt("task");
assert(
  run && /^[a-z0-9-]{1,40}$/.test(run) && phase,
  "Choose --run and --phase.",
);
assert(
  process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") &&
    process.env.VITE_CONVEX_URL === "https://fortunate-cat-122.convex.cloud",
  "Development backend only.",
);
const directory = ".local/qa/circle-delegated",
  path = `${directory}/${run}.json`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const json = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v), 2);
let saved = await readFile(path, "utf8")
  .then(JSON.parse)
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
const owner = privateKeyToAccount(
  JSON.parse(await readFile(".local/qa/wallet.json", "utf8")).privateKey,
);
const delegate = privateKeyToAccount(
  JSON.parse(await readFile(".local/qa/recipients.json", "utf8"))[1],
);
const safe = "0x1d724C69fEB3C75Ed33511E3a09aF5b4D0377aB5",
  config = circleConfiguration(84532);
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
const accountAbi = parseAbi([
  "function getOwners() view returns(address[])",
  "function nonce() view returns(uint256)",
]);
const save = async () => writeFile(path, json(saved), { mode: 0o600 });
async function login(account) {
  const { message } = await client.mutation(api.auth.generateNonce, {
    walletAddress: account.address,
  });
  return (
    await client.mutation(api.auth.verifySignature, {
      walletAddress: account.address,
      message,
      signature: await account.signMessage({ message }),
    })
  ).token;
}
async function balances() {
  const addresses = [
    owner.address,
    delegate.address,
    safe,
    ...(saved?.feeAddress ? [saved.feeAddress] : []),
  ];
  const result = {};
  for (const address of addresses) {
    const [eth, usdc] = await Promise.all([
      reader.getBalance({ address }),
      reader.readContract({
        address: config.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);
    assert.equal(
      eth,
      0n,
      "This acceptance test requires zero ETH in every account.",
    );
    result[address.toLowerCase()] = { eth, usdc };
  }
  result.mainNonce = await reader.readContract({
    address: safe,
    abi: accountAbi,
    functionName: "nonce",
  });
  return result;
}
let adminToken, delegateToken;
async function prepareFee(name, source, account, token) {
  assert(
    !saved.tasks[name],
    "This paid task already exists. Resume its saved task.",
  );
  saved.tasks[name] = { source, signer: account.address, preparing: true };
  await save();
  const executionId = await client.action(api.circlePayments.prepare, {
    ...source,
    sessionToken: token,
  });
  const execution = await client.query(api.circlePayments.get, {
      ...source,
      sessionToken: token,
    }),
    r = decodeCircleRequest(execution.record);
  assert(
    BigInt(r.permit.amount) <= 2_000_000n,
    "Maximum fee exceeds this test budget.",
  );
  assert.equal(
    r.safe.toLowerCase(),
    (account === owner ? safe : saved.feeAddress).toLowerCase(),
  );
  Object.assign(saved.tasks[name], {
    executionId,
    originalHash: r.originalHash,
    transaction: r.transaction,
    nonce: String(r.operation.nonce),
    cap: r.permit.amount,
  });
  await save();
  console.log(
    json({ prepared: name, executionId, maxFeeUSDC: r.permit.amount }),
  );
}
async function signTask() {
  const t = saved.tasks[task];
  assert(
    t?.executionId && !t.postAttempted,
    "Check the original task before signing.",
  );
  const account = t.signer === owner.address ? owner : delegate,
    sessionToken = account === owner ? adminToken : delegateToken;
  for (const stage of ["fee", "operation"]) {
    const e = await client.query(api.circlePayments.get, {
      ...t.source,
      sessionToken,
    });
    if (e.stage === "ready" || (stage === "fee" && e.stage === "operation"))
      continue;
    assert.equal(e.stage, stage);
    const r = decodeCircleRequest(e.record);
    assert.equal(r.originalHash, t.originalHash);
    assert.deepEqual(r.transaction, t.transaction);
    assert.equal(String(r.operation.nonce), t.nonce);
    assert.equal(r.permit.amount, t.cap);
    const approvals = await client.action(api.circlePayments.approvals, {
        executionId: t.executionId,
        sessionToken,
      }),
      p = approvals.paths[0];
    assert(
      p &&
        p.path.length === 1 &&
        p.path[0].toLowerCase() === r.safe.toLowerCase(),
    );
    t.signingStage = stage;
    await save();
    if (p.approved)
      await client.action(api.circlePayments.advance, {
        executionId: t.executionId,
        sessionToken,
      });
    else {
      if (stage === "operation")
        await client.mutation(api.circlePayments.beginApproval, {
          executionId: t.executionId,
          sessionToken,
          revision: e.revision,
        });
      await client.action(api.circlePayments.approve, {
        executionId: t.executionId,
        sessionToken,
        stage,
        revision: e.revision,
        path: p.path,
        signature: await account.sign({
          hash: nestedSigningData(
            84532,
            p.path,
            circleRootSigningData(r, stage),
          ).hash,
        }),
      });
    }
  }
  t.signed = true;
  await save();
  console.log(json({ signed: task }));
}
try {
  assert.equal(await reader.getChainId(), 84532);
  assert.equal(
    owner.address.toLowerCase(),
    "0x01585228489577cdcdbd5ebb822c7c439a2c564c",
  );
  adminToken = await login(owner);
  delegateToken = await login(delegate);
  if (phase === "bootstrap") {
    assert(!saved, "Use a fresh run.");
    saved = { tasks: {}, delegate: delegate.address, chainId: 84532 };
    await writeFile(path, json(saved), { flag: "wx", mode: 0o600 });
    saved.initial = await balances();
    saved.orgId = (
      await client.mutation(api.orgs.create, {
        sessionToken: adminToken,
        name: `Delegated USDC QA ${run}`,
      })
    ).orgId;
    await save();
    saved.safeId = (
      await client.action(api.safes.link, {
        orgId: saved.orgId,
        sessionToken: adminToken,
        safeAddress: safe,
        chainId: 84532,
        name: "Company payments",
      })
    ).safeId;
    await save();
    await client.mutation(api.orgs.inviteMember, {
      orgId: saved.orgId,
      sessionToken: adminToken,
      memberWalletAddress: delegate.address,
      memberName: "QA assigned payer",
      role: "initiator",
    });
    await client.mutation(api.orgs.acceptInvite, {
      orgId: saved.orgId,
      sessionToken: delegateToken,
    });
    saved.memberUserId = (
      await client.query(api.orgs.listMembers, {
        orgId: saved.orgId,
        sessionToken: adminToken,
      })
    ).find(
      (m) => m?.walletAddress.toLowerCase() === delegate.address.toLowerCase(),
    ).userId;
    saved.beneficiaries = [];
    for (const [i, address] of [owner.address, delegate.address].entries()) {
      const { beneficiaryId } = await client.mutation(
        api.beneficiaries.create,
        {
          orgId: saved.orgId,
          sessionToken: adminToken,
          type: "individual",
          name: `Controlled test recipient ${i + 1}`,
          beneficiaryAddress: address,
          preferredToken: "USDC",
          preferredChainId: 84532,
        },
      );
      saved.beneficiaries.push(beneficiaryId);
      await save();
      const review = await client.query(api.recipientReviews.get, {
        beneficiaryId,
        sessionToken: adminToken,
      });
      await client.mutation(api.recipientReviews.decide, {
        changeId: review.pending._id,
        sessionToken: adminToken,
        decision: "approved",
        confirmedIndependently: true,
        verificationMethod: "verified_portal",
        reason:
          "Controlled Base Sepolia QA signer address verified from the local test wallet.",
      });
    }
    await save();
    console.log(
      json({
        orgId: saved.orgId,
        safeId: saved.safeId,
        memberUserId: saved.memberUserId,
        initial: saved.initial,
      }),
    );
  } else {
    assert(saved, "Bootstrap a fresh isolated run.");
    if (phase === "setup") {
      assert(!saved.accountSetupId);
      saved.requestId = crypto.randomUUID();
      await save();
      saved.accountSetupId = await client.action(api.accountSetups.create, {
        orgId: saved.orgId,
        parentSafeId: saved.safeId,
        name: "Assigned payer",
        requestId: saved.requestId,
        memberUserId: saved.memberUserId,
        initialFunding: "5000000",
        memberControlAcknowledged: true,
        sessionToken: adminToken,
      });
      await save();
      await prepareFee(
        "setup",
        { accountSetupId: saved.accountSetupId },
        owner,
        adminToken,
      );
    } else if (phase === "grant" || phase === "revoke") {
      assert(saved.feeSafeId && !saved.tasks[phase]);
      const id = await client.action(api.spendingPolicies.create, {
        safeId: saved.safeId,
        sessionToken: adminToken,
        requestId: crypto.randomUUID(),
        kind: phase,
        module: CURRENT_ALLOWANCE.address,
        delegate: saved.feeAddress,
        ...(phase === "grant"
          ? { token: "USDC", amount: "1", resetMinutes: 0 }
          : { tokenAddress: config.token }),
      });
      saved[`${phase}Id`] = id;
      await save();
      const identity = { policyChangeId: id, sessionToken: adminToken },
        view = await client.action(api.spendingPolicies.approvals, identity),
        p = view.paths[0];
      await client.action(api.spendingPolicies.approve, {
        ...identity,
        path: p.path,
        safeTxHash: view.proposal.safeTxHash,
        signature: await owner.sign({
          hash: approvalSigningData(
            84532,
            p.path,
            view.proposal.safeTransactionData,
          ).hash,
        }),
      });
      await prepareFee(phase, { policyChangeId: id }, owner, adminToken);
    } else if (phase === "payment" || phase === "over-limit") {
      assert(task && !saved.tasks[task]);
      const amount = phase === "over-limit" ? "0.51" : "0.05";
      const { disbursementId } = await client.mutation(
        api.disbursements.createBatch,
        {
          orgId: saved.orgId,
          safeId: saved.safeId,
          sessionToken: delegateToken,
          chainId: 84532,
          token: "USDC",
          recipients: saved.beneficiaries.map((beneficiaryId) => ({
            beneficiaryId,
            amount,
          })),
          memo: `QA delegated ${task}`,
        },
      );
      saved[`${task}PaymentId`] = disbursementId;
      await save();
      const args = {
        disbursementId,
        sessionToken: delegateToken,
        feeMode: "stablecoin",
        feeSafeId: saved.feeSafeId,
      };
      if (phase === "over-limit") {
        let refused = false;
        try {
          await client.action(api.delegatedPayments.quote, args);
        } catch (e) {
          refused = /allowance|remaining|limit/i.test(String(e));
        }
        assert(refused, "An over-limit payment must be rejected.");
        console.log(
          "PASS allowance rejection before signing or fee preparation",
        );
      } else {
        const quote = await client.action(api.delegatedPayments.quote, args);
        assert.equal(
          quote.delegate.toLowerCase(),
          saved.feeAddress.toLowerCase(),
        );
        assert.equal(quote.additionalTransfers.length, 1);
        await client.action(api.delegatedPayments.prepare, {
          ...args,
          hash: quote.hash,
          signature: "0x",
          additionalSignatures: ["0x"],
        });
        await prepareFee(
          task,
          { delegatedDisbursementId: disbursementId },
          delegate,
          delegateToken,
        );
      }
    } else if (phase === "sign") await signTask();
    else if (phase === "submit") {
      const t = saved.tasks[task];
      assert(
        t?.signed && !t.postAttempted,
        "Use status; this task has already been submitted or is unsigned.",
      );
      t.before = await balances();
      t.postAttempted = Date.now();
      await save();
      await client.action(api.circlePayments.submit, {
        executionId: t.executionId,
        sessionToken: t.signer === owner.address ? adminToken : delegateToken,
      });
      console.log(json({ submitted: task, executionId: t.executionId }));
    } else if (phase === "cancel") {
      assert(task && !saved.tasks[`${task}-cancel`]);
      const result = await client.mutation(api.delegatedCircle.stop, {
        disbursementId: saved[`${task}PaymentId`],
        sessionToken: delegateToken,
      });
      assert.equal(result.cancelExecutionId, saved.tasks[task].executionId);
      await prepareFee(`${task}-cancel`, result, delegate, delegateToken);
      assert.equal(
        saved.tasks[`${task}-cancel`].nonce,
        saved.tasks[task].nonce,
      );
    } else if (phase === "status") {
      const t = saved.tasks[task];
      assert(t?.executionId);
      const sessionToken =
        t.signer === owner.address ? adminToken : delegateToken;
      await client.action(api.circlePayments.recheck, {
        executionId: t.executionId,
        sessionToken,
      });
      const e = await client.query(api.circlePayments.get, {
        ...t.source,
        sessionToken,
      });
      let payment, account;
      if (t.source.accountSetupId) {
        account = await client.query(api.accountSetups.get, {
          accountSetupId: t.source.accountSetupId,
          sessionToken,
        });
        if (account.status === "complete") {
          saved.feeSafeId = account.safeId;
          saved.feeAddress = account.address;
          assert.deepEqual(
            (
              await reader.readContract({
                address: account.address,
                abi: accountAbi,
                functionName: "getOwners",
              })
            ).map((a) => a.toLowerCase()),
            [delegate.address.toLowerCase()],
          );
        }
      }
      const paymentId =
        t.source.delegatedDisbursementId ??
        (task.endsWith("-cancel")
          ? saved[`${task.slice(0, -7)}PaymentId`]
          : null);
      if (paymentId)
        payment = await client.query(api.disbursements.getWithRecipients, {
          disbursementId: paymentId,
          sessionToken,
        });
      t.result = {
        stage: e.stage,
        txHash: e.txHash,
        userOpHash: e.userOpHash,
        fee: e.fee,
        accountStatus: account?.status,
        paymentStatus: payment?.status,
        after: await balances(),
      };
      if (e.stage === "confirmed" && t.source.delegatedDisbursementId) {
        assert.equal(payment.status, "executed");
        const receipt = await reader.getTransactionReceipt({ hash: e.txHash });
        const transfers = parseEventLogs({
          abi: erc20Abi,
          eventName: "Transfer",
          logs: receipt.logs,
          strict: true,
        }).filter(
          (l) =>
            !l.removed &&
            l.address.toLowerCase() === config.token.toLowerCase() &&
            l.args.from.toLowerCase() === safe.toLowerCase(),
        );
        assert.equal(transfers.length, 2);
        assert(transfers.every((l) => l.args.value === 50000n));
        assert.equal(
          String(t.result.after.mainNonce),
          String(t.before.mainNonce),
        );
        for (const address of [owner.address, delegate.address])
          assert.equal(
            BigInt(t.result.after[address.toLowerCase()].usdc) -
              BigInt(t.before[address.toLowerCase()].usdc),
            50000n,
          );
        assert.equal(
          BigInt(t.before[saved.feeAddress].usdc) -
            BigInt(t.result.after[saved.feeAddress].usdc),
          BigInt(e.fee),
        );
      }
      await save();
      console.log(json({ task, ...t.result }));
    } else throw new Error("Unknown phase.");
  }
} catch (e) {
  console.error(
    json({
      phase,
      task,
      error: userErrorMessage(
        e,
        "QA stopped. Inspect the original saved request before continuing.",
      ),
    }),
  );
  process.exitCode = 1;
} finally {
  for (const sessionToken of [adminToken, delegateToken].filter(Boolean))
    await client.mutation(api.auth.logout, { token: sessionToken }).catch(() => {});
}
