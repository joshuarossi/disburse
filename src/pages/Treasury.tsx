import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { chainEnvironment } from "../../shared/assets";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { AccountFundingCheck } from "@/features/payments/AccountFundingCheck";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import {
  EmptyState,
  LoadingRows,
  Notice,
  PageHeader,
} from "@/components/workspace/WorkspacePrimitives";
import { Dialog } from "@/components/ui/Dialog";
import { getChainName, getSafeAppUrl, getTokensForChain } from "@/lib/chains";
import { AccountTransfers } from "@/features/treasury/AccountTransfers";

export default function Treasury() {
  const { environment } = useActivityEnvironment();
  const { orgId } = useParams();
  const sessionToken = useSessionToken();
  const allSafes = useQuery(
    api.safes.getForOrg,
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip",
  );
  const safes = allSafes?.filter(
    (safe) => chainEnvironment(safe.chainId) === environment,
  );
  const queryClient = useQueryClient();
  const refreshing = useIsFetching({ queryKey: ["account-readiness"] }) > 0;
  const [funding, setFunding] = useState<Doc<"safes"> | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const copy = async () => {
    if (!funding) return;
    try {
      await navigator.clipboard.writeText(funding.safeAddress);
      setCopied(true);
    } catch {
      setError(
        "Could not copy the address. Select and copy it from the field below.",
      );
    }
  };
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Manage the accounts that fund your team's payments."
        actions={
          <>
            <button
              className="workspace-button"
              disabled={refreshing}
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: ["account-readiness"],
                })
              }
            >
              <RefreshCw
                size={14}
                className={refreshing ? "animate-spin" : ""}
              />
              Refresh balances
            </button>
            <Link
              className="workspace-button workspace-button-primary"
              to={`/org/${orgId}/settings?tab=safe`}
            >
              <Wallet size={14} />
              Manage accounts
            </Link>
          </>
        }
      />
      {safes === undefined ? (
        <LoadingRows />
      ) : safes.length === 0 ? (
        <section className="workspace-panel">
          <EmptyState
            icon={Wallet}
            title="Connect your first funding account"
            description="Link an existing Safe or create one in Settings. Your team keeps control of its funds and signing permissions."
            action={
              <Link
                className="workspace-button workspace-button-primary"
                to={`/org/${orgId}/settings?tab=safe`}
              >
                Set up an account
                <ArrowUpRight size={14} />
              </Link>
            }
          />
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {safes.map((safe) => (
            <AccountFundingCheck
              key={safe._id}
              safeId={safe._id}
              chainId={safe.chainId}
              payments={[]}
              className="workspace-panel p-6"
            >
              <div className="mt-5 flex gap-2">
                <button
                  className="workspace-button"
                  onClick={() => {
                    setFunding(safe);
                    setCopied(false);
                    setError("");
                  }}
                >
                  <ArrowDownLeft size={14} />
                  Add funds
                </button>
                <Link
                  className="workspace-button"
                  to={`/org/${orgId}/disbursements?new=1&chain=${safe.chainId}&account=${safe._id}`}
                >
                  <ArrowUpRight size={14} />
                  Make a payment
                </Link>
              </div>
              <details className="mt-5 text-xs text-slate-400">
                <summary className="cursor-pointer">Account details</summary>
                <p className="mt-3 break-all font-mono">{safe.safeAddress}</p>
                <a
                  href={getSafeAppUrl(safe.chainId, safe.safeAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="workspace-action-link mt-2"
                  aria-label={`Open ${safe.name ?? getChainName(safe.chainId)} account in Safe`}
                >
                  Open in Safe <ExternalLink size={13} />
                </a>
              </details>
            </AccountFundingCheck>
          ))}
        </div>
      )}
      {orgId && allSafes && <AccountTransfers orgId={orgId as Id<"orgs">} accounts={allSafes} />}
      <section className="workspace-panel mt-6">
        <div className="workspace-panel-heading">
          <div>
            <h2>Account controls</h2>
            <p>Assign responsibility and review how your team can spend.</p>
          </div>
        </div>
        <div className="grid gap-6 p-6 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">
              Team approvals and spending limits
            </h3>
            <p className="workspace-description">
              Manage application budgets and contract-enforced delegation
              separately. Review owner authority before assigning a delegate.
            </p>
            <Link
              className="workspace-action-link mt-4"
              to={`/org/${orgId}/team`}
            >
              Manage team controls
              <ArrowRightIcon />
            </Link>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Payment fees</h3>
            <p className="workspace-description">
              Choose the fee currency and execution settings for your funding
              accounts. Availability depends on your network and payment
              provider.
            </p>
            <Link
              className="workspace-action-link mt-4"
              to={`/org/${orgId}/settings?tab=fees`}
            >
              Review payment settings
              <ArrowRightIcon />
            </Link>
          </div>
        </div>
      </section>
      {funding && (
        <Dialog title="Add funds" onClose={() => setFunding(null)}>
          <div className="space-y-5 p-6">
            <p className="workspace-description">
              Send a supported currency to{" "}
              {funding.name ?? `${getChainName(funding.chainId)} account`}. Use
              this network when withdrawing from your provider.
            </p>
            <div className="flex flex-col items-center gap-5 rounded-lg border border-white/10 p-5">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={funding.safeAddress} size={150} />
              </div>
              <span className="workspace-status">
                {getChainName(funding.chainId)}
              </span>
            </div>
            <label className="block">
              <span className="finance-label">Account address</span>
              <input
                className="finance-field font-mono"
                readOnly
                value={funding.safeAddress}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <p className="text-xs text-slate-400">
              Supported currencies:{" "}
              {Object.keys(getTokensForChain(funding.chainId)).join(", ")}
            </p>
            {error && <Notice>{error}</Notice>}
            <button
              className="workspace-button workspace-button-primary w-full"
              onClick={() => void copy()}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Address copied" : "Copy funding address"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function ArrowRightIcon() {
  return <ArrowUpRight size={13} />;
}
