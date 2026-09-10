import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
export function AssetDetails({
  tokenAddress,
  accountAddress,
}: {
  tokenAddress?: string;
  accountAddress: string;
}) {
  useWorkspaceLanguage();
  return (
    <details className="mt-2 max-w-sm whitespace-normal text-xs font-normal">
      <summary className="cursor-pointer">{tx("Asset details")}</summary>
      <dl className="mt-2 space-y-1">
        <dt>{tx("Token contract")}</dt>
        <dd className="break-all font-mono">
          {tokenAddress ?? tx("Not recorded")}
        </dd>
        <dt>{tx("Funding account")}</dt>
        <dd className="break-all font-mono">
          {accountAddress || tx("Not recorded")}
        </dd>
      </dl>
    </details>
  );
}
