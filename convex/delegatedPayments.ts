import { delegatedIntentValidator } from "./lib/delegatedIntent";
import { assertAllowanceReservationsAvailable } from "./lib/delegationReservations";
import { assertBatchContract } from "./lib/accountChange";
import { queueReportSource } from "./lib/reportIndex";
import {
  readSettlementBlock,
  settlementBlockValidator,
  assertSameSettlement,
} from "./lib/settlementBlock";
import { assertFundingBalance } from "./lib/fundingBalance";
import { relayConfiguration } from "./lib/relayConfiguration";
import { delegatedAccountCall } from "../shared/delegatedAccountCall";
import { assertAllowanceRuntime } from "../shared/allowanceDeployments";
import type { ExecutionFee } from "../shared/executionFee";
import { feeIdentity } from "../shared/executionFee";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/rbac";
import { assertMemberPaymentPolicy } from "./lib/paymentLimits";
import { assertPaymentMayProceed } from "./lib/disbursementPolicy";
import { assertPayoutInstructions } from "../shared/payoutInstructions";
import { amountToBaseUnits, assertValidTxHash } from "./lib/validation";
import {
  allowanceModules,
  allowanceTransferAbi,
  assertDelegatedReceipt,
  type DelegatedIntent,
} from "../shared/allowanceTransfer";
import { CHAIN_TOKENS, type SupportedChainId } from "../shared/chains";
import { getChainClient } from "./lib/safeVerification";
import { assertSafeIdentity } from "./lib/safeIdentity";
import { appendAudit } from "./audit";
import { recoverAddress } from "./lib/signatures";
import {
  hashMessage,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

const accountAbi = parseAbi([
  "function isModuleEnabled(address module) view returns (bool)",
]);

const publicArgs = {
  disbursementId: v.id("disbursements"),
  sessionToken: v.string(),
};

export const context = internalQuery({
  args: {
    disbursementId: v.id("disbursements"),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found.");
    const user = args.sessionToken
      ? (
          await requireOrgAccess(ctx, payment.orgId, args.sessionToken, [
            "admin",
            "approver",
            "initiator",
          ])
        ).user
      : null;
    const safe = await ctx.db.get(payment.safeId);
    if (
      !safe ||
      (!payment.allowanceExecution && safe.isActive === false) ||
      !payment.chainId
    )
      throw new Error("Link the original funding account first.");
    const recipients =
      payment.type === "batch"
        ? await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) =>
              q.eq("disbursementId", payment._id),
            )
            .collect()
        : [
            {
              beneficiaryId: payment.beneficiaryId,
              recipientAddress: payment.recipientAddress,
              amount: payment.amount,
            },
          ];
    if (
      !recipients.length ||
      recipients.length > 200 ||
      !recipients[0].beneficiaryId ||
      !recipients[0].recipientAddress ||
      !recipients[0].amount
    )
      throw new Error(
        "Choose between 1 and 200 recipients with complete payment instructions.",
      );
    const addresses = new Set<string>();
    for (const row of recipients) {
      if (!row.recipientAddress || !row.amount || !row.beneficiaryId)
        throw new Error("Complete every recipient’s payment instructions.");
      if (addresses.has(row.recipientAddress.toLowerCase()))
        throw new Error(
          "An allowance batch must use distinct recipient addresses.",
        );
      addresses.add(row.recipientAddress.toLowerCase());
      if (!payment.allowanceExecution) {
        const recipient = await ctx.db.get(row.beneficiaryId);
        if (
          !recipient ||
          recipient.orgId !== payment.orgId ||
          !recipient.isActive
        )
          throw new Error("A recipient is no longer active.");
        assertPayoutInstructions(recipient, {
          token: payment.token,
          chainId: payment.chainId,
        });
      }
    }
    const recipient = recipients[0];
    const beneficiary = await ctx.db.get(recipient.beneficiaryId!);
    if (
      !payment.allowanceExecution &&
      (!beneficiary ||
        beneficiary.orgId !== payment.orgId ||
        !beneficiary.isActive)
    )
      throw new Error("This recipient is no longer active.");
    if (!payment.allowanceExecution && beneficiary)
      assertPayoutInstructions(beneficiary, {
        token: payment.token,
        chainId: payment.chainId,
      });
    const org = await ctx.db.get(payment.orgId);
    return {
      recipients: recipients.map((r) => ({
        recipientAddress: r.recipientAddress!,
        amount: r.amount!,
      })),
      feeSymbol: org?.relayFeeTokenSymbol ?? "USDC",
      payment,
      safeAddress: safe.safeAddress,
      recipientAddress: recipient.recipientAddress!,
      amount: recipient.amount!,
      delegate:
        user?.walletAddress ?? payment.allowanceExecution?.delegate ?? "",
    };
  },
});
type Context = {
  recipients: Array<{ recipientAddress: string; amount: string }>;
  feeSymbol: string;
  payment: Doc<"disbursements">;
  safeAddress: string;
  recipientAddress: string;
  amount: string;
  delegate: string;
};
// Keep the action return type explicit to avoid recursive generated API inference.
type Quote = {
  additionalTransfers: Array<{
    recipientAddress: string;
    amount: string;
    nonce: number;
    hash: string;
  }>;
  fee?: ExecutionFee;
  feeHash?: string;
  feeNonce?: number;
  available: string;
  module: string;
  delegate: string;
  nonce: number;
  hash: string;
  tokenAddress: string;
  recipientAddress: string;
  amount: string;
  chainId: number;
  safeAddress: string;
};

