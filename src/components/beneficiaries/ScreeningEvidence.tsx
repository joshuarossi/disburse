import { tx, useWorkspaceLanguage, workspaceLocale } from "@/lib/workspaceI18n";
import { userErrorMessage } from "@/lib/userErrors";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { getChainName } from "@/lib/chains";
import { formatDate } from "@/lib/formatMoney";

type Result = NonNullable<
  FunctionReturnType<typeof api.screeningQueries.getScreeningResult>
>;
const labels: Record<string, string> = {
  clear: "No listed matches",
  potential_match: "Match needs review",
  confirmed_match: "Confirmed match",
  false_positive: "Reviewed false positive",
  unavailable: "Check unavailable",
  pending: "Check needed",
  stale: "Check out of date",
  changed: "Recipient changed",
  review_expired: "Review expired",
};

function ReviewControls({
  result,
  sessionToken,
}: {
  result: Result;
  sessionToken: string;
}) {
  useWorkspaceLanguage();
  const review = useMutation(api.screeningMutations.reviewScreeningResult);
  const [reason, setReason] = useState(""),
    [days, setDays] = useState(30),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const canDismiss = !result.matches.some(
    (m) => m.kind === "address" && m.networkMatch === "listed_network",
  );
  const decide = async (status: "false_positive" | "confirmed_match") => {
    if (!result._id || !result.evidenceKey || busy || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      await review({
        screeningResultId: result._id,
        sessionToken,
        status,
        reason,
        validDays: days,
        expectedEvidenceKey: result.evidenceKey,
      });
    } catch (e) {
      setError(userErrorMessage(e, "The review could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-4 border-t border-white/10 pt-4"
      aria-label={tx("Review screening evidence")}
    >
      <h3 className="font-semibold">{tx("Record your decision")}</h3>
      {error && <Notice>{tx(error)}</Notice>}
      <label className="block">
        <span className="finance-label">{tx("Review reason")}</span>
        <textarea
          className="finance-field"
          rows={3}
          minLength={10}
          maxLength={2000}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder={tx(
            "Explain the identifying information you checked and your conclusion.",
          )}
        />
      </label>
      <label className="block">
        <span className="finance-label">
          {tx("False-positive clearance period")}
        </span>
        <select
          className="finance-field"
          value={days}
          disabled={busy}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>{tx("7 days")}</option>
          <option value={30}>{tx("30 days")}</option>
        </select>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          disabled={busy}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {tx(
          "I reviewed the current recipient details and listed evidence. Changed details or matches will require another review.",
        )}
      </label>
      {!canDismiss && (
        <p className="text-sm workspace-funding-warning">
          {tx(
            "The exact receiving address is listed for this network. It cannot be dismissed as a name false positive.",
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="workspace-button"
          disabled={
            busy || !confirmed || reason.trim().length < 10 || !canDismiss
          }
          onClick={() => void decide("false_positive")}
        >
          {tx("Mark false positive")}
        </button>
        <button
          type="button"
          className="workspace-button"
          disabled={busy || !confirmed || reason.trim().length < 10}
          onClick={() => void decide("confirmed_match")}
        >
          {busy ? tx("Saving review…") : tx("Confirm match")}
        </button>
      </div>
    </section>
  );
}

export function ScreeningEvidence({
  beneficiaryId,
  beneficiaryName,
}: {
  beneficiaryId: Id<"beneficiaries">;
  beneficiaryName: string;
}) {
  useWorkspaceLanguage();
  const sessionToken = useSessionToken();
  const result = useQuery(
    api.screeningQueries.getScreeningResult,
    sessionToken ? { beneficiaryId, sessionToken } : "skip",
  );
  const rerun = useAction(api.screening.rerunScreening);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const check = async () => {
    if (!sessionToken || busy) return;
    setBusy(true);
    setError("");
    try {
      await rerun({ beneficiaryId, sessionToken });
    } catch (e) {
      setError(userErrorMessage(e, "Screening could not be completed."));
    } finally {
      setBusy(false);
    }
  };
  if (result === undefined)
    return <p role="status">{tx("Loading screening evidence…")}</p>;
  const issue = result?.issue;
  const label =
    labels[issue?.status ?? result?.status ?? "pending"] ?? "Review needed";
  const canReview =
    result?.canReview &&
    result.matches.length > 0 &&
    (!issue ||
      ["potential_match", "confirmed_match", "review_expired"].includes(
        issue.status,
      ));
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold">{beneficiaryName}</h3>
        <p className="mt-2 text-sm text-slate-400">
          {tx(
            "Checks names and published digital-currency identifiers in the OFAC SDN list. This does not verify who controls an address or assess transaction exposure.",
          )}
        </p>
      </div>
      {error && <Notice>{tx(error)}</Notice>}
      <section className="rounded-xl border border-white/10 p-4 space-y-2">
        <strong>{tx(label)}</strong>
        {issue && <p className="text-sm text-slate-400">{tx(issue.reason)}</p>}
        {result?.screenedAt && (
          <p className="text-xs text-slate-400">
            {tx("Last check")}{" "}
            {new Date(result.screenedAt).toLocaleString(workspaceLocale())}
          </p>
        )}
        {result?.status === "confirmed_match" && (
          <p className="text-xs text-slate-400">
            {tx(
              "Confirmed matches remain blocked while the recipient details and match evidence are unchanged.",
            )}
          </p>
        )}
        {result?.status === "false_positive" && result.reviewExpiresAt && (
          <p className="text-xs text-slate-400">
            {tx("Decision valid until")} {formatDate(result.reviewExpiresAt)}
            {tx(", while the reviewed details and evidence remain unchanged.")}
          </p>
        )}
        {result?.canRerun && (
          <button
            type="button"
            className="workspace-button mt-2"
            disabled={busy}
            onClick={() => void check()}
          >
            {busy ? tx("Checking…") : tx("Run screening")}
          </button>
        )}
      </section>
      {result?.input && (
        <details className="text-sm">
          <summary className="cursor-pointer">{tx("Details checked")}</summary>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="text-slate-400">{tx("Recipient name")}</dt>
              <dd>{result.input.name}</dd>
            </div>
            <div>
              <dt className="text-slate-400">{tx("Receiving address")}</dt>
              <dd className="break-all font-mono text-xs">
                {result.input.walletAddress || tx("No address supplied")}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">{tx("Requested payment")}</dt>
              <dd>
                {result.input.preferredToken ??
                  tx("Currency chosen per payment")}{" "}
                ·{" "}
                {result.input.preferredChainId
                  ? getChainName(result.input.preferredChainId)
                  : tx("Network chosen per payment")}
              </dd>
            </div>
          </dl>
        </details>
      )}
      {result?.dataset && (
        <details className="text-sm">
          <summary className="cursor-pointer">
            {tx("OFAC source and version")}
          </summary>
          <div className="mt-3 space-y-2 text-xs text-slate-400">
            <p>
              {tx("Publication")} {formatDate(result.dataset.publishedAt)} ·{" "}
              {result.dataset.entryCount.toLocaleString(workspaceLocale())}{" "}
              {tx("records")}
            </p>
            <a
              className="workspace-action-link"
              href={result.dataset.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {tx("Download the current OFAC source")}
            </a>
            <p>{tx("Saved publication checksum")}</p>
            <p className="break-all font-mono">{result.dataset.checksum}</p>
            <p>
              {tx("Matching method:")} {result.dataset.engine}
              {tx(
                ". Name similarity threshold: 85%; address comparisons are exact. Weak aliases and address-network differences are identified below.",
              )}
            </p>
          </div>
        </details>
      )}
      {!!result?.matches.length && (
        <section className="space-y-3" aria-label={tx("Listed matches")}>
          <h3 className="font-semibold">
            {tx("Listed evidence ·")} {result.matches.length}{" "}
            {result.matches.length === 1 ? tx("match") : tx("matches")}
          </h3>
          {result.matches.map((match, i) => (
            <div
              key={`${match.sdnId}-${i}`}
              className="rounded-lg border border-white/10 p-4 space-y-2 text-sm"
            >
              <strong>{match.matchedName}</strong>
              <p className="text-xs text-slate-400">
                {tx("SDN ID")} {match.sdnId} ·{" "}
                {match.kind === "address"
                  ? tx("Exact listed identifier")
                  : tx("{{value1}}% name similarity{{value2}}", {
                      value1: Math.round(match.matchScore * 100),
                      value2:
                        match.alias === "weak"
                          ? tx(" · Weak alias")
                          : match.alias === "strong"
                            ? tx(" · Alias")
                            : "",
                    })}
              </p>
              {match.programs?.length ? (
                <p className="text-xs text-slate-400">
                  {tx("Programs:")} {match.programs.join(", ")}
                </p>
              ) : null}
              {match.matchedAddress && (
                <>
                  <p className="break-all font-mono text-xs">
                    {match.matchedAddress}
                  </p>
                  <p className="text-xs text-slate-400">
                    {tx("Published label:")} {match.listedCurrency}
                    {match.listedChainId
                      ? ` · ${getChainName(match.listedChainId)}`
                      : ""}
                  </p>
                  {match.networkMatch !== "listed_network" && (
                    <p className="text-sm workspace-funding-warning">
                      {match.networkMatch === "other_network"
                        ? tx(
                            "The identifier is listed for a different network. This is evidence to review, not proof of an address listing on the selected network.",
                          )
                        : tx(
                            "The published currency label does not establish the requested network. Review the identifier and entity together.",
                          )}
                    </p>
                  )}
                </>
              )}
            </div>
          ))}
        </section>
      )}
      {canReview && sessionToken && (
        <ReviewControls
          key={result.evidenceKey}
          result={result}
          sessionToken={sessionToken}
        />
      )}
      {!!result?.decisions.length && (
        <details className="text-sm">
          <summary className="cursor-pointer">{tx("Decision history")}</summary>
          <ul className="mt-3 space-y-4">
            {result.decisions.map((d) => (
              <li key={d._id}>
                <strong>{tx(labels[d.status])}</strong>
                <p className="text-xs text-slate-400">
                  {new Date(d.reviewedAt).toLocaleString(workspaceLocale())}
                  {d.status === "false_positive" && (
                    <>
                      {" "}
                      {tx("· Valid until")} {formatDate(d.expiresAt)}
                    </>
                  )}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{d.reason}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function RecipientScreening(props: {
  beneficiaryId: Id<"beneficiaries">;
  beneficiaryName: string;
}) {
  useWorkspaceLanguage();
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-xl border border-white/10 p-4"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        {tx("OFAC screening")}
      </summary>
      {open && (
        <div className="mt-4">
          <ScreeningEvidence {...props} />
        </div>
      )}
    </details>
  );
}
