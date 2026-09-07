import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { formatDate } from "@/lib/formatMoney";

export function ScreeningSource({ isAdmin }: { isAdmin: boolean }) {
  const { orgId } = useParams();
  const sessionToken = useSessionToken();
  const args =
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip";
  const source = useQuery(api.ofacData.status, args),
    org = useQuery(api.orgs.get, args);
  const refresh = useAction(api.ofac.refreshForOrg),
    screen = useAction(api.screening.screenAllBeneficiaries),
    update = useMutation(api.screeningMutations.updateScreeningEnforcement);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const run = async (name: string, operation: () => Promise<string>) => {
    if (busy || args === "skip") return;
    setBusy(name);
    setError("");
    setMessage("");
    try {
      setMessage(await operation());
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This screening update did not complete.",
      );
    } finally {
      setBusy("");
    }
  };
  return (
    <section
      className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6 space-y-4"
      aria-label="Screening data and freshness"
    >
      <h2 className="text-lg font-semibold">Screening data and freshness</h2>
      {error && <Notice>{error}</Notice>}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {source === undefined ? (
        <p role="status">Checking the OFAC source…</p>
      ) : (
        <>
          {source.dataset ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="finance-label">Active publication</dt>
                <dd>
                  {formatDate(source.dataset.publishedAt)} ·{" "}
                  {source.dataset.entryCount.toLocaleString()} records
                </dd>
              </div>
              <div>
                <dt className="finance-label">Source last checked</dt>
                <dd>
                  {source.lastCheckedAt
                    ? new Date(source.lastCheckedAt).toLocaleString()
                    : "Not checked"}
                </dd>
              </div>
              <div>
                <dt className="finance-label">Name coverage</dt>
                <dd>
                  {source.dataset.aliasCount.toLocaleString()} aliases,
                  including weak aliases
                </dd>
              </div>
              <div>
                <dt className="finance-label">Address coverage</dt>
                <dd>
                  {source.dataset.addressCount.toLocaleString()} published
                  currency identifiers
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm workspace-funding-warning">
              The versioned OFAC list has not been loaded. Screening cannot
              report a completed no-match result yet.
            </p>
          )}
          {source.lastError && (
            <p className="text-sm workspace-funding-warning">
              Last refresh: {source.lastError}
            </p>
          )}
          {source.refreshing && source.refreshProgress && (
            <div className="space-y-1 text-sm" role="status">
              <p>
                Updating screening data ·{" "}
                {Math.floor(
                  (100 * source.refreshProgress.completed) /
                    source.refreshProgress.total,
                )}
                % complete
              </p>
              <progress
                className="w-full"
                aria-label="Screening data update"
                value={source.refreshProgress.completed}
                max={source.refreshProgress.total}
              />
            </div>
          )}
          <p className="text-sm text-slate-400">
            The source is checked every six hours. A refresh keeps the previous
            complete list available until the replacement is ready. Published
            identifiers are not a complete address-risk database.
          </p>
          <a
            className="workspace-action-link"
            href={source.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            OFAC SDN source
          </a>
          {isAdmin && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="workspace-button"
                disabled={!!busy || source.refreshing}
                onClick={() =>
                  void run("refresh", async () => {
                    const result = await refresh(
                      args as Exclude<typeof args, "skip">,
                    );
                    return result.status === "in_progress"
                      ? "An OFAC refresh is already running."
                      : result.status === "recently_checked"
                        ? "The OFAC source was checked in the last 15 minutes."
                        : "OFAC source checked. Recipient checks continue in the background.";
                  })
                }
              >
                {busy === "refresh" || source.refreshing
                  ? "Refreshing OFAC list…"
                  : "Refresh OFAC list"}
              </button>
              <button
                type="button"
                className="workspace-button"
                disabled={!!busy || !source.dataset}
                onClick={() =>
                  void run("screen", async () => {
                    await screen(args as Exclude<typeof args, "skip">);
                    return "Recipient screening queued. Checks continue while you work.";
                  })
                }
              >
                {busy === "screen"
                  ? "Queuing checks…"
                  : "Screen all recipients"}
              </button>
            </div>
          )}
        </>
      )}
      <div className="border-t border-white/10 pt-4 space-y-2">
        <label className="block">
          <span className="finance-label">Screening freshness limit</span>
          <select
            className="finance-field sm:max-w-sm"
            value={org?.screeningMaxAgeHours ?? 24}
            disabled={!org || !isAdmin || !!busy}
            onChange={(e) =>
              void run("policy", async () => {
                await update({
                  ...(args as Exclude<typeof args, "skip">),
                  enforcement: org?.screeningEnforcement ?? "off",
                  maximumAgeHours: Number(e.target.value),
                });
                return "Screening freshness limit saved.";
              })
            }
          >
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
            <option value={168}>7 days</option>
          </select>
        </label>
        <p className="text-sm text-slate-400">
          Applies to both the source check and each recipient result. Warn and
          Block also cover missing checks, changed details, expired decisions
          and checks that could not complete.
        </p>
      </div>
    </section>
  );
}
