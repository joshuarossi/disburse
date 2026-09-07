export const ALLOWANCE_PERIODS = [
  { label: "One-time allowance", minutes: 0 },
  { label: "Every day", minutes: 1440 },
  { label: "Every 7 days", minutes: 10080 },
  { label: "Every 30 days", minutes: 43200 },
];
export const getAllowanceDeployments = () => [
  {
    address: "0x691f59471Bfd2B7d639DCF74671a2d648ED1E331",
    version: "1.0.0",
    legacy: false,
  },
  ...(sessionStorage.getItem("qa:scenario") === "access-legacy"
    ? [
        {
          address: "0xAA46724893dedD72658219405185Fb0Fc91e091C",
          version: "0.1.1",
          legacy: true,
        },
      ]
    : []),
];
export const buildAllowanceGrant = () => {
  throw new Error("Signing is disabled in visual QA mode.");
};
export const buildAllowanceRevocation = buildAllowanceGrant;
import { getTokensForChain } from "../../lib/chains";
import { safes, wallet } from "./fixtures";
export async function readAllowanceSnapshot(
  _chainId?: number,
  _safe?: string,
  _module?: string,
  delegate?: string,
) {
  const scenario = sessionStorage.getItem("qa:scenario");
  if (scenario === "access-grants-outage")
    throw new Error("The network is unavailable");
  return {
    moduleEnabled: scenario !== "access-disabled",
    owners: [wallet],
    delegates: [safes[0].owners[1]],
    blockNumber: 35000000n,
    safeVersion: '1.4.1',
    allowances:
      delegate && delegate.toLowerCase() !== safes[0].owners[1].toLowerCase()
        ? []
        : [
            {
              delegate: safes[0].owners[1],
              token: getTokensForChain(8453).USDC.address,
              amount: 25000000000n,
              spent: 4500000000n,
              resetMinutes: 43200,
              lastResetMinutes: Math.floor(Date.now() / 60000),
              nonce: 1n,
            },
          ],
  };
}
