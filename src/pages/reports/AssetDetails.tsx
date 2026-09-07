export function AssetDetails({
  tokenAddress,
  accountAddress,
}: {
  tokenAddress?: string;
  accountAddress: string;
}) {
  return (
    <details className="mt-2 max-w-sm whitespace-normal text-xs font-normal">
      <summary className="cursor-pointer">Asset details</summary>
      <dl className="mt-2 space-y-1">
        <dt>Token contract</dt>
        <dd className="break-all font-mono">
          {tokenAddress ?? "Not recorded"}
        </dd>
        <dt>Funding account</dt>
        <dd className="break-all font-mono">
          {accountAddress || "Not recorded"}
        </dd>
      </dl>
    </details>
  );
}