async function quoteFrom(
  expected: Context,
  feeMode: "managed" | "wallet" = "managed",
): Promise<Quote> {
  const { payment } = expected;
  if (
    payment.status !== "draft" ||
    payment.safeTxHash ||
    payment.allowanceExecution
  )
    throw new Error(
      "Only an unsubmitted draft can use a new allowance authorization.",
    );
  if (payment.scheduledAt && payment.scheduledAt > Date.now())
    throw new Error(
      "This payment is scheduled for later. Delegated execution sends immediately.",
    );
  const chainId = payment.chainId!;
  const token =
    CHAIN_TOKENS[chainId as SupportedChainId]?.[payment.token as "USDC"];
  if (!token) throw new Error("Unsupported payment currency.");
  const fee =
    feeMode === "managed"
      ? relayConfiguration(chainId, expected.feeSymbol).fee
      : undefined;
  if (
    fee &&
    expected.recipients.some(
      (r) => fee.collector.toLowerCase() === r.recipientAddress.toLowerCase(),
    )
  )
    throw new Error(
      "The fee collector must be separate from the payment recipient.",
    );
  await assertFundingBalance(
    chainId,
    expected.safeAddress,
    payment.token,
    payment.totalAmount ?? payment.amount ?? expected.amount,
    fee,
  );
  const client = getChainClient(chainId);
  const blockNumber = await client.getBlockNumber();
  await assertSafeIdentity(
    client,
    expected.safeAddress as Address,
    chainId,
    blockNumber,
  );
  const amount = expected.recipients.reduce(
    (sum, r) => sum + amountToBaseUnits(r.amount, payment.token),
    0n,
  );
  for (const module of allowanceModules(chainId)) {
    assertAllowanceRuntime(
      module,
      await client.getCode({ address: module, blockNumber }),
    );
    const [enabled, allowance] = await Promise.all([
      client.readContract({
        address: expected.safeAddress as Address,
        abi: accountAbi,
        functionName: "isModuleEnabled",
        args: [module as Address],
        blockNumber,
      }),
      client.readContract({
        address: module as Address,
        abi: allowanceTransferAbi,
        functionName: "getTokenAllowance",
        blockNumber,
        args: [
          expected.safeAddress as Address,
          expected.delegate as Address,
          token.address,
        ],
      }),
    ]);
    if (
      !enabled ||
      allowance[0] < allowance[1] + amount ||
      allowance[4] >= 65535n
    )
      continue;
    let feeNonce: number | undefined, feeHash: string | undefined;
    if (Number(allowance[4]) + expected.recipients.length >= 65535) continue;
    if (fee) {
      const sameToken =
        fee.tokenAddress.toLowerCase() === token.address.toLowerCase();
      const feeAllowance = sameToken
        ? allowance
        : await client.readContract({
            address: module as Address,
            abi: allowanceTransferAbi,
            blockNumber,
            functionName: "getTokenAllowance",
            args: [
              expected.safeAddress as Address,
              expected.delegate as Address,
              fee.tokenAddress as Address,
            ],
          });
      const feeAmount = amountToBaseUnits(fee.amount, fee.token);
      feeNonce =
        Number(feeAllowance[4]) + (sameToken ? expected.recipients.length : 0);
      if (
        feeAllowance[0] <
          feeAllowance[1] + feeAmount + (sameToken ? amount : 0n) ||
        feeNonce >= 65535
      )
        continue;
      feeHash = await client.readContract({
        address: module as Address,
        abi: allowanceTransferAbi,
        blockNumber,
        functionName: "generateTransferHash",
        args: [
          expected.safeAddress as Address,
          fee.tokenAddress as Address,
          fee.collector as Address,
          feeAmount,
          zeroAddress,
          0n,
          feeNonce,
        ],
      });
    }
    const nonce = Number(allowance[4]);
    const hash = await client.readContract({
      address: module as Address,
      abi: allowanceTransferAbi,
      functionName: "generateTransferHash",
      blockNumber,
      args: [
        expected.safeAddress as Address,
        token.address,
        expected.recipientAddress as Address,
        amountToBaseUnits(expected.amount, payment.token),
        zeroAddress,
        0n,
        nonce,
      ],
    });
    const additionalTransfers = [];
    for (const [index, recipient] of expected.recipients.slice(1).entries()) {
      const transferNonce = nonce + index + 1;
      const transferHash = await client.readContract({
        address: module as Address,
        abi: allowanceTransferAbi,
        blockNumber,
        functionName: "generateTransferHash",
        args: [
          expected.safeAddress as Address,
          token.address,
          recipient.recipientAddress as Address,
          amountToBaseUnits(recipient.amount, payment.token),
          zeroAddress,
          0n,
          transferNonce,
        ],
      });
      additionalTransfers.push({
        ...recipient,
        nonce: transferNonce,
        hash: transferHash,
      });
    }
    return {
      additionalTransfers,
      fee,
      feeHash,
      feeNonce,
      available: String(allowance[0] - allowance[1]),
      module,
      delegate: expected.delegate,
      nonce,
      hash,
      tokenAddress: token.address,
      recipientAddress: expected.recipientAddress,
      amount: expected.amount,
      chainId,
      safeAddress: expected.safeAddress,
    };
  }
  throw new Error(
    "No active allowance covers this payment. An account owner can grant a limit in Team & approvals.",
  );
}

