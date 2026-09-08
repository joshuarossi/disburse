import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  MAX_INVOICE_FILE_BYTES,
  invoiceFileType,
  invoiceFileName,
} from "../shared/invoiceSource";

// No cookies or credentials are accepted; every operation verifies the supplied
// SIWE bearer session and current organization membership. Public downloads
// require an issued invoice link and that document's explicit sharing flag.
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-File-Name, X-Request-Id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const auth = (r: Request) => {
  const value = r.headers.get("authorization");
  if (!value?.startsWith("Bearer ") || value.length > 2048)
    throw new Error("Sign in to access invoice documents");
  return value.slice(7);
};
async function boundedBody(request: Request) {
  if (
    Number(request.headers.get("content-length") ?? 0) > MAX_INVOICE_FILE_BYTES
  )
    throw new Error("Choose a file no larger than 10 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Choose a source document.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > MAX_INVOICE_FILE_BYTES) {
        await reader.cancel();
        throw new Error("Choose a file no larger than 10 MB.");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
export const options = httpAction(
  async () => new Response(null, { status: 204, headers }),
);
export const upload = httpAction(async (ctx, request) => {
  let stored: Id<"_storage"> | undefined;
  let committed = false;
  try {
    const sessionToken = auth(request),
      orgId = new URL(request.url).searchParams.get("orgId") as Id<"orgs">;
    await ctx.runQuery(internal.invoiceFiles.uploadAccess, {
      orgId,
      sessionToken,
    });
    const name = invoiceFileName(
      decodeURIComponent(request.headers.get("x-file-name") ?? ""),
    );
    const bytes = await boundedBody(request);
    const contentType = invoiceFileType(
      bytes,
      request.headers.get("content-type") ?? "",
    );
    const sha256 = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    stored = await ctx.storage.store(new Blob([bytes], { type: contentType }));
    const receipt = await ctx.runMutation(internal.invoiceFiles.record, {
      orgId,
      sessionToken,
      name,
      size: bytes.length,
      contentType,
      sha256,
      storageId: stored,
      requestId: request.headers.get("x-request-id") ?? "",
    });
    committed = !receipt.reused;
    if (receipt.reused) await ctx.storage.delete(stored);
    return Response.json({ fileId: receipt.fileId, sha256 }, { headers });
  } catch {
    if (stored && !committed) await ctx.storage.delete(stored);
    return Response.json(
      {
        error:
          "The document could not be saved. Check your sign-in, file type and 10 MB limit, then retry. This upload does not create an invoice or bill.",
      },
      { status: 400, headers },
    );
  }
});
export const download = httpAction(async (ctx, request) => {
  try {
    const params = new URL(request.url).searchParams;
    const fileId = params.get("fileId") as Id<"invoiceFiles">;
    const publicToken = params.get("publicToken");
    const file = publicToken
      ? await ctx.runQuery(internal.invoiceFiles.sharedDownloadAccess, {
          fileId,
          publicToken,
        })
      : await ctx.runQuery(internal.invoiceFiles.downloadAccess, {
          fileId,
          sessionToken: auth(request),
        });
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) throw new Error("Source document unavailable");
    return new Response(blob, {
      headers: {
        ...headers,
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch {
    return new Response(
      "Source document unavailable. Sign in again and retry.",
      { status: 403, headers },
    );
  }
});
export const discard = httpAction(async (ctx, request) => {
  try {
    await ctx.runMutation(internal.invoiceFiles.discard, {
      fileId: new URL(request.url).searchParams.get(
        "fileId",
      ) as Id<"invoiceFiles">,
      sessionToken: auth(request),
    });
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response("This source document could not be removed.", {
      status: 403,
      headers,
    });
  }
});
