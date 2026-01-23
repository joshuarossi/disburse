import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { encodeFunctionData, parseUnits, getAddress } from 'viem';
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
const CHAIN_ID = BigInt(11155111);

// Safe Transaction Service URL for Sepolia (SDK appends /v1/... paths)
const SAFE_TX_SERVICE_URL = 'https://safe-transaction-sepolia.safe.global/api';

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
  console.log('[Safe] Initializing SafeApiKit with txServiceUrl:', SAFE_TX_SERVICE_URL);
  try {
    const apiKit = new SafeApiKit({
      chainId: CHAIN_ID,
      txServiceUrl: SAFE_TX_SERVICE_URL,
    });
    console.log('[Safe] SafeApiKit initialized successfully');
    return apiKit;
  } catch (error) {
    console.error('[Safe] Failed to initialize SafeApiKit:', error);
    throw error;
  }
}

/**
 * Initialize Safe Protocol Kit with a signer
 */
export async function getSafeProtocolKit(
  safeAddress: string,
  signer: string
): Promise<Safe> {
  const checksummedSafeAddress = getAddress(safeAddress);
  const checksummedSigner = getAddress(signer);
  console.log('[Safe] getSafeProtocolKit called', { safeAddress: checksummedSafeAddress, signer: checksummedSigner });
  try {
    const protocolKit = await Safe.init({
      provider: window.ethereum,
      signer: checksummedSigner,
      safeAddress: checksummedSafeAddress,
    });
    console.log('[Safe] Protocol Kit created successfully');
    return protocolKit;
  } catch (error) {
    console.error('[Safe] Failed to create Protocol Kit:', error);
    throw error;
  }
}

/**
 * Get Safe info including owners and threshold
 */
export async function getSafeInfo(safeAddress: string) {
  const checksummedAddress = getAddress(safeAddress);
  console.log('[Safe] getSafeInfo called with address:', checksummedAddress);
  const apiKit = getSafeApiKit();
  console.log('[Safe] Calling apiKit.getSafeInfo...');
  try {
    const safeInfo = await apiKit.getSafeInfo(checksummedAddress);
    console.log('[Safe] Got Safe info:', safeInfo);
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
 * Check if an address is an owner of the Safe
 */
export async function isOwner(safeAddress: string, address: string): Promise<boolean> {
  try {
    const checksummedAddress = getAddress(address);
    const safeInfo = await getSafeInfo(safeAddress);
    return safeInfo.owners.some(
      (owner) => getAddress(owner) === checksummedAddress
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
 * Create multiple ERC20 transfer transactions for batch disbursements
 */
export function createBatchTransferTxs(
  token: 'USDC' | 'USDT',
  recipients: Array<{ to: string; amount: string }>
): MetaTransactionData[] {
  return recipients.map((recipient) => createTransferTx(token, recipient.to, recipient.amount));
}

/**
 * Create and propose a Safe transaction
 */
export async function proposeTransaction(
  safeAddress: string,
  signerAddress: string,
  transactions: MetaTransactionData[]
): Promise<string> {
  // Ensure addresses are checksummed (Safe API requires this)
  const checksummedSafeAddress = getAddress(safeAddress);
  const checksummedSignerAddress = getAddress(signerAddress);
  
  console.log('[Safe] proposeTransaction called', { 
    safeAddress: checksummedSafeAddress, 
    signerAddress: checksummedSignerAddress, 
    transactions 
  });
  
  // Initialize Protocol Kit
  console.log('[Safe] Initializing Protocol Kit...');
  const protocolKit = await getSafeProtocolKit(checksummedSafeAddress, checksummedSignerAddress);
  console.log('[Safe] Protocol Kit initialized');
  
  console.log('[Safe] Getting API Kit...');
  const apiKit = getSafeApiKit();
  console.log('[Safe] API Kit ready');

  // Create the transaction
  console.log('[Safe] Creating transaction...');
  const safeTransaction = await protocolKit.createTransaction({
    transactions,
  });
  console.log('[Safe] Transaction created');

  // Get the transaction hash
  console.log('[Safe] Getting transaction hash...');
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
  console.log('[Safe] Transaction hash:', safeTxHash);

  // Sign the transaction
  console.log('[Safe] Signing transaction...');
  const signature = await protocolKit.signHash(safeTxHash);
  console.log('[Safe] Transaction signed');

  // Propose the transaction to the Safe Transaction Service
  console.log('[Safe] Proposing transaction to service...');
  await apiKit.proposeTransaction({
    safeAddress: checksummedSafeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: checksummedSignerAddress,
    senderSignature: signature.data,
  });
  console.log('[Safe] Transaction proposed successfully');

  return safeTxHash;
}

/**
 * Get pending transactions for a Safe
 */
export async function getPendingTransactions(safeAddress: string) {
  const checksummedAddress = getAddress(safeAddress);
  const apiKit = getSafeApiKit();
  try {
    const pendingTxs = await apiKit.getPendingTransactions(checksummedAddress);
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
      nonce: Number(updatedTx.nonce),
    },
  });

  // Add all confirmations/signatures
  for (const confirmation of updatedTx.confirmations || []) {
    // Create a signature object compatible with the Safe SDK
    const sig = {
      signer: confirmation.owner,
      data: confirmation.signature,
      isContractSignature: false,
      staticPart: () => confirmation.signature.slice(0, 132),
      dynamicPart: () => confirmation.signature.slice(132),
    };
    safeTx.addSignature(sig);
  }

  // Execute the transaction
  const executeTxResponse = await protocolKit.executeTransaction(safeTx);
  
  // Wait for the transaction to be mined and get the hash
  const txResponse = executeTxResponse.transactionResponse;
  if (txResponse && typeof txResponse === 'object' && 'wait' in txResponse) {
    const waitFn = txResponse.wait as () => Promise<{ hash?: string }>;
    const receipt = await waitFn();
    return receipt?.hash || executeTxResponse.hash;
  }
  
  return executeTxResponse.hash;
}

/**
 * Validate that an address is a valid Safe contract
 */
export async function validateSafeAddress(safeAddress: string): Promise<boolean> {
  console.log('[Safe] validateSafeAddress called with:', safeAddress);
  try {
    // First validate it's a valid Ethereum address
    const checksummedAddress = getAddress(safeAddress);
    console.log('[Safe] Checksummed address:', checksummedAddress);
    
    const safeInfo = await getSafeInfo(checksummedAddress);
    const isValid = !!safeInfo && !!safeInfo.address;
    console.log('[Safe] validateSafeAddress result:', isValid, safeInfo);
    return isValid;
  } catch (error) {
    console.error('[Safe] validateSafeAddress caught error:', error);
    return false;
  }
}
