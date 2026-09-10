import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import type { useReceivingService } from "./useReceivingService";
import type { Id } from "../../../convex/_generated/dataModel";
import { CustomerPaidExecution } from "@/features/payments/CustomerPaidExecution";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { userErrorMessage } from "@/lib/userErrors";

export function ReceivingSetup({
  safeId,
  state,
  canManage,
  busy,
  onBusyChange,
}: {
  safeId: Id<"safes">;
  state: ReturnType<typeof useReceivingService>;
  canManage: boolean;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  useWorkspaceLanguage();
  if (state.isError)
    return (
      <Notice>
        {userErrorMessage(state.error, "Receiving setup could not be checked.")}{" "}
        <button
          className="workspace-action-link"
          onClick={() => void state.refetch()}
        >
          {tx("Check again")}
        </button>
      </Notice>
    );
  if (state.isPending)
    return (
      <p role="status" className="workspace-description">
        {tx("Checking invoice receiving…")}
      </p>
    );
  if (!state.data?.supported || state.data.ready) return null;
  return (
    <section className="space-y-3">
      <Notice tone="info">
        {tx(
          "Receiving needs a one-time setup on this network. Your company account pays the quoted setup fee in USDC. Payment links can be generated once setup is confirmed.",
        )}
      </Notice>
      <CustomerPaidExecution
        source={{ receivingSetupSafeId: safeId }}
        ready
        blocked={busy || !canManage}
        memberName={(wallet) => wallet}
        onBusyChange={onBusyChange}
        compact
      />
    </section>
  );
}
