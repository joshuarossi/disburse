import { expect, it } from "vitest";
import { BaseError, UserRejectedRequestError } from "viem";
import {
  walletDeclined,
  walletErrorMessage,
  WALLET_CANCELLED_MESSAGE,
} from "../walletErrors";

it("turns nested Viem rejection diagnostics into a short cancellation message", () => {
  const error = new BaseError("User rejected the request.", {
    cause: new UserRejectedRequestError(
      new Error("MetaMask Tx Signature: User denied transaction signature."),
    ),
    metaMessages: [
      `Request Arguments: from: 0x${"aa".repeat(20)} data: 0x${"00".repeat(1000)}`,
    ],
  });
  expect(error.message.length).toBeGreaterThan(1000);
  expect(walletDeclined(error)).toBe(true);
  expect(walletErrorMessage(error, "Could not create the account.")).toBe(
    WALLET_CANCELLED_MESSAGE,
  );
});

it.each([4001, "4001", "ACTION_REJECTED"])(
  "recognizes explicit rejection inside provider wrappers: %s",
  (code) => {
    expect(
      walletDeclined({ error: { data: { originalError: { code } } } }),
    ).toBe(true);
  },
);

it("does not unlock a send after an ambiguous timeout, a message alone, or circular diagnostics", () => {
  const cyclic: Record<string, unknown> = {
    message: "User rejected request after connection timeout",
  };
  cyclic.cause = cyclic;
  for (const error of [
    cyclic,
    new Error("User rejected transaction"),
    { code: -32000 },
    null,
  ])
    expect(walletDeclined(error)).toBe(false);
});

it.each([
  "Request Arguments: value 10",
  "Version: viem@2.56.3",
  "Details: provider trace",
  `Failed call to 0x${"ab".repeat(20)}`,
  "Unknown error\nStack trace",
  "https://rpc.example/?key=secret",
])("removes technical diagnostics: %s", (message) => {
  expect(
    walletErrorMessage(new Error(message), "Check your wallet and try again."),
  ).toBe("Check your wallet and try again.");
});

it("preserves short validation messages and explains pending confirmations", () => {
  expect(
    walletErrorMessage(new Error("Select a funding account."), "Fallback"),
  ).toBe("Select a funding account.");
  expect(walletErrorMessage({ cause: { code: -32002 } }, "Fallback")).toContain(
    "already open",
  );
});

it('handles errors with throwing getters without creating another UI failure', () => {
  const error = Object.defineProperties({}, { code: { get() { throw new Error('unreadable code'); } }, cause: { get() { throw new Error('unreadable cause'); } }, message: { get() { throw new Error('unreadable message'); } } });
  expect(walletDeclined(error)).toBe(false);
  expect(walletErrorMessage(error, 'Could not complete this action.')).toBe('Could not complete this action.');
});
it('does not coerce a provider error name with a throwing toString', () => {
  const error = { name: { toString() { throw new Error('unreadable name'); } } };
  expect(walletErrorMessage(error, 'Could not complete this action.')).toBe('Could not complete this action.');
});
