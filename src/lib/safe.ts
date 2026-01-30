import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { encodeFunctionData, parseUnits, getAddress } from 'viem';
import { getTokensForChain, isSupportedChainId } from './chains';

// Operation types for Safe transactions
const OperationType = {
  Call: 0,
  DelegateCall: 1,
} as const;

// MetaTransactionData type definition
interface MetaTransactionData {
  to: string;
  value: string;
  data: string;
  operation?: number;
}

// Safe Transaction Service base URL per chain (Safe appends /api or /v1/...)
const SAFE_TX_SERVICE_URL_BY_CHAIN: Record<number, string> = {
  1: 'https://safe-transaction-mainnet.safe.global/api',
  137: 'https://safe-transaction-polygon.safe.global/api',
  8453: 'https://safe-transaction-base.safe.global/api',
  42161: 'https://safe-transaction-arbitrum.safe.global/api',
  11155111: 'https://safe-transaction-sepolia.safe.global/api',
  84532: 'https://safe-transaction-base-sepolia.safe.global/api',
};

// ERC20 ABI for transfer function
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export function getSafeTxServiceUrl(chainId: number): string {
  const url = SAFE_TX_SERVICE_URL_BY_CHAIN[chainId];
  if (!url) {
    throw new Error(`Unsupported chain for Safe: ${chainId}`);
  }
  return url;
}

/**
 * Initialize Safe API Kit for a given chain
 */
export function getSafeApiKit(chainId: number): SafeApiKit {
  const txServiceUrl = getSafeTxServiceUrl(chainId);
  try {
    return new SafeApiKit({
      chainId: BigInt(chainId),
      txServiceUrl,
    });
  } catch (error) {
    console.error('[Safe] Failed to initialize SafeApiKit:', error);
    throw error;
  }
}

/**
 * Initialize Safe Protocol Kit with a signer (chainId needed for correct network)
 */
export async function getSafeProtocolKit(
  safeAddress: string,
  signer: string,
  chainId: number
): Promise<Safe> {
  const checksummedSafeAddress = getAddress(safeAddress);
  const checksummedSigner = getAddress(signer);
  try {
    const protocolKit = await Safe.init({
      provider: window.ethereum,
      signer: checksummedSigner,
      safeAddress: checksummedSafeAddress,
    });
    return protocolKit;
  } catch (error) {
    console.error('[Safe] Failed to create Protocol Kit:', error);
    throw error;
  }
}

/**
 * Get Safe info including owners and threshold (for a specific chain)
 */
export async function getSafeInfo(safeAddress: string, chainId: number) {
  const checksummedAddress = getAddress(safeAddress);
  const apiKit = getSafeApiKit(chainId);
  try {
    const safeInfo = await apiKit.getSafeInfo(checksummedAddress);
    return {
      address: safeInfo.address,
      nonce: safeInfo.nonce,
      threshold: safeInfo.threshold,
      owners: safeInfo.owners,
      version: safeInfo.version,
    };
  } catch (error) {
    console.error('[Safe] Failed to get Safe info:', error);
    throw error;
  }
}

/**
 * Check if an address is an owner of the Safe (on the given chain)
 */
export async function isOwner(
  safeAddress: string,
  address: string,
  chainId: number
): Promise<boolean> {
  try {
    const checksummedAddress = getAddress(address);
    const safeInfo = await getSafeInfo(safeAddress, chainId);
    return safeInfo.owners.some(
      (owner) => getAddress(owner) === checksummedAddress
    );
  } catch {
    return false;
  }
}

/**
 * Create an ERC20 transfer transaction (token address from chain config)
 */
export function createTransferTx(
  chainId: number,
  token: string,
  to: string,
  amount: string
): MetaTransactionData {
  const tokens = getTokensForChain(chainId);
  const tokenConfig = tokens[token];
  if (!tokenConfig) {
    throw new Error(`Token ${token} not supported on chain ${chainId}`);
  }
  const value = parseUnits(amount, tokenConfig.decimals);

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to as `0x${string}`, value],
  });

  return {
    to: tokenConfig.address,
    value: '0',
    data,
    operation: OperationType.Call,
  };
}

/**
 * Create multiple ERC20 transfer transactions for batch disbursements
 */
