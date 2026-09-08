/** Safe's Builder plan is free and stops at its quota. It does not bill
 * overages or upgrade automatically. Keep paid plans out of product defaults. */
export function safeReadHeaders(
  chainId: number,
  environment: Record<string, string | undefined> = process.env,
) {
  const key = environment.SAFE_TX_SERVICE_API_KEY?.trim();
  const plan = environment.SAFE_TX_SERVICE_PLAN?.trim();
  if (key && plan === "builder") return { Authorization: `Bearer ${key}` };
  if (key || (plan && plan !== "public"))
    throw new Error(
      "Account history requires the free Safe Builder plan. Configure its key and SAFE_TX_SERVICE_PLAN=builder; do not configure a paid service plan.",
    );
  // Public access is documented for exploration. Keep it available for the
  // isolated testnets, without treating it as production capacity.
  if ([11155111, 84532].includes(chainId)) return undefined;
  throw new Error(
    "Account history is not configured. Set up a free Safe Builder key in the server configuration.",
  );
}
