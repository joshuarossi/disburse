import { getAllowanceModuleDeployment } from "@safe-global/safe-modules-deployments";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import { CHAIN_TOKENS } from "./chains";

// Safe allowances/v1.0.0 fixes nonce replay and false-return ERC-20 transfers.
// The published deployment package does not yet include this release.
// Provenance and reproducible verification: docs/SAFE_ALLOWANCE_UPGRADE.md.
export const CURRENT_ALLOWANCE = {
  version: "1.0.0",
  address: getAddress("0x691f59471Bfd2B7d639DCF74671a2d648ED1E331"),
  codeHash:
    "0xfafc86ce3000fbdc8ad155875c0b3b5a20d17662e7c2cdbf3e95f15945a46657" as Hex,
};
const verifiedNetworks = new Set([1, 137, 8453, 42161, 11155111, 84532]);
export type AllowanceDeployment = {
  address: Address;
  version: string;
  legacy: boolean;
};

export function allowanceDeployments(chainId: number): AllowanceDeployment[] {
  if (!(chainId in CHAIN_TOKENS)) return [];
  return [
    ...(verifiedNetworks.has(chainId)
      ? [{ ...CURRENT_ALLOWANCE, legacy: false }]
      : []),
    ...["0.1.1", "0.1.0"].flatMap((version) => {
      const address = getAllowanceModuleDeployment({
        network: String(chainId),
        version,
      })?.networkAddresses[String(chainId)];
      return address
        ? [{ address: getAddress(address), version, legacy: true }]
        : [];
    }),
  ];
}

export function assertCurrentAllowance(chainId: number, address: string) {
  if (
    !allowanceDeployments(chainId).some(
      (d) => !d.legacy && d.address.toLowerCase() === address.toLowerCase(),
    )
  )
    throw new Error(
      "This spending grant uses an outdated module. Account owners must replace it with the current version before sending.",
    );
}

export function assertAllowanceRuntime(address: string, code: Hex | undefined) {
  if (!code || code === "0x")
    throw new Error("The allowance module is not deployed on this network");
  if (
    address.toLowerCase() === CURRENT_ALLOWANCE.address.toLowerCase() &&
    keccak256(code) !== CURRENT_ALLOWANCE.codeHash
  )
    throw new Error(
      "The spending module does not match the verified Safe release",
    );
}

export const supportsCurrentAllowance = (safeVersion: string) =>
  ["1.3.0", "1.4.1"].includes(safeVersion);