export const quote = action({
  args: {
    ...publicArgs,
    feeMode: v.optional(v.union(v.literal("managed"), v.literal("wallet"))),
  },
  handler: async (ctx, args): Promise<Quote> => {
    await ctx.runQuery(api.recipientReviews.assertPayable, {
      disbursementId: args.disbursementId,
      sessionToken: args.sessionToken,
    });
    const result = await quoteFrom(
      await ctx.runQuery(internal.delegatedPayments.context, {
        disbursementId: args.disbursementId,
        sessionToken: args.sessionToken,
      }),
      args.feeMode,
    );
    const prefix = `${result.chainId}:${result.module.toLowerCase()}:${result.safeAddress.toLowerCase()}:${result.delegate.toLowerCase()}:`;
    const keys = [result.nonce, ...result.additionalTransfers.map(t => t.nonce)].map(nonce => `${prefix}${result.tokenAddress.toLowerCase()}:${nonce}`);
    if (result.fee) keys.push(`${prefix}${result.fee.tokenAddress.toLowerCase()}:${result.feeNonce}`);
    // Catch conflicts before asking the member to sign. Claim rechecks atomically.
    await ctx.runQuery(internal.delegatedPayments.checkReservations, { disbursementId: args.disbursementId, keys });
    if (result.fee)
      await ctx.runAction(internal.relayExecutor.validateFee, {
        chainId: result.chainId,
        fee: result.fee,
      });
    return result;
  },
});

export const checkReservations = internalQuery({
  args: { disbursementId: v.id("disbursements"), keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found.");
    await assertAllowanceReservationsAvailable(ctx, payment.orgId, args.keys);
  },
});

