type HistoricalReceipt = { transactionHash: string } | { receipt: { transactionHash: string } };
type HistoricalStatus = { chainId: number; status: number } & ({ receipt: HistoricalReceipt } | { hash: string } | Record<never, never>);
type HistoricalRelayer = {
  sendTransaction(request: { chainId: number; to: string; data: string }, options: { retries: { max: number } }): Promise<string>;
  getStatus(request: { id: string }): Promise<HistoricalStatus>;
  getCapabilities(): Promise<Record<number, { feeCollector: string; tokens: Array<{ address: string; decimals: number }> }>>;
  getBalance(): Promise<{ balance: bigint }>;
};

/** Retained only while historical jobs use the provider's response types.
 * Turbo bills the application Gas Tank. A customer transfer in the Safe batch
 * is reimbursement and does not meet the customer-paid service requirement.
 * Existing jobs must continue their independent on-chain recovery instead. */
export function managedRelay(chainId: number): HistoricalRelayer {
  void chainId;
  throw new Error('This execution service is no longer available. Check any original submission before preparing another request.');
}
