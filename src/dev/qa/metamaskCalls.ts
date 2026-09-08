export async function checkCustomerWallet() {
  if (!sessionStorage.getItem("qa:scenario")?.startsWith("account-fee-"))
    throw new Error("Wallet signing is disabled in visual QA.");
  return { request: async () => null };
}
export function walletRequestNotAccepted(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    Number(error.code) === 4001
  );
}
export async function submitCustomerWalletCalls() {
  const scenario = sessionStorage.getItem("qa:scenario") ?? "";
  sessionStorage.setItem(
    "qa:fee-wallet-attempts",
    String(Number(sessionStorage.getItem("qa:fee-wallet-attempts") ?? 0) + 1),
  );
  if (scenario.endsWith("declined") || scenario.endsWith("decline-save-failed"))
    throw Object.assign(
      new Error(
        "User rejected request. Request Arguments: 0xdead Version: viem",
      ),
      { code: 4001 },
    );
  sessionStorage.setItem(
    "qa:fee-wallet-submissions",
    String(
      Number(sessionStorage.getItem("qa:fee-wallet-submissions") ?? 0) + 1,
    ),
  );
  if (scenario.endsWith("unknown")) throw new Error("Wallet connection lost");
}
export async function checkCustomerWalletCalls() {
  return { status: 100 };
}
