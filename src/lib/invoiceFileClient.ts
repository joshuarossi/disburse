import type { Id } from "../../convex/_generated/dataModel";

function endpoint(params: Record<string, string>) {
  const explicit = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
  const cloud = import.meta.env.VITE_CONVEX_URL as string | undefined;
  const origin =
    explicit ||
    (cloud?.endsWith(".convex.cloud")
      ? cloud.replace(/\.cloud$/, ".site")
      : "");
  if (!origin)
    throw new Error(
      "Invoice document storage is not available. Try again later.",
    );
  const url = new URL("/invoice-files", origin);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Invoice document storage is not available.");
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return url;
}
export async function uploadInvoiceFile(
  file: File,
  orgId: Id<"orgs">,
  sessionToken: string,
  requestId: string,
): Promise<Id<"invoiceFiles">> {
  const response = await fetch(endpoint({ orgId }), {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": file.type,
      "X-File-Name": encodeURIComponent(file.name),
      "X-Request-Id": requestId,
    },
    body: file,
    signal: AbortSignal.timeout(90_000),
  }).catch(() => {
    throw new Error(
      "The document upload was interrupted. Retry with this source document; your bill has not been added.",
    );
  });
  if (!response.ok)
    throw new Error(
      "The source document could not be saved. Your bill has not been added. Check your connection and retry.",
    );
  const receipt: { fileId?: Id<"invoiceFiles"> } = await response.json();
  if (!receipt.fileId)
    throw new Error(
      "The upload receipt was incomplete. Retry with the same source document.",
    );
  return receipt.fileId;
}
export async function downloadInvoiceFile(
  fileId: Id<"invoiceFiles">,
  name: string,
  sessionToken: string,
) {
  const response = await fetch(endpoint({ fileId }), {
    headers: { Authorization: `Bearer ${sessionToken}` },
    credentials: "omit",
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  }).catch(() => {
    throw new Error(
      "The document download was interrupted. Check your connection and retry.",
    );
  });
  if (!response.ok)
    throw new Error(
      "The source document could not be downloaded. Sign in again or retry.",
    );
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
