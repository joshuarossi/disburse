import { keccak256, toHex, type Address } from "viem";
import { cctpQuoteHash, makeCctpQuote } from "../../../shared/cctp";
import { readCircleFixture, saveCircleFixture } from "./circle";
import { safes } from "./fixtures";

export function treasuryAccounts() {
  return [
    { ...safes[0], name: "Operations" },
    {
      ...safes[0],
      _id: "safe2",
      name: "Payroll",
      chainId: 42161,
      safeAddress: "0x9999999999999999999999999999999999999999",
    },
  ];
}
export function readTreasuryFixture() {
  return JSON.parse(sessionStorage.getItem("qa:treasury") ?? "null");
}
export function saveTreasuryFixture(value: unknown) {
  sessionStorage.setItem("qa:treasury", JSON.stringify(value));
}
export async function treasuryFixtureAction(
  name: string,
  args: {
    safeId?: string;
    destinationSafeId?: string;
    amount?: string;
    requestId?: string;
    txHash?: string;
  },
) {
  const scenario = sessionStorage.getItem("qa:scenario") ?? "",
    saved = readTreasuryFixture();
  if (name === "treasuryActions:prepare") {
    if (saved?.open) {
      if (args.requestId === saved.requestId) return saved._id;
      throw new Error(
        "This account already has a transfer awaiting approval. Complete or stop that request first.",
      );
    }
    if (scenario.endsWith("quote-outage"))
      throw new Error(
        "The transfer service is unavailable. Try again shortly.",
      );
    const accounts = treasuryAccounts(),
      source = accounts.find((a) => a._id === args.safeId)!,
      destination = accounts.find((a) => a._id === args.destinationSafeId)!;
    const quote = makeCctpQuote(
      {
        reference: keccak256(toHex(args.requestId!)),
        chainId: source.chainId,
        destinationChainId: destination.chainId,
        account: source.safeAddress as Address,
        destination: destination.safeAddress as Address,
        amount: args.amount!,
      },
      [
        {
          finalityThreshold: 2000,
          minimumFee: 0,
          forwardFee: { high: 250000 },
        },
      ],
      Date.now(),
    );
    saveTreasuryFixture({
      _id: "treasury1",
      orgId: "demo",
      safeId: source._id,
      destinationSafeId: destination._id,
      chainId: source.chainId,
      destinationChainId: destination.chainId,
      requestId: args.requestId,
      quote: JSON.stringify(quote),
      hash: cctpQuoteHash(quote),
      status: "quoted",
      open: true,
      createdAt: Date.now(),
    });
    sessionStorage.removeItem("qa:circle");
    if (scenario.endsWith("quote-lost"))
      throw new Error(
        "The quote response was interrupted. Check the saved transfer in your account list.",
      );
    return "treasury1";
  }
  if (name === "treasury:stop") {
    const current = readCircleFixture();
    if (saved.status === "processing" || saved.sourceTxHash)
      throw new Error(
        "Check the original transfer before taking another action.",
      );
    if (current?.operationApprovalStartedAt || current?.stage === "ready") {
      sessionStorage.setItem(
        "qa:treasury-originalCircle",
        JSON.stringify(current),
      );
      saveTreasuryFixture({
        ...saved,
        cancellationRequestedAt: Date.now(),
        circleExecutionId: current._id,
      });
      sessionStorage.removeItem("qa:circle");
      return { cancelled: false, executionId: current._id };
    }
    if (current)
      saveCircleFixture({ ...current, open: false, stage: "cancelled" });
    saveTreasuryFixture({ ...saved, open: false, status: "cancelled" });
    return { cancelled: true };
  }
  if (name === "treasury:reportDelivery") {
    if (
      saved.status !== "delivering" ||
      !/^0x[\da-f]{64}$/i.test(args.txHash ?? "")
    )
      throw new Error(
        "Enter the full receiving transaction hash, starting with 0x.",
      );
    saveTreasuryFixture({
      ...saved,
      deliveryHint: args.txHash,
      error:
        "The supplied receipt has not confirmed this transfer. We will keep checking the original transfer.",
    });
    return;
  }
  if (name === "treasury:queue") {
    if (scenario.endsWith("delivery-outage")) {
      saveTreasuryFixture({
        ...saved,
        error:
          "Delivery could not be verified yet. Your original transfer is saved and will be checked again. Do not send a replacement.",
      });
    } else if (saved.status === "delivering") {
      const quote = JSON.parse(saved.quote);
      saveTreasuryFixture({
        ...saved,
        status: "completed",
        deliveredAmount: String(BigInt(quote.amount) + 50000n),
        deliveryFee: "200000",
        destinationTxHash: `0x${"cd".repeat(32)}`,
        error: undefined,
      });
    }
  }
}
export function treasuryCircleStep(name: string) {
  const saved = readTreasuryFixture();
  if (!saved) return;
  if (name === "circlePayments:prepare" && !saved.cancellationRequestedAt)
    saveTreasuryFixture({
      ...saved,
      status: "approving",
      circleExecutionId: "circle1",
    });
  if (name === "circlePayments:submit" && !saved.cancellationRequestedAt)
    saveTreasuryFixture({ ...saved, status: "processing" });
  if (name === "circlePayments:recheck") {
    const execution = readCircleFixture();
    if (execution?.stage === "confirmed")
      saveTreasuryFixture({
        ...saved,
        open: false,
        status: saved.cancellationRequestedAt ? "cancelled" : "delivering",
        sourceTxHash: saved.cancellationRequestedAt
          ? undefined
          : `0x${"ab".repeat(32)}`,
      });
    if (execution?.stage === "confirmed" && saved.cancellationRequestedAt) {
      const original = JSON.parse(
        sessionStorage.getItem("qa:treasury-originalCircle")!,
      );
      sessionStorage.setItem(
        "qa:treasury-originalCircle",
        JSON.stringify({ ...original, stage: "cancelled", open: false }),
      );
    }
    if (["failed", "expired"].includes(execution?.stage))
      saveTreasuryFixture({ ...saved, open: false, status: execution.stage });
  }
}
