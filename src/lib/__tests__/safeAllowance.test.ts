import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import {
  allowanceAbi,
  buildAllowanceGrant,
  buildAllowanceRevocation,
  getAllowanceDeployments,
  safeModuleAbi,
} from "../safeAllowance";

const safe = "0x1111111111111111111111111111111111111111";
const delegate = "0x2222222222222222222222222222222222222222";
const module = getAllowanceDeployments(1)[0].address;
const grant = {
  chainId: 1,
  safe,
  module,
  delegate,
  token: "USDC",
  amount: "1000.000001",
  resetMinutes: 10080,
  moduleEnabled: false,
  delegateExists: false,
};

describe("Safe allowance policy proposals", () => {
  it("enables the module, adds the delegate, then sets the exact token allowance", () => {
    const txs = buildAllowanceGrant(grant);
    expect(txs).toHaveLength(3);
    expect(txs[0].to).toBe(safe);
    expect(
      decodeFunctionData({
        abi: safeModuleAbi,
        data: txs[0].data as `0x${string}`,
      }),
    ).toEqual({ functionName: "enableModule", args: [module] });
    expect(
      decodeFunctionData({
        abi: allowanceAbi,
        data: txs[1].data as `0x${string}`,
      }),
    ).toEqual({ functionName: "addDelegate", args: [delegate] });
    const decoded = decodeFunctionData({
      abi: allowanceAbi,
      data: txs[2].data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("setAllowance");
    expect(decoded.args).toEqual([
      delegate,
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      1000000001n,
      10080,
      0,
    ]);
    expect(txs.every((tx) => tx.operation === 0 && tx.value === "0")).toBe(
      true,
    );
  });
  it("updates existing grants without resetting spent amounts or enabling twice", () => {
    const txs = buildAllowanceGrant({
      ...grant,
      moduleEnabled: true,
      delegateExists: true,
    });
    expect(txs).toHaveLength(1);
    expect(
      decodeFunctionData({
        abi: allowanceAbi,
        data: txs[0].data as `0x${string}`,
      }).functionName,
    ).toBe("setAllowance");
  });
  it("rejects zero, negative, imprecise and overflowing limits", () => {
    for (const amount of ["0", "-1", "1.0000001", "79228162514264337593544"])
      expect(() => buildAllowanceGrant({ ...grant, amount })).toThrow();
  });
  it("rejects unrecognized modules, currencies, reset periods and unsafe delegates", () => {
    expect(() => buildAllowanceGrant({ ...grant, module: delegate })).toThrow(
      "Unsupported allowance",
    );
    expect(() => buildAllowanceGrant({ ...grant, token: "EURC" })).toThrow(
      "Currency",
    );
    expect(() =>
      buildAllowanceGrant({ ...grant, resetMinutes: 65536 }),
    ).toThrow("reset period");
    expect(() => buildAllowanceGrant({ ...grant, delegate: safe })).toThrow(
      "separate delegate",
    );
    expect(() =>
      buildAllowanceGrant({
        ...grant,
        delegate: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow();
  });
  it("revokes exactly one token allowance without disabling unrelated delegates", () => {
    const txs = buildAllowanceRevocation(1, module, delegate, safe);
    expect(txs).toHaveLength(1);
    expect(txs[0].to).toBe(module);
    expect(
      decodeFunctionData({
        abi: allowanceAbi,
        data: txs[0].data as `0x${string}`,
      }),
    ).toEqual({ functionName: "deleteAllowance", args: [delegate, safe] });
  });
  it("does not guess module addresses on unsupported networks", () => {
    // Published 1.0.0 was deployed and its exact runtime verified on Base Sepolia.
    expect(getAllowanceDeployments(84532).map((d) => d.version)).toEqual([
      "1.0.0",
    ]);
    expect(getAllowanceDeployments(42161).map((d) => d.version)).toEqual([
      "1.0.0",
      "0.1.1",
    ]);
    expect(getAllowanceDeployments(999)).toEqual([]);
    expect(getAllowanceDeployments(137).map((d) => d.version)).toEqual([
      "1.0.0",
      "0.1.1",
      "0.1.0",
    ]);
  });
  it("allows revocation of legacy grants but refuses new authority on them", () => {
    for (const legacy of getAllowanceDeployments(137).filter((d) => d.legacy)) {
      expect(() =>
        buildAllowanceGrant({ ...grant, chainId: 137, module: legacy.address }),
      ).toThrow("outdated");
      expect(
        buildAllowanceRevocation(137, legacy.address, delegate, safe),
      ).toHaveLength(1);
    }
  });
});