export function createBatchTransferTxs(
  chainId: number,
  token: string,
  recipients: Array<{ to: string; amount: string }>
): MetaTransactionData[] {
  return recipients.map((r) => createTransferTx(chainId, token, r.to, r.amount));
}

/**
 * Create and propose a Safe transaction (on the given chain)
 */
export async function proposeTransaction(
  safeAddress: string,
  signerAddress: string,
  chainId: number,
  transactions: MetaTransactionData[]
): Promise<string> {
  const checksummedSafeAddress = getAddress(safeAddress);
  const checksummedSignerAddress = getAddress(signerAddress);

  const protocolKit = await getSafeProtocolKit(
    checksummedSafeAddress,
    checksummedSignerAddress,
    chainId
  );
  const apiKit = getSafeApiKit(chainId);

  const safeTransaction = await protocolKit.createTransaction({
    transactions,
  });
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
  const signature = await protocolKit.signHash(safeTxHash);

  await apiKit.proposeTransaction({
    safeAddress: checksummedSafeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: checksummedSignerAddress,
    senderSignature: signature.data,
  });

  return safeTxHash;
}

/**
 * Get pending transactions for a Safe (on the given chain)
 */
export async function getPendingTransactions(
  safeAddress: string,
  chainId: number
) {
  const checksummedAddress = getAddress(safeAddress);
  const apiKit = getSafeApiKit(chainId);
  try {
    const pendingTxs = await apiKit.getPendingTransactions(checksummedAddress);
    return pendingTxs.results;
  } catch (error) {
    console.error('Failed to get pending transactions:', error);
    return [];
  }
}

/**
 * Execute a Safe transaction (on the given chain)
 */
export async function executeTransaction(
  safeAddress: string,
  signerAddress: string,
  chainId: number,
  safeTxHash: string
): Promise<string> {
  const protocolKit = await getSafeProtocolKit(
    safeAddress,
    signerAddress,
    chainId
  );
  const apiKit = getSafeApiKit(chainId);

  const safeTransaction = await apiKit.getTransaction(safeTxHash);
  const threshold = await protocolKit.getThreshold();
  const currentSignatures = safeTransaction.confirmations?.length || 0;

  if (currentSignatures < threshold) {
    const signature = await protocolKit.signHash(safeTxHash);
    await apiKit.confirmTransaction(safeTxHash, signature.data);
  }

  const updatedTx = await apiKit.getTransaction(safeTxHash);
  const safeTransactionData = {
    to: updatedTx.to,
    value: updatedTx.value,
    data: updatedTx.data || '0x',
    operation: updatedTx.operation,
    safeTxGas: updatedTx.safeTxGas,
    baseGas: updatedTx.baseGas,
    gasPrice: updatedTx.gasPrice,
    gasToken: updatedTx.gasToken,
    refundReceiver: updatedTx.refundReceiver,
    nonce: updatedTx.nonce,
  };

  const safeTx = await protocolKit.createTransaction({
    transactions: [safeTransactionData],
    options: {
      nonce: Number(updatedTx.nonce),
    },
  });

  for (const confirmation of updatedTx.confirmations || []) {
    const sig = {
      signer: confirmation.owner,
      data: confirmation.signature,
      isContractSignature: false,
      staticPart: () => confirmation.signature.slice(0, 132),
      dynamicPart: () => confirmation.signature.slice(132),
    };
    safeTx.addSignature(sig);
  }

  const executeTxResponse = await protocolKit.executeTransaction(safeTx);
  const txResponse = executeTxResponse.transactionResponse;
  if (txResponse && typeof txResponse === 'object' && 'wait' in txResponse) {
    const waitFn = txResponse.wait as () => Promise<{ hash?: string }>;
    const receipt = await waitFn();
    return receipt?.hash || executeTxResponse.hash;
  }
  return executeTxResponse.hash;
}

/**
 * Validate that an address is a valid Safe contract (on the given chain)
 */
export async function validateSafeAddress(
  safeAddress: string,
  chainId: number
): Promise<boolean> {
  if (!isSupportedChainId(chainId)) {
    return false;
  }
  try {
    const checksummedAddress = getAddress(safeAddress);
    const safeInfo = await getSafeInfo(checksummedAddress, chainId);
    return !!safeInfo && !!safeInfo.address;
  } catch {
    return false;
  }
}
