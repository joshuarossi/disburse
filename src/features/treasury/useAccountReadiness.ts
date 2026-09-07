import { useAction } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AccountReadiness } from "../../../shared/accountReadiness";
import { useSessionToken } from "@/lib/session";

export function accountReadinessQuery(
  safeId: Id<"safes">,
  sessionToken: string | null | undefined,
  fetch: (args: {
    safeId: Id<"safes">;
    sessionToken: string;
  }) => Promise<AccountReadiness>,
) {
  return {
    queryKey: ["account-readiness", safeId, sessionToken],
    queryFn: () => fetch({ safeId, sessionToken: sessionToken! }),
    enabled: !!sessionToken,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
  };
}

export function useAccountReadiness(safeId: Id<"safes">) {
  const fetch = useAction(api.accountReadiness.get);
  const sessionToken = useSessionToken();
  return useQuery(accountReadinessQuery(safeId, sessionToken, fetch));
}
