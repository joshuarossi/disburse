import {
  concat,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  isAddress,
  keccak256,
  pad,
  parseAbi,
  parseEventLogs,
  slice,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { CHAIN_TOKENS } from "./chains";
import { stableAccountBatch } from "./stableAccountBatch";

// Official Circle CCTP V2 deployments, checked September 8, 2026.
// Sepolia is a receiving network here; it has no supported source gas service.
export const CCTP_SOURCE_CHAINS = [8453, 42161, 84532] as const;
const domains: Record<number, number> = {
  8453: 6,
  42161: 3,
  84532: 6,
  11155111: 0,
};
export const CCTP_QUOTE_LIFETIME = 10 * 60_000;
export function cctpConfiguration(chainId: number) {
  const domain = domains[chainId],
    token = CHAIN_TOKENS[chainId as keyof typeof CHAIN_TOKENS]?.USDC?.address;
  if (domain === undefined || !token)
    throw new Error("Account transfers are not supported on this network.");
  const testnet = chainId === 84532 || chainId === 11155111;
  return {
    chainId,
    domain,
    testnet,
    token: token as Address,
    api: testnet
      ? "https://iris-api-sandbox.circle.com"
      : "https://iris-api.circle.com",
    messenger: (testnet
      ? "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"
      : "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d") as Address,
    transmitter: (testnet
      ? "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275"
      : "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64") as Address,
    minter: (testnet
      ? "0xb43db544E2c27092c107639Ad201b3dEfAbcF192"
      : "0xfd78EE919681417d192449715b2594ab58f5D002") as Address,
  };
}
export function assertCctpRoute(chainId: number, destinationChainId: number) {
  const source = cctpConfiguration(chainId),
    destination = cctpConfiguration(destinationChainId);
  if (
    !(CCTP_SOURCE_CHAINS as readonly number[]).includes(chainId) ||
    source.testnet !== destination.testnet ||
    chainId === destinationChainId
  )
    throw new Error(
      "Choose different supported networks in the same activity environment.",
    );
  return { source, destination };
}

export const cctpAbi = parseAbi([
  "function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)",
  "function localMessageTransmitter() view returns(address)",
  "function localMinter() view returns(address)",
  "function remoteTokenMessengers(uint32) view returns(bytes32)",
  "function messageBodyVersion() view returns(uint32)",
  "function localDomain() view returns(uint32)",
  "function version() view returns(uint32)",
  "function paused() view returns(bool)",
  "event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)",
  "event MessageSent(bytes message)",
  "event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)",
  "event MintAndWithdraw(address indexed mintRecipient,uint256 amount,address indexed mintToken,uint256 feeCollected)",
]);

export type CctpQuote = {
  version: 1 | 2;
  provider: "circle_cctp";
  reference: Hex;
  chainId: number;
  destinationChainId: number;
  account: Address;
  destination: Address;
  amount: string;
  total: string;
  feeLimit: string;
  forwardFee: string;
  protocolFee: string;
  finality: 1000 | 2000;
  createdAt: number;
  expiresAt: number;
};

const amountPattern = /^(0|[1-9]\d{0,19})$/;
function integer(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(
      "The transfer service returned an invalid fee. Try another quote.",
    );
  return BigInt(value);
}
/** Fees are bps with decimal precision. Use exact integer arithmetic and round up. */
function feeRate(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100 ||
    !/^\d+(\.\d{1,6})?$/.test(String(value))
  )
    throw new Error(
      "The transfer service returned an invalid rate. Try another quote.",
    );
  const [whole, fraction = ""] = String(value).split(".");
  return {
    numerator: BigInt(whole + fraction.padEnd(6, "0")),
    denominator: 10_000_000_000n,
  };
}
export function makeCctpQuote(
  input: Pick<
    CctpQuote,
    | "reference"
    | "chainId"
    | "destinationChainId"
    | "account"
    | "destination"
    | "amount"
  >,
  response: unknown,
  now: number,
): CctpQuote {
  assertCctpRoute(input.chainId, input.destinationChainId);
  if (!Array.isArray(response) || response.length > 8)
    throw new Error("The transfer service did not return a usable quote.");
  // Standard finality avoids a fast-transfer allowance dependency. The provider
  // still charges and performs destination delivery, with no destination ETH.
  const row = response.find((r) => r && r.finalityThreshold === 2000);
  if (!row || !row.forwardFee)
    throw new Error(
      "Delivery fees are unavailable for this route. Try again later.",
    );
  const forwardFee = integer(row.forwardFee.high),
    rate = feeRate(row.minimumFee);
  if (forwardFee === 0n)
    throw new Error(
      "Delivery fees are unavailable for this route. Try again later.",
    );
  if (!amountPattern.test(input.amount) || BigInt(input.amount) <= 0n)
    throw new Error("Enter a positive transfer amount.");
  const amount = BigInt(input.amount),
    denominator = rate.denominator - rate.numerator;
  const total =
    ((amount + forwardFee) * rate.denominator + denominator - 1n) / denominator;
  const protocolFee = total - amount - forwardFee;
  const quote: CctpQuote = {
    ...input,
    version: 2,
    provider: "circle_cctp",
    total: String(total),
    feeLimit: String(total - amount),
    forwardFee: String(forwardFee),
    protocolFee: String(protocolFee),
    finality: 2000,
    createdAt: now,
    expiresAt: now + CCTP_QUOTE_LIFETIME,
  };
  validateCctpQuote(quote);
  return quote;
}
export function validateCctpQuote(q: CctpQuote) {
  assertCctpRoute(q.chainId, q.destinationChainId);
  if (
    ![1, 2].includes(q.version) ||
    q.provider !== "circle_cctp" ||
    !/^0x[\da-f]{64}$/i.test(q.reference) ||
    q.reference === zeroHash ||
    !isAddress(q.account) ||
    !isAddress(q.destination) ||
    q.account.toLowerCase() === zeroAddress ||
    q.destination.toLowerCase() === zeroAddress ||
    ![q.amount, q.total, q.feeLimit, q.forwardFee, q.protocolFee].every(
      (v) => typeof v === "string" && amountPattern.test(v),
    ) ||
    BigInt(q.amount) <= 0n ||
    BigInt(q.total) > 10_000_000_000_000n ||
    BigInt(q.total) !== BigInt(q.amount) + BigInt(q.feeLimit) ||
    BigInt(q.feeLimit) !== BigInt(q.forwardFee) + BigInt(q.protocolFee) ||
    q.finality !== 2000 ||
    !Number.isSafeInteger(q.createdAt) ||
    q.createdAt < 0 ||
    q.expiresAt !== q.createdAt + CCTP_QUOTE_LIFETIME
  )
    throw new Error(
      "The saved transfer quote is invalid. Check the original request.",
    );
}
export function decodeCctpQuote(raw: string): CctpQuote {
  if (raw.length > 4000)
    throw new Error("The saved transfer quote is too large.");
  const q = JSON.parse(raw) as CctpQuote;
  if (!q || typeof q !== "object")
    throw new Error("The saved transfer quote is invalid.");
  validateCctpQuote(q);
  return q;
}
export function cctpHook(reference: Hex, quoteVersion: 1 | 2 = 2): Hex {
  // The published single-hook format reserves bytes 32–51 for integrator data.
  // A 160-bit request reference distinguishes otherwise identical transfers.
  // Retain the original composable bytes only for recovery of saved v1 quotes:
  // sandbox attested those burns without creating a forwarding job.
  if (quoteVersion === 2)
    return concat([
      stringToHex("cctp-forward", { size: 24 }),
      toHex(0, { size: 4 }),
      toHex(0, { size: 4 }),
      slice(reference, 0, 20),
    ]);
  return concat([
    stringToHex("cctp-forward", { size: 24 }),
    toHex(1, { size: 4 }),
    toHex(0, { size: 4 }),
    stringToHex("disburse-transfer", { size: 24 }),
    toHex(1, { size: 4 }),
    toHex(32, { size: 4 }),
    reference,
  ]);
}
export function cctpCall(q: CctpQuote) {
  validateCctpQuote(q);
  const { source, destination } = assertCctpRoute(
    q.chainId,
    q.destinationChainId,
  );
  return stableAccountBatch(q.chainId, [
    {
      to: source.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [source.messenger, 0n],
      }),
    },
    {
      to: source.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [source.messenger, BigInt(q.total)],
      }),
    },
    {
      to: source.messenger,
      data: encodeFunctionData({
        abi: cctpAbi,
        functionName: "depositForBurnWithHook",
        args: [
          BigInt(q.total),
          destination.domain,
          pad(q.destination, { size: 32 }),
          source.token,
          zeroHash,
          BigInt(q.feeLimit),
          q.finality,
          cctpHook(q.reference, q.version),
        ],
      }),
    },
    {
      to: source.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [source.messenger, 0n],
      }),
    },
  ]);
}
export function cctpQuoteHash(q: CctpQuote) {
  const call = cctpCall(q);
  return keccak256(
    encodePacked(
      ["uint256", "address", "bytes32", "uint256", "bytes"],
      [
        BigInt(q.chainId),
        q.account,
        q.reference,
        BigInt(q.expiresAt),
        call.data,
      ],
    ),
  );
}

