import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  type Hex,
} from "viem";
import { amountToBaseUnits } from "./validation";
import type { ExecutionFee } from "./executionFee";

const transferAbi = parseAbi([
  "function transfer(address to,uint256 amount) returns (bool)",
]);
const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);
export type PaymentCall = {
  to: string;
  value: string;
  data: string | null;
  operation: number;
};

/** Decode canonical zero-native ERC-20 transfers, including CALL-only batches. */
export function decodePaymentTransfers(
  call: PaymentCall,
  allowedMultiSend: string[],
) {
  if (BigInt(call.value) !== 0n)
    throw new Error("Payment proposal contains an unexpected native transfer");
  const calls: PaymentCall[] = [];
  if (call.operation === 0) calls.push(call);
  else if (
    call.operation === 1 &&
    allowedMultiSend.some((a) => a.toLowerCase() === call.to.toLowerCase())
  ) {
    const decoded = decodeFunctionData({
      abi: multiSendAbi,
      data: (call.data ?? "0x") as Hex,
    });
    const canonical = encodeFunctionData({
      abi: multiSendAbi,
      functionName: "multiSend",
      args: decoded.args,
    });
    if (canonical.toLowerCase() !== call.data?.toLowerCase())
      throw new Error("Noncanonical batch calldata");
    const packed = decoded.args[0].slice(2);
    let offset = 0;
    while (offset < packed.length) {
      // operation(1), to(20), value(32), dataLength(32), data(N)
      if (packed.length - offset < 170 || calls.length >= 201)
        throw new Error("Invalid payment batch");
      const operation = Number.parseInt(packed.slice(offset, offset + 2), 16);
      const to = `0x${packed.slice(offset + 2, offset + 42)}`;
      const value = BigInt(
        `0x${packed.slice(offset + 42, offset + 106)}`,
      ).toString();
      const length = BigInt(`0x${packed.slice(offset + 106, offset + 170)}`);
      if (length !== 68n)
        throw new Error(
          "Only recipient transfers are allowed in a payment batch",
        );
      const end = offset + 170 + Number(length) * 2;
      if (end > packed.length) throw new Error("Truncated payment batch");
      calls.push({
        operation,
        to,
        value,
        data: `0x${packed.slice(offset + 170, end)}`,
      });
      offset = end;
    }
  } else
    throw new Error(
      "Payment proposal uses an unsupported contract or operation",
    );
  return calls.map((c) => {
    if (c.operation !== 0 || BigInt(c.value) !== 0n)
      throw new Error("Payment proposal contains an unexpected call");
    const decoded = decodeFunctionData({
      abi: transferAbi,
      data: (c.data ?? "0x") as Hex,
    });
    const canonical = encodeFunctionData({
      abi: transferAbi,
      functionName: "transfer",
      args: decoded.args,
    });
    if (canonical.toLowerCase() !== c.data?.toLowerCase())
      throw new Error("Noncanonical transfer calldata");
    return {
      tokenAddress: c.to.toLowerCase(),
      recipientAddress: decoded.args[0].toLowerCase(),
      amountRaw: decoded.args[1],
    };
  });
}

/** Accept only the exact transfer calls represented by the saved payment. */
export function assertPaymentIntent(
  call: PaymentCall,
  expected: {
    tokenAddress: string;
    token: string;
    recipients: Array<{ recipientAddress: string; amount: string }>;
    executionFee?: ExecutionFee;
  },
  allowedMultiSend: string[],
) {
  const actual = decodePaymentTransfers(call, allowedMultiSend)
    .map((c) => {
      if (
        ![expected.tokenAddress, expected.executionFee?.tokenAddress].some(
          (a) => a?.toLowerCase() === c.tokenAddress,
        )
      )
        throw new Error("Payment proposal contains an unexpected call");
      return `${c.tokenAddress}:${c.recipientAddress}:${c.amountRaw}`;
    })
    .sort();
  const intended = expected.recipients
    .map(
      (r) =>
        `${expected.tokenAddress.toLowerCase()}:${r.recipientAddress.toLowerCase()}:${amountToBaseUnits(r.amount, expected.token)}`,
    )
    .sort();
  if (expected.executionFee) {
    const fee = expected.executionFee;
    intended.push(
      `${fee.tokenAddress.toLowerCase()}:${fee.collector.toLowerCase()}:${amountToBaseUnits(fee.amount, fee.token)}`,
    );
    intended.sort();
  }
  if (
    !intended.length ||
    actual.length !== intended.length ||
    actual.some((value, i) => value !== intended[i])
  )
    throw new Error(
      "Proposal recipients or amounts do not match the saved payment",
    );
}