export const prepare = action({
  args: {
    ...publicArgs,
    feeMode: v.optional(v.union(v.literal("managed"), v.literal("wallet"))),
    hash: v.string(),
    signature: v.string(),
    feeHash: v.optional(v.string()),
    feeSignature: v.optional(v.string()),
    additionalSignatures: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<DelegatedIntent> => {
    await ctx.runQuery(api.recipientReviews.assertPayable, {
      disbursementId: args.disbursementId,
      sessionToken: args.sessionToken,
    });
    const expected = await ctx.runQuery(internal.delegatedPayments.context, {
      disbursementId: args.disbursementId,
      sessionToken: args.sessionToken,
    });
    const quote = await quoteFrom(expected, args.feeMode);
    if (quote.hash.toLowerCase() !== args.hash.toLowerCase())
      throw new Error(
        "The allowance changed after review. Review the payment again.",
      );
    let feeAuthorization: DelegatedIntent["feeAuthorization"];
    if (quote.fee) {
      if (
        !quote.feeHash ||
        !args.feeHash ||
        !args.feeSignature ||
        quote.feeHash.toLowerCase() !== args.feeHash.toLowerCase()
      )
        throw new Error(
          "The fee changed after review. Review the payment again.",
        );
      const signer = recoverAddress({
        hash: hashMessage({ raw: quote.feeHash as Hex }),
        signature: args.feeSignature as Hex,
      });
      const feeV = parseInt(args.feeSignature.slice(-2), 16);
      if (
        signer.toLowerCase() !== quote.delegate.toLowerCase() ||
        ![27, 28].includes(feeV)
      )
        throw new Error("Invalid fee authorization.");
      feeAuthorization = {
        ...quote.fee,
        nonce: quote.feeNonce!,
        hash: quote.feeHash,
        signature: args.feeSignature.slice(0, -2) + (feeV + 4).toString(16),
      };
    } else if (args.feeHash || args.feeSignature)
      throw new Error(
        "Wallet-paid execution must not include a managed fee authorization",
      );
    const recovered = recoverAddress({
      hash: hashMessage({ raw: quote.hash as Hex }),
      signature: args.signature as Hex,
    });
    if (recovered.toLowerCase() !== quote.delegate.toLowerCase())
      throw new Error(
        "The payment authorization is not signed by your wallet.",
      );
    const vByte = parseInt(args.signature.slice(-2), 16);
    if (![27, 28].includes(vByte))
      throw new Error("Unsupported wallet signature.");
    const signature = args.signature.slice(0, -2) + (vByte + 4).toString(16);
    if (
      (args.additionalSignatures?.length ?? 0) !==
      quote.additionalTransfers.length
    )
      throw new Error("Every recipient must be authorized.");
    const additionalTransfers = quote.additionalTransfers.map(
      (transfer, index) => {
        const signature = args.additionalSignatures![index];
        const signer = recoverAddress({
          hash: hashMessage({ raw: transfer.hash as Hex }),
          signature: signature as Hex,
        });
        const vByte = parseInt(signature.slice(-2), 16);
        if (
          signer.toLowerCase() !== quote.delegate.toLowerCase() ||
          ![27, 28].includes(vByte)
        )
          throw new Error("Invalid recipient authorization.");
        return {
          ...transfer,
          signature: signature.slice(0, -2) + (vByte + 4).toString(16),
        };
      },
    );
    const intent: DelegatedIntent = {
      additionalTransfers,
      feeAuthorization,
      chainId: quote.chainId,
      safeAddress: quote.safeAddress,
      module: quote.module,
      delegate: quote.delegate,
      nonce: quote.nonce,
      hash: quote.hash,
      signature,
      tokenAddress: quote.tokenAddress,
      recipientAddress: quote.recipientAddress,
      amount: quote.amount,
    };
    if (quote.fee)
      await ctx.runAction(internal.relayExecutor.validateFee, {
        chainId: quote.chainId,
        fee: quote.fee,
      });
    // One simulated atomic call proves both the recipient and fee allowance transfers.
    const call = delegatedAccountCall(intent, expected.payment.token);
    if (call.to.toLowerCase() !== intent.module.toLowerCase())
      await assertBatchContract(
        quote.chainId,
        call.to,
        await getChainClient(quote.chainId).getBlockNumber(),
      );
    await getChainClient(quote.chainId).call({
      ...call,
      account: intent.delegate as Address,
    });
    const block = await getChainClient(quote.chainId).getBlockNumber();
    await ctx.runMutation(internal.delegatedPayments.claim, {
      disbursementId: args.disbursementId,
      sessionToken: args.sessionToken,
      intent,
      relayFromBlock: String(block > 12n ? block - 12n : 0n),
    });
    return intent;
  },
});

export const claim = internalMutation({
  args: {
    ...publicArgs,
    intent: delegatedIntentValidator,
    relayFromBlock: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found.");
    const { user } = await requireOrgAccess(
      ctx,
      payment.orgId,
      args.sessionToken,
      ["admin", "approver", "initiator"],
    );
    if (
      payment.status !== "draft" ||
      payment.safeTxHash ||
      payment.allowanceExecution
    )
      throw new Error("This payment changed or is already being submitted.");
    if (user.walletAddress.toLowerCase() !== args.intent.delegate.toLowerCase())
      throw new Error("Wrong delegated wallet.");
    if (payment.scheduledAt && payment.scheduledAt > Date.now())
      throw new Error("This payment is scheduled for later.");
    await assertPaymentMayProceed(ctx, payment);
    const fee = args.intent.feeAuthorization;
    if (fee) {
      const org = await ctx.db.get(payment.orgId);
      const configured = relayConfiguration(
        payment.chainId!,
        org?.relayFeeTokenSymbol ?? "USDC",
      ).fee;
      if (feeIdentity(fee) !== feeIdentity(configured))
        throw new Error("The payment fee changed after review.");
      await ctx.db.patch(payment._id, { executionFee: configured });
    }
    for (const userId of new Set([payment.createdBy, user._id]))
      await assertMemberPaymentPolicy(
        ctx,
        payment.orgId,
        userId,
        payment.token,
        payment.totalAmount ?? payment.amount ?? "0",
        Date.now(),
        payment._id,
      );
    const recipients =
      payment.type === "batch"
        ? await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) =>
              q.eq("disbursementId", payment._id),
            )
            .collect()
        : [
            {
              beneficiaryId: payment.beneficiaryId,
              recipientAddress: payment.recipientAddress,
              amount: payment.amount,
            },
          ];
    const authorized = [
      args.intent,
      ...(args.intent.additionalTransfers ?? []),
    ];
    if (
      recipients.length !== authorized.length ||
      recipients.some(
        (r, i) =>
          r.recipientAddress?.toLowerCase() !==
            authorized[i].recipientAddress.toLowerCase() ||
          r.amount !== authorized[i].amount,
      )
    )
      throw new Error("Payment details changed after review.");
    for (const row of recipients) {
      const beneficiary = row.beneficiaryId
        ? await ctx.db.get(row.beneficiaryId)
        : null;
      if (
        !beneficiary ||
        !beneficiary.isActive ||
        beneficiary.orgId !== payment.orgId
      )
        throw new Error("Recipient is no longer available.");
      assertPayoutInstructions(beneficiary, {
        token: payment.token,
        chainId: payment.chainId!,
      });
    }
    const safe = await ctx.db.get(payment.safeId);
    const configuredToken = Object.entries(
      CHAIN_TOKENS[payment.chainId as SupportedChainId] ?? {},
    ).find(([symbol]) => symbol === payment.token)?.[1];
    if (
      !safe ||
      safe.isActive === false ||
      payment.chainId !== args.intent.chainId ||
      safe.safeAddress.toLowerCase() !==
        args.intent.safeAddress.toLowerCase() ||
      !configuredToken ||
      configuredToken.address.toLowerCase() !==
        args.intent.tokenAddress.toLowerCase() ||
      !allowanceModules(payment.chainId!).some(
        (module) => module.toLowerCase() === args.intent.module.toLowerCase(),
      )
    )
      throw new Error("Funding instructions changed after review.");
    const key = `${payment.chainId}:${args.intent.module.toLowerCase()}:${safe.safeAddress.toLowerCase()}:${args.intent.delegate.toLowerCase()}:${args.intent.tokenAddress.toLowerCase()}:${args.intent.nonce}`;
    const reservationKeys = [
      key,
      ...(args.intent.additionalTransfers ?? []).map(
        (t) =>
          `${payment.chainId}:${args.intent.module.toLowerCase()}:${safe.safeAddress.toLowerCase()}:${args.intent.delegate.toLowerCase()}:${args.intent.tokenAddress.toLowerCase()}:${t.nonce}`,
      ),
    ];
    if (fee)
      reservationKeys.push(
        `${payment.chainId}:${args.intent.module.toLowerCase()}:${safe.safeAddress.toLowerCase()}:${args.intent.delegate.toLowerCase()}:${fee.tokenAddress.toLowerCase()}:${fee.nonce}`,
      );
    await assertAllowanceReservationsAvailable(ctx, payment.orgId, reservationKeys);
    for (const reservedKey of reservationKeys) {
      await ctx.db.insert("delegationReservations", {
        key: reservedKey,
        disbursementId: payment._id,
      });
    }
    await ctx.db.patch(payment._id, {
      status: "relaying",
      delegatedBy: user._id,
      delegationKey: key,
      allowanceExecution: args.intent,
      ...(!fee ? { executionFee: undefined } : {}),
      nativeExecution: !fee
        ? {
            startedAt: Date.now(),
            checks: 0,
            searchFromBlock: args.relayFromBlock,
          }
        : undefined,
      nativeRecoveryAt: !fee ? Date.now() + 60_000 : undefined,
      relayStatus: fee ? "Preparing submission" : "awaiting_wallet",
      updatedAt: Date.now(),
    });
    if (fee) {
      if (!args.relayFromBlock || !/^\d+$/.test(args.relayFromBlock))
        throw new Error("Missing relay recovery block.");
      const call = delegatedAccountCall(args.intent, payment.token);
      const now = Date.now();
      const jobId = await ctx.db.insert("relayJobs", {
        disbursementId: payment._id,
        orgId: payment.orgId,
        chainId: payment.chainId!,
        safeTxHash: args.intent.hash,
        to: call.to,
        data: call.data,
        searchFromBlock: args.relayFromBlock,
        provider: "gelato_turbo",
        status: "prepared",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.relayExecutor.process, {
        jobId,
      });
    }
    await appendAudit(ctx, {
      orgId: payment.orgId,
      actorUserId: user._id,
      action: "disbursement.execution_claimed",
      objectType: "disbursement",
      objectId: payment._id,
      metadata: {
        method: "allowance",
        module: args.intent.module,
        delegate: args.intent.delegate,
      },
      timestamp: Date.now(),
    });
  },
});

