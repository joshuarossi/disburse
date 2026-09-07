import { createWalletClient, custom, type Address, type Hex } from 'viem';
import { getConnectedProvider } from './walletProvider';
import { approvalSigningData, safeMessageTypes, safeTransactionTypes } from '../../shared/safeSignatures';
import type { PreparedOwnerProposal } from '../../shared/ownerProposal';

export async function signAccountApproval(chainId: number, wallet: string, proposal: PreparedOwnerProposal, path: string[]) {
  if (path[0]?.toLowerCase() !== proposal.safeAddress.toLowerCase()) throw new Error('The approval path belongs to another funding account');
  const client = createWalletClient({ transport: custom(await getConnectedProvider(chainId)), account: wallet as Address });
  const domain = { chainId, verifyingContract: path[path.length - 1] as Address };
  if (path.length > 1) {
    const { message } = approvalSigningData(chainId, path, proposal.safeTransactionData);
    return client.signTypedData({ domain, types: safeMessageTypes, primaryType: 'SafeMessage', message: { message } });
  }
  const t = proposal.safeTransactionData;
  return client.signTypedData({ domain, types: safeTransactionTypes, primaryType: 'SafeTx', message: {
    to: t.to as Address, value: BigInt(t.value), data: t.data as Hex, operation: t.operation,
    safeTxGas: BigInt(t.safeTxGas), baseGas: BigInt(t.baseGas), gasPrice: BigInt(t.gasPrice),
    gasToken: t.gasToken as Address, refundReceiver: t.refundReceiver as Address, nonce: BigInt(t.nonce),
  } });
}
export async function sendApprovedAccountPayment(chainId: number, wallet: string, transaction: { to: string; data: string }) {
  const provider = await getConnectedProvider(chainId);
  return await provider.request({ method: 'eth_sendTransaction', params: [{ from: wallet, to: transaction.to, data: transaction.data, value: '0x0' }] }) as string;
}
