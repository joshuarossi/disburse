export function walletDeclined(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 8 && current && typeof current === "object";
    depth++
  ) {
    if ("code" in current && current.code === 4001) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
