import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import type { Doc } from "../../../convex/_generated/dataModel";
import { supportsCircleFees } from "../../../shared/circleExecution";
import { CustomerPaidExecution } from "@/features/payments/CustomerPaidExecution";
import { Notice } from "@/components/workspace/WorkspacePrimitives";

export function InvoiceCollection({
  invoice,
  canManage,
  busy,
  onBusyChange,
}: {
  invoice: Doc<"receivables">;
  canManage: boolean;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  useWorkspaceLanguage();
  if (!invoice.receivingAddress) return null;
  const awaiting = BigInt(invoice.received) > BigInt(invoice.forwarded);
  if (!supportsCircleFees(invoice.chainId))
    return awaiting ? (
      <Notice>
        {tx(
          "Collection with fees in USDC is not available on this network yet. Your invoice funds remain at the receiving address.",
        )}
      </Notice>
    ) : null;
  return (
    <section aria-label={tx("Invoice collection")} className="space-y-3">
      <p className="workspace-description">
        {tx(
          "The first collection also activates this invoice's receiving address. Your company account needs USDC to pay the quoted fee. Its current owners approve collection.",
        )}
      </p>
      {invoice.sweepError && <Notice>{invoice.sweepError}</Notice>}
      {invoice.sweepState && (
        <Notice tone="info">
          {tx(
            "An earlier collection service request is unresolved. Check that request before approving another collection.",
          )}
        </Notice>
      )}
      <CustomerPaidExecution
        source={{ receivableId: invoice._id }}
        ready={awaiting && !invoice.sweepState}
        blocked={!canManage || busy || !!invoice.sweepState}
        memberName={(wallet) => wallet}
        onBusyChange={onBusyChange}
        compact
      />
    </section>
  );
}
