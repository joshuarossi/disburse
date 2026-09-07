import { createGelatoEvmRelayerClient } from '@gelatocloud/gasless';

export function managedRelay(chainId: number) {
  const testnet = [11155111, 84532].includes(chainId);
  const apiKey = process.env[testnet ? 'GELATO_TESTNET_API_KEY' : 'GELATO_API_KEY'];
  if (!apiKey) throw new Error('Managed payment service is not connected. Contact support.');
  return createGelatoEvmRelayerClient({ apiKey, testnet, timeout: 15000, httpTransportConfig: { retryCount: 0, timeout: 15000 } });
}
