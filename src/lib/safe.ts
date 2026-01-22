import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { encodeFunctionData, parseUnits } from 'viem';
import { TOKENS } from './wagmi';

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

// Sepolia chain ID
const CHAIN_ID = 11155111n;

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

/**
 * Initialize Safe API Kit for Sepolia
 */
export function getSafeApiKit(): SafeApiKit {
  return new SafeApiKit({
    chainId: CHAIN_ID,
  });
}

/**
 * Initialize Safe Protocol Kit with a signer
 */
export async function getSafeProtocolKit(
  safeAddress: string,
  signer: string
): Promise<Safe> {
  const protocolKit = await Safe.init({
    provider: window.ethereum,
    signer,
    safeAddress,
  });
  return protocolKit;
}

/**
 * Get Safe info including owners and threshold
 */
export async function getSafeInfo(safeAddress: string) {
  const apiKit = getSafeApiKit();
  try {
    const safeInfo = await apiKit.getSafeInfo(safeAddress);
    return {
      address: safeInfo.address,
      nonce: safeInfo.nonce,
      threshold: safeInfo.threshold,
      owners: safeInfo.owners,
      version: safeInfo.version,
    };
  } catch (error) {
    console.error('Failed to get Safe info:', error);
    throw error;
  }
}

/**
 * Check if an address is an owner of the Safe
 */
export async function isOwner(safeAddress: string, address: string): Promise<boolean> {
  try {
    const safeInfo = await getSafeInfo(safeAddress);
    return safeInfo.owners.some(
      (owner) => owner.toLowerCase() === address.toLowerCase()
    );
  } catch {
    return false;
  }
}

/**
 * Create an ERC20 transfer transaction
 */
export function createTransferTx(
  token: 'USDC' | 'USDT',
  to: string,
  amount: string
): MetaTransactionData {
  const tokenConfig = TOKENS[token];
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
 * Create and propose a Safe transaction
 */
export async function proposeTransaction(
  safeAddress: string,
  signerAddress: string,
  transactions: MetaTransactionData[]
): Promise<string> {
  // Initialize Protocol Kit
  const protocolKit = await getSafeProtocolKit(safeAddress, signerAddress);
  const apiKit = getSafeApiKit();

  // Create the transaction
  const safeTransaction = await protocolKit.createTransaction({
    transactions,
  });

  // Get the transaction hash
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);

  // Sign the transaction
  const signature = await protocolKit.signHash(safeTxHash);

  // Propose the transaction to the Safe Transaction Service
  await apiKit.proposeTransaction({
    safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: signerAddress,
    senderSignature: signature.data,
  });

  return safeTxHash;
}

/**
 * Get pending transactions for a Safe
 */
export async function getPendingTransactions(safeAddress: string) {
  const apiKit = getSafeApiKit();
  try {
    const pendingTxs = await apiKit.getPendingTransactions(safeAddress);
    return pendingTxs.results;
  } catch (error) {
    console.error('Failed to get pending transactions:', error);
    return [];
  }
}

/**
 * Execute a Safe transaction
 * For single-signer Safes, this will execute immediately
 */
export async function executeTransaction(
  safeAddress: string,
  signerAddress: string,
  safeTxHash: string
): Promise<string> {
  const protocolKit = await getSafeProtocolKit(safeAddress, signerAddress);
  const apiKit = getSafeApiKit();

  // Get the transaction from the service
  const safeTransaction = await apiKit.getTransaction(safeTxHash);

  // Check if we need to add our signature first
  const threshold = await protocolKit.getThreshold();
  const currentSignatures = safeTransaction.confirmations?.length || 0;

  if (currentSignatures < threshold) {
    // Sign the transaction
    const signature = await protocolKit.signHash(safeTxHash);
    
    // Add confirmation to the service
    await apiKit.confirmTransaction(safeTxHash, signature.data);
  }

  // Re-fetch the transaction with updated signatures
  const updatedTx = await apiKit.getTransaction(safeTxHash);
  
  // Build the Safe transaction object from the API response
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

  // Create Safe transaction object
  const safeTx = await protocolKit.createTransaction({
    transactions: [safeTransactionData],
    options: {
      nonce: updatedTx.nonce,
    },
  });

  // Add all confirmations/signatures
  for (const confirmation of updatedTx.confirmations || []) {
    safeTx.addSignature({
      signer: confirmation.owner,
      data: confirmation.signature,
      isContractSignature: false,
    });
  }

  // Execute the transaction
  const executeTxResponse = await protocolKit.executeTransaction(safeTx);
  
  // Wait for the transaction to be mined
  const receipt = await executeTxResponse.transactionResponse?.wait();
  
  return receipt?.hash || executeTxResponse.hash;
}

/**
 * Validate that an address is a valid Safe contract
 */
export async function validateSafeAddress(safeAddress: string): Promise<boolean> {
  try {
    const safeInfo = await getSafeInfo(safeAddress);
    return !!safeInfo && !!safeInfo.address;
  } catch {
    return false;
  }
}
