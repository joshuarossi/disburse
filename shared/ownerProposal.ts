export type PreparedOwnerProposal = {
  safeAddress: string;
  safeTxHash: string;
  senderAddress: string;
  senderSignature: string;
  safeTransactionData: {
    to: string;
    value: string;
    data: string;
    operation: 0 | 1;
    safeTxGas: string;
    baseGas: string;
    gasPrice: string;
    gasToken: string;
    refundReceiver: string;
    nonce: number;
  };
};
