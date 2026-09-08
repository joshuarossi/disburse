type Attempt = {
  claimId: string;
  batchId: string;
  phase: "claiming" | "wallet" | "declined";
};
const key = (setupId: string) => `disburse:wallet-setup:${setupId}`;
/** This local record contains only request identifiers. Writing the wallet
 * phase must succeed before a request can open a submitting wallet prompt. */
export function saveWalletSetupAttempt(setupId: string, attempt: Attempt) {
  try {
    localStorage.setItem(key(setupId), JSON.stringify(attempt));
  } catch {
    throw new Error(
      "This browser could not save the recovery details. Allow site storage before confirming account setup.",
    );
  }
}
export function readWalletSetupAttempt(setupId: string): Attempt | null {
  try {
    const raw = JSON.parse(
      localStorage.getItem(key(setupId)) ?? "null",
    ) as Attempt | null;
    return raw &&
      /^[\da-f-]{36}$/i.test(raw.claimId) &&
      /^0x[\da-f]{64}$/i.test(raw.batchId) &&
      ["claiming", "wallet", "declined"].includes(raw.phase)
      ? raw
      : null;
  } catch {
    return null;
  }
}
export function clearWalletSetupAttempt(setupId: string) {
  // The server has already closed or reset this exact claim. An old local
  // marker cannot authorize a new claim, and cleanup must not hide completion.
  try {
    localStorage.removeItem(key(setupId));
  } catch {
    /* Optional cleanup. */
  }
}
