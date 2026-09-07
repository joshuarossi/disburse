import { describe, expect, it } from "vitest";
import { hashMessage, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAddress, verifyMessage } from "../signatures";
const account = privateKeyToAccount(`0x${"12".repeat(32)}`);
describe("Convex-compatible signature verification", () => {
  it("verifies a real personal signature and rejects tampering", async () => {
    const message = "Sign in to the QA workspace";
    const signature = await account.signMessage({ message });
    expect(
      verifyMessage({ address: account.address, message, signature }),
    ).toBe(true);
    expect(
      verifyMessage({
        address: account.address,
        message: message + "!",
        signature,
      }),
    ).toBe(false);
    expect(
      verifyMessage({ address: `0x${"23".repeat(20)}`, message, signature }),
    ).toBe(false);
  });
  it("recovers an unprefixed Safe digest", async () => {
    const hash = keccak256(stringToHex("Safe transaction digest"));
    const signature = await account.sign({ hash });
    expect(recoverAddress({ hash, signature })).toBe(account.address);
  });
  it("accepts 0/1 recovery parity as well as 27/28", async () => {
    const message = "QA parity";
    const signed = await account.signMessage({ message });
    const parity = (parseInt(signed.slice(-2), 16) - 27)
      .toString(16)
      .padStart(2, "0");
    expect(
      recoverAddress({
        hash: hashMessage(message),
        signature: `${signed.slice(0, -2)}${parity}` as `0x${string}`,
      }),
    ).toBe(account.address);
  });
  it("rejects malformed and unsupported recovery values", () => {
    for (const signature of [
      "0x",
      `0x${"00".repeat(65)}`,
      `0x${"12".repeat(64)}1f`,
    ] as const) {
      expect(
        verifyMessage({ address: account.address, message: "QA", signature }),
      ).toBe(false);
    }
  });
});