export const recordSubmission = action({
  args: { ...publicArgs, txHash: v.string() },
  handler: async (ctx, args): Promise<void> => {
    assertValidTxHash(args.txHash);
    const expected = await ctx.runQuery(internal.delegatedPayments.context, {
      disbursementId: args.disbursementId,
      sessionToken: args.sessionToken,
    });
    const intent = expected.payment.allowanceExecution;
    if (!intent) throw new Error("No delegated authorization exists.");
    const tx = await getChainClient(intent.chainId).getTransaction({
      hash: args.txHash as Hex,
    });
    const expectedCall = delegatedAccountCall(intent, expected.payment.token);
    if (
      tx.to?.toLowerCase() !== expectedCall.to.toLowerCase() ||
      tx.input.toLowerCase() !== expectedCall.data.toLowerCase() ||
      tx.value !== 0n
    )
      throw new Error(
        "This transaction does not match the saved delegated authorization.",
      );
    await ctx.runMutation(internal.delegatedPayments.submitted, args);
  },
});

export const submitted = internalMutation({
  args: { ...publicArgs, txHash: v.string() },
  handler: async (ctx, args) => {
    assertValidTxHash(args.txHash);
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment?.allowanceExecution)
      throw new Error("No delegated authorization exists.");
    await requireOrgAccess(ctx, payment.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
    ]);
    if (payment.status === "executed") {
      if (payment.txHash?.toLowerCase() !== args.txHash.toLowerCase())
        throw new Error("This payment already has a different receipt");
      return;
    }
    if (
      payment.txHash &&
      payment.txHash.toLowerCase() !== args.txHash.toLowerCase()
    )
      throw new Error(
        "A transaction is already being reconciled for this payment.",
      );
    await ctx.db.patch(payment._id, {
      txHash: args.txHash.toLowerCase(),
      relayStatus: "submitted",
      updatedAt: Date.now(),
    });
    if (payment.nativeExecution && !payment.allowanceExecution.feeAuthorization)
      await ctx.scheduler.runAfter(0, internal.nativePayments.reconcile, {
        disbursementId: payment._id,
      });
    else
      await ctx.scheduler.runAfter(0, internal.delegatedPayments.reconcile, {
        disbursementId: payment._id,
        attempt: 0,
      });
  },
});
export const reconcile = internalAction({
  args: { disbursementId: v.id("disbursements"), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const expected = await ctx.runQuery(internal.delegatedPayments.context, {
      disbursementId: args.disbursementId,
    });
    if (
      !expected.payment.allowanceExecution ||
      !expected.payment.txHash ||
      expected.payment.status !== "relaying"
    )
      return;
    try {
      const receipt = await getChainClient(
        expected.payment.chainId!,
      ).getTransactionReceipt({ hash: expected.payment.txHash as Hex });
      if (
        (await getChainClient(expected.payment.chainId!).getBlockNumber()) <
        receipt.blockNumber + 1n
      )
        throw new Error("Waiting for a second confirmation.");
      if (receipt.status === "reverted") {
        await ctx.runMutation(internal.delegatedPayments.markReverted, {
          disbursementId: args.disbursementId,
          txHash: expected.payment.txHash,
        });
        return;
      }
      assertDelegatedReceipt(
        receipt,
        expected.safeAddress,
        expected.payment.token,
        expected.payment.allowanceExecution,
      );
      await ctx.runMutation(internal.delegatedPayments.confirm, {
        disbursementId: args.disbursementId,
        txHash: expected.payment.txHash,
        hash: expected.payment.allowanceExecution.hash,
        settlement: await readSettlementBlock(
          getChainClient(expected.payment.chainId!),
          expected.payment.chainId!,
          receipt,
        ),
      });
      return;
    } catch (error) {
      console.warn(
        "Delegated receipt verification pending",
        args.disbursementId,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
    if (args.attempt < 119)
      await ctx.scheduler.runAfter(
        30000,
        internal.delegatedPayments.reconcile,
        { ...args, attempt: args.attempt + 1 },
      );
  },
});
export const confirm = internalMutation({
  args: {
    settlement: v.optional(settlementBlockValidator),
    disbursementId: v.id("disbursements"),
    txHash: v.string(),
    hash: v.string(),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (
      !payment?.allowanceExecution ||
      payment.allowanceExecution.hash !== args.hash ||
      payment.txHash !== args.txHash
    )
      throw new Error("The delegated authorization changed.");
    if (args.settlement)
      assertSameSettlement(payment.settlement, args.settlement);
    if (payment.status === "executed") {
      if (args.settlement && !payment.settlement) {
        await ctx.db.patch(payment._id, {
          settlement: args.settlement,
          updatedAt: Date.now(),
        });
        await queueReportSource(ctx, payment.orgId, "payment", payment._id);
        await appendAudit(ctx, {
          orgId: payment.orgId,
          actorUserId: payment.delegatedBy ?? payment.createdBy,
          action: "disbursement.settlement_evidence",
          objectType: "disbursement",
          objectId: payment._id,
          metadata: { ...args.settlement, txHash: args.txHash },
          timestamp: Date.now(),
        });
      }
      return;
    }
    await ctx.db.patch(payment._id, {
      status: "executed",
      settlement: args.settlement,
      executedAt: Date.now(),
      updatedAt: Date.now(),
      relayStatus: "confirmed",
      nativeRecoveryAt: undefined,
    });
    await queueReportSource(ctx, payment.orgId, "payment", payment._id);
    await appendAudit(ctx, {
      orgId: payment.orgId,
      actorUserId: payment.delegatedBy ?? payment.createdBy,
      action: "disbursement.executed",
      objectType: "disbursement",
      objectId: payment._id,
      metadata: { txHash: args.txHash, source: "verified_allowance_receipt" },
      timestamp: Date.now(),
    });
  },
});

export const markReverted = internalMutation({
  args: { disbursementId: v.id("disbursements"), txHash: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (
      !payment?.allowanceExecution ||
      payment.status !== "relaying" ||
      payment.txHash !== args.txHash
    )
      return;
    if (payment.allowanceExecution.feeAuthorization) {
      await ctx.db.patch(payment._id, {
        relayStatus: "Needs review",
        relayError:
          "The relayed payment reverted. Neither the recipient payment nor its fee settled. Review the original authorization before retrying.",
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(payment._id, {
      txHash: undefined,
      nativeExecution: payment.nativeExecution
        ? {
            ...payment.nativeExecution,
            revertedAt: Date.now(),
            revertedTxHash: args.txHash,
            walletRejectedAt: undefined,
          }
        : undefined,
      nativeRecoveryAt: Date.now() + 60_000,
      relayStatus: "awaiting_wallet",
      relayError:
        "The transaction reverted without settling this payment. You may resume the same authorization after checking the account balance and allowance.",
      updatedAt: Date.now(),
    });
  },
});