function bodyForQuote(q: CctpQuote, fee = 0n, expiration = 0n) {
  const config = cctpConfiguration(q.chainId);
  return encodePacked(
    [
      "uint32",
      "bytes32",
      "bytes32",
      "uint256",
      "bytes32",
      "uint256",
      "uint256",
      "uint256",
      "bytes",
    ],
    [
      1,
      pad(config.token, { size: 32 }),
      pad(q.destination, { size: 32 }),
      BigInt(q.total),
      pad(q.account, { size: 32 }),
      BigInt(q.feeLimit),
      fee,
      expiration,
      cctpHook(q.reference, q.version),
    ],
  );
}
export function cctpBurnMessage(q: CctpQuote) {
  const { source, destination } = assertCctpRoute(
    q.chainId,
    q.destinationChainId,
  );
  return encodePacked(
    [
      "uint32",
      "uint32",
      "uint32",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
      "uint32",
      "uint32",
      "bytes",
    ],
    [
      1,
      source.domain,
      destination.domain,
      zeroHash,
      pad(source.messenger, { size: 32 }),
      pad(destination.messenger, { size: 32 }),
      zeroHash,
      q.finality,
      0,
      bodyForQuote(q),
    ],
  );
}
export function assertCctpBurn(
  q: CctpQuote,
  logs: Log[],
  boundary: { executionStart: number; executionEnd: number },
) {
  validateCctpQuote(q);
  const { source, destination } = assertCctpRoute(
    q.chainId,
    q.destinationChainId,
  );
  const scoped = logs.filter(
    (l) =>
      !l.removed &&
      l.logIndex !== null &&
      l.logIndex > boundary.executionStart &&
      l.logIndex < boundary.executionEnd,
  );
  const burns = parseEventLogs({
    abi: cctpAbi,
    logs: scoped,
    eventName: "DepositForBurn",
    strict: true,
  }).filter((e) => e.address.toLowerCase() === source.messenger.toLowerCase());
  const messages = parseEventLogs({
    abi: cctpAbi,
    logs: scoped,
    eventName: "MessageSent",
    strict: true,
  }).filter(
    (e) => e.address.toLowerCase() === source.transmitter.toLowerCase(),
  );
  if (burns.length !== 1 || messages.length !== 1)
    throw new Error("The transfer's source receipt is incomplete.");
  const b = burns[0].args;
  if (
    b.depositor.toLowerCase() !== q.account.toLowerCase() ||
    b.burnToken.toLowerCase() !== source.token.toLowerCase() ||
    b.amount !== BigInt(q.total) ||
    b.mintRecipient.toLowerCase() !==
      pad(q.destination, { size: 32 }).toLowerCase() ||
    b.destinationDomain !== destination.domain ||
    b.destinationTokenMessenger.toLowerCase() !==
      pad(destination.messenger, { size: 32 }).toLowerCase() ||
    b.destinationCaller !== zeroHash ||
    b.maxFee !== BigInt(q.feeLimit) ||
    b.minFinalityThreshold !== q.finality ||
    b.hookData.toLowerCase() !==
      cctpHook(q.reference, q.version).toLowerCase() ||
    messages[0].args.message.toLowerCase() !== cctpBurnMessage(q).toLowerCase()
  )
    throw new Error("The source receipt does not match the approved transfer.");
  const transfers = parseEventLogs({
    abi: erc20Abi,
    logs: scoped,
    eventName: "Transfer",
    strict: true,
  }).filter((e) => e.args.from.toLowerCase() === q.account.toLowerCase());
  if (
    transfers.length !== 1 ||
    transfers[0].address.toLowerCase() !== source.token.toLowerCase() ||
    transfers[0].args.to.toLowerCase() !== source.minter.toLowerCase() ||
    transfers[0].args.value !== BigInt(q.total)
  )
    throw new Error("The source account debit does not match this transfer.");
  return {
    message: messages[0].args.message,
    logIndex: transfers[0].logIndex,
    messageLogIndex: messages[0].logIndex,
  };
}

