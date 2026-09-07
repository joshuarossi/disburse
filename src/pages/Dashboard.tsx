import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { chainEnvironment } from "../../shared/assets";
import { useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { OverviewScreen } from "@/components/workspace/OverviewScreen";
import {
  LoadingRows,
  PageHeader,
} from "@/components/workspace/WorkspacePrimitives";
import { useFundingBalances } from "@/features/treasury/useFundingBalances";
import { getChainName } from "@/lib/chains";
import { amountToBaseUnits, formatBaseUnits } from "../../shared/validation";

export default function Dashboard() {
  const { environment } = useActivityEnvironment();
  const { orgId } = useParams();
  const sessionToken = useSessionToken();
  const args =
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip";
  const overview = useQuery(
    api.workspace.overview,
    args === "skip" ? args : { ...args, environment },
  );
  const org = useQuery(api.orgs.get, args);
  const safes = useQuery(api.safes.getForOrg, args);
  const { balances } = useFundingBalances(
    safes?.filter((safe) => chainEnvironment(safe.chainId) === environment),
  );
  if (!overview)
    return (
      <>
        <PageHeader title="Overview" description="Loading your workspace…" />
        <LoadingRows />
      </>
    );
  return (
    <OverviewScreen
      model={overview}
      prefix={`/org/${orgId}`}
      orgName={org?.name ?? "your team"}
      balances={balances.map((b) => {
        const planned =
          overview.plannedDebits.find(
            (d) => d.safeId === b.safeId && d.token === b.token.symbol,
          )?.amount ?? "0";
        let remaining: string | null = null;
        if (b.amount !== null && !overview.plansIncomplete) {
          const units =
            (b.amount === "0"
              ? 0n
              : amountToBaseUnits(b.amount, b.token.symbol)) -
            (planned === "0" ? 0n : amountToBaseUnits(planned, b.token.symbol));
          remaining = formatBaseUnits(units < 0n ? 0n : units, b.token.symbol);
        }
        return {
          label: b.name ?? getChainName(b.chainId),
          token: b.token.symbol,
          amount: b.amount,
          planned,
          remaining,
          ready: b.ready,
          checkedAt: b.checkedAt,
          loading: b.loading,
        };
      })}
    />
  );
}
