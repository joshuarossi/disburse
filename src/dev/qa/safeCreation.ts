export async function createSafe(
  owners: string[],
  threshold: number,
  saltNonce: string,
  chainId: number,
) {
  if (!sessionStorage.getItem("qa:scenario")?.startsWith("onboarding-wallet-"))
    throw new Error("Account creation is disabled in visual QA.");
  sessionStorage.setItem(
    "qa:safeCreation",
    JSON.stringify({ owners, threshold, saltNonce, chainId }),
  );
  return {
    predictedAddress: "0x1111111111111111111111111111111111111111",
    deployTx: {
      to: "0x2222222222222222222222222222222222222222",
      data: "0x1234",
      value: 0n,
    },
  };
}
