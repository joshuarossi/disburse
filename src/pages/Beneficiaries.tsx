import { userErrorMessage } from "@/lib/userErrors";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArrowUpRight,
  Download,
  Plus,
  Upload,
  Users,
  RotateCcw,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { exportToCsv, generateFilename } from "@/lib/csv";
import { RecipientEditor } from "@/components/beneficiaries/RecipientEditor";
import { PayoutReview } from "@/components/beneficiaries/PayoutReview";
import { recipientPayoutIssue } from "../../shared/recipientAssurance";
import { BulkImportModal } from "@/components/beneficiaries/BulkImportModal";
import { PaymentBatchForm } from "@/components/payments/PaymentBatchForm";
import { Dialog } from "@/components/ui/Dialog";
import {
  EmptyState,
  LoadingRows,
  Notice,
  PageHeader,
  SearchField,
} from "@/components/workspace/WorkspacePrimitives";
type Recipient = Doc<"beneficiaries"> & { tags: string[] };
export default function Beneficiaries() {
  const { orgId } = useParams();
  const sessionToken = useSessionToken();
  const args =
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip";
  const [params, setParams] = useSearchParams();
  const recipients = useQuery(
    api.beneficiaries.list,
    args === "skip" ? args : { ...args, includeTags: true },
  );
  const members = useQuery(api.orgs.listMembers, args);
  const session = useQuery(
    api.auth.validateSession,
    sessionToken ? { token: sessionToken } : "skip",
  );
  const role = members?.find(
    (m) => m?.userId === session?.userId && m?.status === "active",
  )?.role;
  const canEdit = !!role && ["admin", "initiator", "clerk"].includes(role);
  const canPay = !!role && ["admin", "approver", "initiator"].includes(role);
  const update = useMutation(api.beneficiaries.update);
  const [search, setSearch] = useState("");
  const requestedView = params.get("view") ?? "all";
  const tab = [
    "all",
    "individual",
    "business",
    "incomplete",
    "requested",
    "review",
    "archived",
  ].includes(requestedView)
    ? requestedView
    : "all";
  const setTab = (value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === "all") next.delete("view");
      else next.set("view", value);
      return next;
    });
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<Recipient | "new" | null>(null);
  const [reviewing, setReviewing] = useState<Id<"beneficiaries"> | null>(null);
  const [archive, setArchive] = useState<Recipient | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = recipients?.filter(
    (r) =>
      (tab === "archived"
        ? !r.isActive
        : r.isActive &&
          (tab === "all" ||
            tab === r.type ||
            (tab === "requested" && !!r.detailRequestId) ||
            (tab === "incomplete" &&
              !r.walletAddress &&
              !r.pendingPayoutChangeId) ||
            (tab === "review" &&
              (!!r.pendingPayoutChangeId ||
                (!!r.walletAddress &&
                  r.payoutReviewStatus !== "approved"))))) &&
      (!group || r.tags.includes(group)) &&
      `${r.name} ${r.email ?? ""} ${r.tags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visible = filtered?.slice(page * 25, (page + 1) * 25);
  const groups = [...new Set(recipients?.flatMap((r) => r.tags) ?? [])].sort();
  const toggle = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id],
    );
  const readySelected =
    recipients?.filter(
      (r) => selected.includes(r._id) && !recipientPayoutIssue(r),
    ) ?? [];
  const archiveRecipient = async () => {
    if (!archive || !sessionToken || busy) return;
    setBusy(true);
    setError("");
    try {
      await update({
        beneficiaryId: archive._id,
        sessionToken,
        isActive: !archive.isActive,
      });
      setArchive(null);
      setSelected((ids) => ids.filter((id) => id !== archive._id));
    } catch (e) {
      setError(userErrorMessage(e, "Could not update recipient"));
    } finally {
      setBusy(false);
    }
  };
  const exportRows = () =>
    exportToCsv(
      generateFilename("recipients"),
      (filtered ?? []).map((r) => ({
        name: r.name,
        email: r.email,
        type: r.type,
        wallet_address: r.walletAddress,
        preferred_token: r.preferredToken,
        preferred_network: r.preferredChainId,
        source_system: r.sourceSystem,
        source_id: r.sourceId,
        notes: r.notes,
        groups: r.tags.join(", "),
        status: recipientPayoutIssue(r) ?? "Payout details approved",
      })),
      [
        "name",
        "email",
        "type",
        "wallet_address",
        "preferred_token",
        "preferred_network",
        "source_system",
        "source_id",
        "notes",
        "groups",
        "status",
      ].map((key) => ({ key, label: key })),
    );
  return (
    <>
      <PageHeader
        title="Recipients"
        description="Your people and vendors, ready for the next payment."
        actions={
          <>
            <button
              className="workspace-button"
              disabled={!filtered?.length}
              onClick={exportRows}
            >
              <Download size={14} />
              Export
            </button>
            {canEdit && (
              <>
                <button
                  className="workspace-button"
                  onClick={() => setParams({ import: "1" })}
                >
                  <Upload size={14} />
                  Import recipients
                </button>
                <button
                  className="workspace-button workspace-button-primary"
                  onClick={() => setEditor("new")}
                >
                  <Plus size={14} />
                  Add recipient
                </button>
              </>
            )}
          </>
        }
      />
      {error && <Notice>{error}</Notice>}
      {reviewing && (
        <PayoutReview
          beneficiaryId={reviewing}
          onClose={() => setReviewing(null)}
        />
      )}
      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div
            className="workspace-tabs"
            role="tablist"
            aria-label="Recipient views"
          >
            {[
              ["all", "All recipients"],
              ["individual", "People"],
              ["business", "Businesses"],
              ["incomplete", "Details needed"],
              ["requested", "Details requested"],
              ["review", "Needs review"],
              ["archived", "Archived"],
            ].map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => {
                  setTab(value);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="workspace-toolbar">
          <SearchField
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(0);
            }}
            placeholder="Search name, email, or group"
          />
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="finance-field !w-auto"
              aria-label="Filter by group"
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            {selected.length > 0 && (
              <>
                <span className="text-xs text-slate-400">
                  {selected.length} selected
                </span>
                <button
                  className="workspace-button"
                  onClick={() => setSelected([])}
                >
                  Clear
                </button>
                {canPay && (
                  <button
                    className="workspace-button workspace-button-primary"
                    disabled={readySelected.length !== selected.length}
                    onClick={() => setPaying(true)}
                  >
                    Pay selected
                    <ArrowUpRight size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {visible === undefined ? (
          <LoadingRows />
        ) : !visible.length ? (
          <EmptyState
            icon={Users}
            title={
              search || tab !== "all" || group
                ? "No recipients match this view"
                : "Bring your team into Disburse"
            }
            description={
              search || tab !== "all" || group
                ? "Try another search or filter."
                : "Upload an employee or vendor directory, then add payout details before your first payment."
            }
            action={
              canEdit && !search ? (
                <button
                  className="workspace-button workspace-button-primary"
                  onClick={() => setParams({ import: "1" })}
                >
                  <Upload size={14} />
                  Import a directory
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="workspace-table-wrap">
            <table
              className="workspace-table workspace-table-responsive"
              role="table"
            >
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">
                    <span className="md:sr-only">Select all recipients</span>
                    <input
                      type="checkbox"
                      aria-label="Select all visible recipients"
                      checked={
                        visible.length > 0 &&
                        visible.every((r) => selected.includes(r._id))
                      }
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [
                                ...new Set([
                                  ...ids,
                                  ...visible.map((r) => r._id),
                                ]),
                              ]
                            : ids.filter(
                                (id) => !visible.some((r) => r._id === id),
                              ),
                        )
                      }
                    />
                  </th>
                  <th role="columnheader" scope="col">
                    Recipient
                  </th>
                  <th role="columnheader" scope="col">
                    Type
                  </th>
                  <th role="columnheader" scope="col">
                    Groups
                  </th>
                  <th role="columnheader" scope="col">
                    Payment details
                  </th>
                  <th role="columnheader" scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {visible.map((r) => (
                  <tr role="row" key={r._id}>
                    <td role="cell" data-selection>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.name}`}
                        checked={selected.includes(r._id)}
                        onChange={() => toggle(r._id)}
                      />
                    </td>
                    <td role="cell" data-primary>
                      <div className="workspace-person">
                        <span className="workspace-avatar">
                          {r.name
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <span>
                          <button
                            className="workspace-table-primary text-left"
                            onClick={() => setEditor(r)}
                          >
                            {r.name}
                          </button>
                          <span className="workspace-table-secondary">
                            {r.email || "No email added"}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td role="cell" data-label="Type">
                      {r.type === "business" ? "Business" : "Person"}
                    </td>
                    <td role="cell" data-label="Groups">
                      <div className="flex flex-wrap gap-1">
                        {r.tags.length ? (
                          r.tags.map((tag: string) => (
                            <span className="workspace-status" key={tag}>
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400">No group</span>
                        )}
                      </div>
                    </td>
                    <td role="cell" data-label="Payment details">
                      <span className="workspace-status">
                        {r.detailRequestId
                          ? (r.detailRequestExpiresAt ?? 0) > Date.now()
                            ? "Details requested"
                            : "Request expired"
                          : (recipientPayoutIssue(r) ??
                            "Payout details approved")}
                      </span>
                    </td>
                    <td role="cell" data-actions>
                      <div className="flex items-center justify-end gap-3">
                        {r.isActive &&
                          (r.walletAddress || r.pendingPayoutChangeId) && (
                            <button
                              className="workspace-action-link"
                              onClick={() => setReviewing(r._id)}
                            >
                              {recipientPayoutIssue(r)
                                ? "Review payout"
                                : "Review history"}
                            </button>
                          )}
                        <button
                          className="workspace-action-link"
                          onClick={() => setEditor(r)}
                        >
                          {canEdit
                            ? r.walletAddress
                              ? "Edit"
                              : "Add details"
                            : "View"}
                        </button>
                        {canEdit && (
                          <button
                            title={
                              r.isActive
                                ? "Archive recipient"
                                : "Restore recipient"
                            }
                            aria-label={`${r.isActive ? "Archive" : "Restore"} ${r.name}`}
                            className="text-slate-400"
                            onClick={() => setArchive(r)}
                          >
                            {r.isActive ? (
                              <Archive size={15} />
                            ) : (
                              <RotateCcw size={15} />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="workspace-table-footer">
          <span>
            {filtered?.length ?? 0} recipients
            {selected.length > readySelected.length
              ? " · Some selected recipients are not ready for payment"
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="workspace-button"
              disabled={!page}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              className="workspace-button"
              disabled={(page + 1) * 25 >= (filtered?.length ?? 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {editor && (
        <RecipientEditor
          orgId={orgId as Id<"orgs">}
          recipient={editor === "new" ? undefined : editor}
          readOnly={!canEdit}
          onClose={() => setEditor(null)}
        />
      )}
      {params.get("import") === "1" && canEdit && (
        <BulkImportModal
          orgId={orgId as Id<"orgs">}
          onClose={() => setParams({})}
          onSuccess={() => setParams({})}
        />
      )}
      {paying && (
        <PaymentBatchForm
          orgId={orgId as Id<"orgs">}
          initialRecipientIds={readySelected.map((r) => r._id)}
          initialPurpose="other"
          onClose={() => setPaying(false)}
        />
      )}
      {archive && (
        <Dialog
          title={archive.isActive ? "Archive recipient?" : "Restore recipient?"}
          onClose={() => {
            if (!busy) setArchive(null);
          }}
        >
          <div className="space-y-5 p-6">
            <p className="workspace-description">
              {archive.isActive
                ? `${archive.name} will be hidden from new payments. Existing payments and their saved details remain in your records.`
                : `${archive.name} will appear in your active recipient list again.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="workspace-button"
                onClick={() => setArchive(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="workspace-button workspace-button-primary"
                onClick={() => void archiveRecipient()}
                disabled={busy}
              >
                {busy
                  ? "Saving…"
                  : archive.isActive
                    ? "Archive recipient"
                    : "Restore recipient"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
