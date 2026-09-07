import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ActivityProvider } from "@/features/workspace/ActivityEnvironment";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { billingAccess } from "../../../shared/billing";
import { useQuery } from "convex/react";
import { useAccount, useDisconnect } from "wagmi";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { clearSessionToken, useSessionToken } from "@/lib/session";
import { WorkspaceShell } from "./WorkspaceShell";

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { orgId } = useParams();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const sessionToken = useSessionToken();
  const args =
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip";
  const org = useQuery(api.orgs.get, args);
  const members = useQuery(api.orgs.listMembers, args);
  const billing = useQuery(api.billing.get, args);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const access = billingAccess(billing, now);
  const nextAccess = billing && access.expiresAt !== null ? billingAccess(billing, access.expiresAt) : null;
  const member = members?.find(
    (m) => m?.walletAddress.toLowerCase() === address?.toLowerCase(),
  );
  return (
    <ActivityProvider key={orgId} orgId={orgId ?? ""}>
      <WorkspaceShell
        orgId={orgId ?? ""}
        orgName={org?.name ?? "Your workspace"}
        userName={member?.name || "My account"}
        role={member?.role}
        onSignOut={() => {
          clearSessionToken();
          disconnect();
        }}
      >
        {billing && access.expiresAt !== null &&
          (access.daysRemaining <= 7 ||
            access.source === "trial") && (
            <div
              className={`workspace-panel mb-5 p-4 ${access.isActive && access.daysRemaining > 7 ? "flex flex-wrap items-center justify-between gap-3 text-xs" : ""}`}
              role="status"
            >
              <strong>
                {`${access.source === "trial" ? "Trial" : access.source === "complimentary" ? "Complimentary access" : "Subscription"} · ${access.daysRemaining} days remaining`}
              </strong>
              {access.daysRemaining <= 7 && (
                <p className="workspace-description mt-1">
                  {`${nextAccess?.effectiveTier.name ?? "Free"} access continues after this period. Your team pays its own network and provider fees.`}
                </p>
              )}
              <Link
                className={
                  access.isActive && access.daysRemaining > 7
                    ? "workspace-action-link"
                    : "workspace-button mt-3"
                }
                to={`/org/${orgId}/settings?tab=billing`}
              >
                View plan & billing
              </Link>
            </div>
          )}
        <ErrorBoundary key={location.pathname} withinWorkspace>
          {children}
        </ErrorBoundary>
      </WorkspaceShell>
    </ActivityProvider>
  );
}
