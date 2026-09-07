import { createPublicClient, fallback, http } from 'viem';
import { CHAIN_ID_TO_CHAIN, getPublicRpcUrl, isSupportedChainId, type SupportedChainId } from './chains';

const createReader = (chainId: SupportedChainId) => {
  const configured = import.meta.env?.[`VITE_RPC_URL_${chainId}`] || (chainId === 11155111 ? import.meta.env?.VITE_SEPOLIA_RPC_URL : undefined);
  const primary = http(getPublicRpcUrl(chainId), { timeout: 10_000, retryCount: 0, batch: { wait: 20 } });
  const backup = chainId === 8453 ? 'https://base-rpc.publicnode.com' : chainId === 11155111 ? CHAIN_ID_TO_CHAIN[chainId].rpcUrls.default.http[0] : undefined;
  return createPublicClient({
    chain: CHAIN_ID_TO_CHAIN[chainId],
    // Explicit endpoints remain authoritative. This reader is never used to
    // broadcast or retry a wallet transaction.
    transport: !configured && backup
      ? fallback([primary, http(backup, { timeout: 10_000, retryCount: 0, batch: { wait: 20 } })], { retryCount: 1 })
      : http(getPublicRpcUrl(chainId), { timeout: 10_000, retryCount: 1, batch: { wait: 20 } }),
  });
};
const readers = new Map<number, ReturnType<typeof createReader>>();

export function getReadOnlyChainClient(chainId: number) {
  if (!isSupportedChainId(chainId)) throw new Error('Unsupported network');
  let reader = readers.get(chainId);
  if (!reader) { reader = createReader(chainId); readers.set(chainId, reader); }
  return reader;
}
