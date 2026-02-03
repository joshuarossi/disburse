import { GelatoRelayPack } from '@safe-global/relay-kit';
import type { MetaTransactionData } from '@safe-global/types-kit';
import { getSafeApiKit, getSafeProtocolKit } from './safe';
import { getAddress } from 'viem';

const GELATO_RELAY_URL = 'https://api.gelato.digital';
const GELATO_NATIVE_TOKEN_ADDRESS =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type RelayExecutionResult = {
  taskId: string;
};

export async function proposeTransactionViaGelato(args: {
  safeAddress: string;
  signerAddress: string;
  chainId: number;
  transactions: MetaTransactionData[];
  gasToken?: `0x${string}`;
}): Promise<string> {
  const checksummedSafeAddress = getAddress(args.safeAddress);
  const checksummedSignerAddress = getAddress(args.signerAddress);
  const protocolKit = await getSafeProtocolKit(
    checksummedSafeAddress,
    checksummedSignerAddress,
    args.chainId
  );
  const apiKit = getSafeApiKit(args.chainId);
  const relayKit = new GelatoRelayPack({ protocolKit });

  const safeTx = await relayKit.createTransaction({
    transactions: args.transactions,
    options: {
      gasToken: args.gasToken ? getAddress(args.gasToken) : undefined,
    },
  });

  const safeTxHash = await protocolKit.getTransactionHash(safeTx);
  const signature = await protocolKit.signHash(safeTxHash);

  await apiKit.proposeTransaction({
    safeAddress: checksummedSafeAddress,
    safeTransactionData: safeTx.data,
    safeTxHash,
    senderAddress: checksummedSignerAddress,
    senderSignature: signature.data,
  });

  return safeTxHash;
}

export async function executeTransactionViaGelato(args: {
  safeAddress: string;
  signerAddress: string;
  chainId: number;
  safeTxHash: string;
}): Promise<RelayExecutionResult> {
  const protocolKit = await getSafeProtocolKit(
    args.safeAddress,
    args.signerAddress,
    args.chainId
  );
  const apiKit = getSafeApiKit(args.chainId);

  const safeTransaction = await apiKit.getTransaction(args.safeTxHash);
  const threshold = await protocolKit.getThreshold();
  const currentSignatures = safeTransaction.confirmations?.length || 0;

  if (currentSignatures < threshold) {
    const signature = await protocolKit.signHash(args.safeTxHash);
    await apiKit.confirmTransaction(args.safeTxHash, signature.data);
  }

  const updatedTx = await apiKit.getTransaction(args.safeTxHash);
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

  const encodedTransaction = await protocolKit.getEncodedTransaction(safeTx);
  const gasToken = updatedTx.gasToken ?? ZERO_ADDRESS;
  const feeToken =
    !gasToken || gasToken === ZERO_ADDRESS
      ? GELATO_NATIVE_TOKEN_ADDRESS
      : gasToken;

  const relayPayload = {
    chainId: String(args.chainId),
    target: args.safeAddress,
    data: encodedTransaction,
    feeToken,
    isRelayContext: false,
  };

  let relayResponse: { taskId?: string } | null = null;
  let responseBody = '';
  try {
    const response = await fetch(
      `${GELATO_RELAY_URL}/relays/v2/call-with-sync-fee`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(relayPayload),
      }
    );

    responseBody = await response.text();
    console.info('[Relay] Gelato relay response', {
      status: response.status,
      body: responseBody,
    });

    if (!response.ok) {
      throw new Error(
        `Gelato relay failed with status ${response.status}: ${responseBody}`
      );
    }

    relayResponse = responseBody ? JSON.parse(responseBody) : null;
  } catch (error) {
    console.error('[Relay] Gelato relay error', {
      error,
      body: responseBody,
    });
    throw error instanceof Error
      ? error
      : new Error('Gelato relay failed');
  }

  if (!relayResponse?.taskId) {
    throw new Error('Relay did not return a task ID.');
  }

  return { taskId: relayResponse.taskId };
}
