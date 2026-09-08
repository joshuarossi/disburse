import { useAction } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";

export function useReceivingService(safeId: Id<"safes">, enabled: boolean) {
  const sessionToken = useSessionToken(),
    status = useAction(api.receivableServices.status);
  return useQuery({
    queryKey: ["receiving-service", safeId, sessionToken],
    queryFn: () => status({ safeId, sessionToken: sessionToken! }),
    enabled: enabled && !!sessionToken,
    retry: 1,
    refetchInterval: (q) =>
      q.state.data?.supported && !q.state.data.ready ? 10_000 : false,
  });
}