/** The provider's transaction hash is only a hint. This checks canonical CCTP
 * events and token mint evidence, including the request's unique hook. */
export function assertCctpDelivery(q: CctpQuote, logs: Log[]) {
  validateCctpQuote(q);
  if (logs.some((l) => l.removed))
    throw new Error("The destination receipt was reorganized. Check it again.");
  const { source, destination } = assertCctpRoute(
    q.chainId,
    q.destinationChainId,
  );
  const events = parseEventLogs({
    abi: cctpAbi,
    logs,
    eventName: "MessageReceived",
    strict: true,
  });
  const matches = events.filter(
    (e) =>
      e.eventName === "MessageReceived" &&
      e.address.toLowerCase() === destination.transmitter.toLowerCase() &&
      e.args.sourceDomain === source.domain &&
      e.args.sender.toLowerCase() ===
        pad(source.messenger, { size: 32 }).toLowerCase() &&
      e.args.messageBody.length === bodyForQuote(q).length &&
      e.args.messageBody
        .toLowerCase()
        .endsWith(cctpHook(q.reference, q.version).slice(2).toLowerCase()),
  );
  if (matches.length !== 1)
    throw new Error(
      "The receiving account has not supplied this transfer's delivery evidence.",
    );
  const match = matches[0],
    body = match.args.messageBody;
  const fee = BigInt(slice(body, 164, 196)),
    expiration = BigInt(slice(body, 196, 228));
  if (
    match.args.nonce === zeroHash ||
    match.args.finalityThresholdExecuted < q.finality ||
    body.toLowerCase() !== bodyForQuote(q, fee, expiration).toLowerCase() ||
    fee > BigInt(q.feeLimit)
  )
    throw new Error(
      "The delivered amount or service fee differs from the approved transfer.",
    );
  const amount = BigInt(q.total) - fee;
  const priorReceive = events
    .filter(
      (e) =>
        e.eventName === "MessageReceived" &&
        e.address.toLowerCase() === destination.transmitter.toLowerCase() &&
        e.logIndex < match.logIndex,
    )
    .reduce((previous, event) => Math.max(previous, event.logIndex), -1);
  const mints = parseEventLogs({
    abi: cctpAbi,
    logs,
    eventName: "MintAndWithdraw",
    strict: true,
  }).filter(
    (e) =>
      e.address.toLowerCase() === destination.messenger.toLowerCase() &&
      e.logIndex > priorReceive &&
      e.logIndex < match.logIndex &&
      e.args.mintRecipient.toLowerCase() === q.destination.toLowerCase(),
  );
  const transfers = parseEventLogs({
    abi: erc20Abi,
    logs,
    eventName: "Transfer",
    strict: true,
  }).filter(
    (e) =>
      e.address.toLowerCase() === destination.token.toLowerCase() &&
      e.args.from === zeroAddress &&
      e.args.to.toLowerCase() === q.destination.toLowerCase() &&
      e.logIndex > priorReceive &&
      e.logIndex < match.logIndex,
  );
  if (
    amount < BigInt(q.amount) ||
    mints.length !== 1 ||
    mints[0].args.amount !== amount ||
    mints[0].args.feeCollected !== fee ||
    mints[0].args.mintToken.toLowerCase() !== destination.token.toLowerCase() ||
    transfers.length !== 1 ||
    transfers[0].args.value !== amount
  )
    throw new Error(
      "The receiving account's token movement could not be verified.",
    );
  return {
    amount: String(amount),
    fee: String(fee),
    nonce: match.args.nonce,
    logIndex: transfers[0].logIndex,
  };
}
