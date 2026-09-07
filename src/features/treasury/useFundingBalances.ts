import { useQueries } from "@tanstack/react-query";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { getTokensForChain } from "@/lib/chains";
import { useSessionToken } from "@/lib/session";
import type { Doc } from "../../../convex/_generated/dataModel";
import { accountReadinessQuery } from "./useAccountReadiness";
import { assessPayments } from "../../../shared/accountReadiness";
import { RELAY_FEATURE_ENABLED } from "@/lib/relayConfig";

export function useFundingBalances(safes: Doc<"safes">[] | undefined) {
  const fetch = useAction(api.accountReadiness.get);
  const sessionToken = useSessionToken();
  const checks = useQueries({
    queries: (safes ?? []).map((safe) =>
      accountReadinessQuery(safe._id, sessionToken, fetch),
    ),
  });
  const balances = (safes ?? []).flatMap((safe, index) => {
    const check = checks[index];
    const account = check.data;
    const issues = account
      ? assessPayments(account, [], RELAY_FEATURE_ENABLED).issues
      : [];
    return Object.values(getTokensForChain(safe.chainId)).map((token) => ({
      safeId: safe._id,
      chainId: safe.chainId,
      name: account?.name ?? safe.name,
      token,
      amount:
        account?.assets.find((a) => a.token === token.symbol)?.balance ?? null,
      checkedAt: account?.checkedAt,
      ready: !!account && !check.isError && issues.length === 0,
      loading: check.isPending,
    }));
  });
  return {
    balances,
    loading: safes === undefined || checks.some((c) => c.isPending),
    refreshing: checks.some((c) => c.isFetching),
    hasErrors: checks.some((c) => c.isError || c.data?.error),
    refetch: () => Promise.all(checks.map((c) => c.refetch())),
  };
}
