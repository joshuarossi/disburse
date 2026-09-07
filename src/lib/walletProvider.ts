import { getAccount } from 'wagmi/actions';
import type { Eip1193Provider } from '@safe-global/protocol-kit';

/** Use the connector the user actually selected, including WalletConnect. */
export async function getConnectedProvider(
  expectedChainId?: number,
): Promise<Eip1193Provider> {
  const { config } = await import('./wagmi');
  const account = getAccount(config);
  if (!account.isConnected || !account.connector)
    throw new Error('Connect a wallet before continuing');
  const candidate = await account.connector.getProvider();
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !('request' in candidate) ||
    typeof candidate.request !== 'function'
  )
    throw new Error('This wallet does not expose a supported signing provider');
  const provider = candidate as Eip1193Provider;
  if (expectedChainId !== undefined) {
    const chain = await provider.request({ method: 'eth_chainId' });
    if (Number(chain) !== expectedChainId)
      throw new Error(
        'Switch your wallet to the funding account network before continuing',
      );
  }
  return provider;
}
