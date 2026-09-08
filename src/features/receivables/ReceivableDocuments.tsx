import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import {
  downloadInvoiceFile,
  uploadInvoiceFile,
} from "@/lib/invoiceFileClient";
import { userErrorMessage } from "@/lib/userErrors";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { MAX_INVOICE_FILE_BYTES } from "../../../shared/invoiceSource";

export function ReceivableDocuments({
  invoice,
  canManage,
}: {
  invoice: Doc<"receivables">;
  canManage: boolean;
}) {
  const sessionToken = useSessionToken();
  const files = useQuery(
    api.invoiceFiles.forReceivable,
    sessionToken ? { invoiceId: invoice._id, sessionToken } : "skip",
  );
  const attach = useMutation(api.invoiceFiles.attachToReceivable),
    share = useMutation(api.invoiceFiles.shareReceivableFile);
  const [selection, setSelection] = useState<{
    file: File;
    requestId: string;
    uploadedId?: Id<"invoiceFiles">;
  }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        userErrorMessage(
          e,
          "The document action could not complete. Keep your selection and retry.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Invoice documents"
      className="space-y-3 rounded-xl border border-slate-400/20 p-4"
    >
      <div>
        <h3 className="font-semibold">Documents</h3>
        <p className="workspace-description">
          Files stay private to your team until you share them on the customer
          invoice.
        </p>
      </div>
      {files === undefined ? (
        <p role="status">Loading documents…</p>
      ) : files.length === 0 ? (
        <p className="workspace-description">
          No supporting documents attached.
        </p>
      ) : (
        <ul className="space-y-3">
          {files.map((file) => (
            <li
              key={file.id}
              className="space-y-1 rounded-lg border border-slate-400/20 p-3"
            >
              <p className="break-all font-medium">{file.name}</p>
              <p className="workspace-description">
                {Math.ceil(file.size / 1024)} KB ·{" "}
                {file.sharedWithCustomer
                  ? invoice.state === "draft"
                    ? "Will be shared when issued"
                    : "Shared on customer invoice"
                  : "Private to your team"}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  className="workspace-action-link"
                  disabled={busy || !sessionToken}
                  onClick={() =>
                    run(() =>
                      downloadInvoiceFile(file.id, file.name, sessionToken!),
                    )
                  }
                >
                  Download {file.name}
                </button>
                {canManage &&
                  (!file.sharedWithCustomer
                    ? invoice.state !== "void"
                    : true) && (
                    <button
                      className="workspace-action-link"
                      disabled={busy || !sessionToken}
                      onClick={() =>
                        run(() =>
                          share({
                            fileId: file.id,
                            sessionToken: sessionToken!,
                            shared: !file.sharedWithCustomer,
                          }),
                        )
                      }
                    >
                      {file.sharedWithCustomer
                        ? `Make ${file.name} private`
                        : `Share ${file.name} with customer`}
                    </button>
                  )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage && invoice.state !== "void" && (files?.length ?? 0) < 5 && (
        <div className="space-y-3">
          <label className="block">
            <span className="finance-label">Attach a supporting document</span>
            <input
              ref={input}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,text/plain"
              className="finance-field !p-2"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!file.size || file.size > MAX_INVOICE_FILE_BYTES) {
                  setError(
                    "Choose a PDF, image or text file between 1 byte and 10 MB.",
                  );
                  e.target.value = "";
                  return;
                }
                setError("");
                setSelection({ file, requestId: crypto.randomUUID() });
              }}
            />
          </label>
          <p className="workspace-description">
            PDF, image or text · up to 10 MB each · five documents per invoice.
          </p>
          {selection && (
            <button
              className="workspace-button"
              disabled={busy || !sessionToken}
              onClick={() =>
                run(async () => {
                  const uploadedId =
                    selection.uploadedId ??
                    (await uploadInvoiceFile(
                      selection.file,
                      invoice.orgId,
                      sessionToken!,
                      selection.requestId,
                    ));
                  setSelection({ ...selection, uploadedId });
                  await attach({
                    invoiceId: invoice._id,
                    fileId: uploadedId,
                    sessionToken: sessionToken!,
                  });
                  setSelection(undefined);
                  if (input.current) input.current.value = "";
                })
              }
            >
              {busy ? "Saving document…" : "Save private document"}
            </button>
          )}
        </div>
      )}
      {error && <Notice>{error}</Notice>}
    </section>
  );
}
