import { useAction } from "convex/react";
import { usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { walletDeclined, walletErrorMessage } from "@/lib/walletErrors";

export function InvoiceCollection({
  invoice,
  canManage,
  busy,
  run,
}: {
  invoice: Doc<"receivables">;
  canManage: boolean;
  busy: boolean;
  run: (work: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const sessionToken = useSessionToken();
  const args = sessionToken ? { invoiceId: invoice._id, sessionToken } : null;
  const nativeSweep = useAction(api.receivableActions.nativeSweep);
  const refresh = useAction(api.receivableActions.refresh);
  const { switchChainAsync } = useSwitchChain(),
    { sendTransactionAsync } = useSendTransaction();
  const client = usePublicClient({ chainId: invoice.chainId });
  const awaiting = BigInt(invoice.received) > BigInt(invoice.forwarded);
  if (!awaiting && !invoice.sweepState) return null;
  return (
    <section
      aria-label="Invoice collection"
      className="space-y-3 rounded-lg border border-slate-400/20 p-4"
    >
      <h3 className="font-semibold">Collect into your account</h3>
      <p className="workspace-description">
        You pay the collection network fee with your connected wallet. The full
        invoice payment moves into your company account. Disburse does not cover
        network or provider fees, including on a free plan.
      </p>
      {invoice.sweepError && <Notice>{invoice.sweepError}</Notice>}
      {invoice.sweepState && (
        <Notice tone="info">
          An earlier service request is still unresolved. No new service request
          will be sent. Wallet collection may incur another gas charge if that
          earlier request also executes.
        </Notice>
      )}
      {canManage && awaiting && (
        <button
          className="workspace-button"
          disabled={busy || !args}
          onClick={() =>
            run(async () => {
              const call = await nativeSweep(args!);
              let sendStarted = false;
              let hash: `0x${string}`;
              try {
                await switchChainAsync({ chainId: call.chainId });
                sendStarted = true;
                hash = await sendTransactionAsync(call);
              } catch (error) {
                if (walletDeclined(error)) return { tone: "info", message: "Collection cancelled. Your invoice payment is still available to collect when you are ready." };
                throw new Error(sendStarted
                  ? "Your wallet did not confirm whether collection was submitted. Check your wallet activity and refresh this invoice before trying again."
                  : walletErrorMessage(error, "Could not connect to the collection network. Check your wallet connection and try again."));
              }
              if (!client)
                throw new Error(
                  "Collection submitted. Check your wallet activity and refresh this invoice for confirmation.",
                );
              try {
                const receipt = await client.waitForTransactionReceipt({
                  hash,
                  confirmations: 2,
                });
                if (receipt.status !== "success")
                  throw new Error(
                    "Collection reverted. Check your wallet activity and refresh this invoice before trying again.",
                  );
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.startsWith("Collection reverted.")
                )
                  throw error;
                throw new Error(
                  "Collection confirmation is pending. Check your wallet activity and refresh this invoice before trying again.",
                );
              }
              await refresh(args!);
            }, "Collection transaction confirmed.")
          }
        >
          Collect with wallet
        </button>
      )}
      <p className="workspace-description">
        Review the network fee in your wallet before confirming.
      </p>
    </section>
  );
}
