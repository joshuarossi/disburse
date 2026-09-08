import type { Hex } from 'viem';
import type { WalletSetupIntent } from '../../../shared/walletSetup';
export async function checkSetupWallet() {
  const scenario = sessionStorage.getItem('qa:scenario') ?? '';
  if (!scenario.startsWith('customer-setup-')) throw new Error('Wallet actions are disabled in visual QA.');
  if (scenario.endsWith('wallet-changed')) throw new Error('Your wallet or network changed. Reconnect the wallet that prepared this setup.');
  if (scenario.endsWith('unsupported-wallet')) throw new Error('This wallet cannot create and fund the account together. Connect a current MetaMask wallet on Base or Arbitrum.');
  return { request: async () => null };
}
export function walletSetupNotAccepted(error: unknown) { return !!error && typeof error === 'object' && 'code' in error && [4001, 5750].includes(Number(error.code)); }
export async function submitWalletSetup(intent: WalletSetupIntent, batchId: Hex) {
  sessionStorage.setItem('qa:walletAttempts', String(Number(sessionStorage.getItem('qa:walletAttempts') ?? 0) + 1));
  const scenario = sessionStorage.getItem('qa:scenario') ?? '';
  if (scenario.endsWith('declined') || scenario.endsWith('decline-save-failed')) throw Object.assign(new Error('User rejected the request. Request Arguments: 0xdead Version: viem'), { code: 4001 });
  if (scenario.endsWith('upgrade-declined')) throw Object.assign(new Error('Upgrade rejected'), { code: 5750 });
  sessionStorage.setItem('qa:submissions', String(Number(sessionStorage.getItem('qa:submissions') ?? 0) + 1));
  sessionStorage.setItem('qa:walletBatch', JSON.stringify({ intent, batchId }));
  if (scenario.endsWith('unknown')) throw new Error('Connection lost');
}
export async function checkWalletSetup() {
  const scenario = sessionStorage.getItem('qa:scenario') ?? '';
  if (scenario.endsWith('check-outage')) throw new Error('RPC https://rpc.invalid/private failed');
  if (scenario.endsWith('malformed-status')) throw new Error('MetaMask returned an unreadable setup status. Keep this request and check it again.');
  if (scenario.endsWith('success') || scenario.endsWith('link-failed') || scenario.endsWith('complete-response-lost') || scenario.endsWith('reverted')) return { status: scenario.endsWith('reverted') ? 500 : 200, txHash: `0x${'cd'.repeat(32)}` as Hex };
  return { status: 100 };
}
