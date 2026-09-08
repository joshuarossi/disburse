export function Counterparty({ name, address }: { name: string; address?: string }) {
  const label = /^0x[0-9a-f]{40}$/i.test(name) ? "External account" : name || "Unknown counterparty";
  const wallet = address || (/^0x[0-9a-f]{40}$/i.test(name) ? name : undefined);
  return (
    <div className="min-w-0">
      <p className="font-medium text-[var(--ws-text)]">{label}</p>
      {wallet && (
        <details className="mt-1 text-xs text-[var(--ws-muted)]">
          <summary className="cursor-pointer">Wallet address</summary>
          <p className="mt-1 max-w-xs break-all font-mono">{wallet}</p>
        </details>
      )}
    </div>
  );
}
