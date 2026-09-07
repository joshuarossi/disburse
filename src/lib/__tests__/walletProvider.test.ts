import { describe, expect, it, vi } from 'vitest';
import { getConnectedProvider } from '../walletProvider';
const state = vi.hoisted(() => ({ connected: true, chain: '0x2105' }));
vi.mock('../wagmi', () => ({ config: {} }));
vi.mock('wagmi/actions', () => ({
  getAccount: () => ({
    isConnected: state.connected,
    connector: {
      getProvider: async () => ({ request: async () => state.chain }),
    },
  }),
}));
describe('connected wallet transport', () => {
  it('uses the selected connector without requiring window.ethereum', async () => {
    state.connected = true;
    state.chain = '0x2105';
    await expect(getConnectedProvider(8453)).resolves.toHaveProperty('request');
  });
  it('rejects an unexpected wallet network', async () => {
    state.connected = true;
    state.chain = '0x1';
    await expect(getConnectedProvider(8453)).rejects.toThrow(
      'funding account network',
    );
  });
  it('requires a live connected wallet', async () => {
    state.connected = false;
    await expect(getConnectedProvider(8453)).rejects.toThrow(
      'Connect a wallet',
    );
  });
});
