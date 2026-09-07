import { afterEach, expect, it, vi } from 'vitest';
import { managedRelay } from '../lib/managedRelay';
import { relayConfiguration } from '../lib/relayConfiguration';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each([1, 8453, 42161, 11155111, 84532])('cannot activate a Disburse-funded executor on chain %s, even with credentials', chainId => {
  vi.stubEnv('GELATO_API_KEY', 'historical-test-key');
  vi.stubEnv('GELATO_TESTNET_API_KEY', 'historical-test-key');
  vi.stubEnv(`GELATO_${chainId}_FEE_USDC`, '0.05');
  vi.stubEnv(`GELATO_${chainId}_FEE_COLLECTOR`, '0x1111111111111111111111111111111111111111');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(() => managedRelay(chainId)).toThrow('no longer available');
  expect(() => relayConfiguration(chainId, 'USDC')).toThrow('customer-paid execution service');
  expect(fetcher).not.toHaveBeenCalled();
});
