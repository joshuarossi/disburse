import { toHex } from "viem";
import { circleConfiguration } from "./circleExecution";
import { readServiceJson } from "./serviceResponse";

export class CircleServiceError extends Error {
  constructor(
    public readonly code:
      | "unavailable"
      | "expired"
      | "approval"
      | "simulation"
      | "pending"
      | "not_due",
    message: string,
  ) {
    super(message);
    this.name = "CircleServiceError";
  }
}
export const circleRpcMethods = [
  "eth_chainId",
  "eth_supportedEntryPoints",
  "eth_estimateUserOperationGas",
  "eth_sendUserOperation",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
] as const;
type Method = (typeof circleRpcMethods)[number];

/** Public, unbilled submission endpoint. No credentials, gas sponsorship or
 * automatic retry. A send error must retain the original operation hash. */
export async function circleRpc(
  chainId: number,
  method: Method,
  params: unknown[],
): Promise<unknown> {
  circleConfiguration(chainId);
  if (!circleRpcMethods.includes(method))
    throw new Error("Unsupported execution service request");
  const body = JSON.stringify(
    { jsonrpc: "2.0", id: 1, method, params },
    (_, value) => (typeof value === "bigint" ? toHex(value) : value),
  );
  if (new TextEncoder().encode(body).byteLength > 524_288)
    throw new Error(
      "This account operation is too large. Use a smaller payment batch.",
    );
  const signal = AbortSignal.timeout(20_000);
  let response: Response;
  try {
    response = await fetch(`https://api.candide.dev/public/v3/${chainId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "omit",
      redirect: "error",
      signal,
    });
  } catch {
    throw new CircleServiceError(
      "unavailable",
      "The execution service could not be reached. Check any pending request before trying again.",
    );
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new CircleServiceError(
      "unavailable",
      response.status === 429
        ? "The execution service is busy. Wait a moment and check your original request."
        : "The execution service is unavailable. Try checking again shortly.",
    );
  }
  let data: Record<string, unknown>;
  try {
    const parsed = await readServiceJson(response, 524_288, signal);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    data = parsed as Record<string, unknown>;
    if (
      data.jsonrpc !== "2.0" ||
      data.id !== 1 ||
      "result" in data === "error" in data
    )
      throw new Error();
  } catch {
    throw new CircleServiceError(
      "unavailable",
      "The execution service returned an unreadable response. Check the original request before trying again.",
    );
  }
  if ("error" in data) {
    const error =
      data.error && typeof data.error === "object" && !Array.isArray(data.error)
        ? (data.error as Record<string, unknown>)
        : {};
    const message = typeof error.message === "string" ? error.message : "";
    if (/\bAA(?:22|32)\b/.test(message))
      throw new CircleServiceError(
        "expired",
        "This execution quote expired. Check its status before preparing a new approval.",
      );
    if (/\bAA(?:24|34)\b/.test(message))
      throw new CircleServiceError(
        "approval",
        "The account or fee authorization could not be verified. Refresh the current approval requirements.",
      );
    if (/\bAA(?:10|25)\b/.test(message))
      throw new CircleServiceError(
        "pending",
        "The account state changed. Check the original execution before preparing another request.",
      );
    if (error.code === -32521)
      throw new CircleServiceError(
        "simulation",
        "The network simulation rejected this operation. Check the account balance and payment details before trying again.",
      );
    // AA31 is the provider's balance, not an instruction to fund Disburse.
    throw new CircleServiceError(
      "unavailable",
      "The execution service could not accept this request. Check the account balance and fee authorization, then refresh its status.",
    );
  }
  return data.result;
}
