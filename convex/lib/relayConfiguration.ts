import type { ExecutionFee } from '../../shared/executionFee';

// Do not reactivate application-funded execution when old credentials remain
// configured. Historical signed fees are retained with their original jobs.
export function relayConfiguration(chainId: number, symbol: string): { fee: ExecutionFee } {
  void chainId; void symbol;
  throw new Error('This payment service is no longer available. A customer-paid execution service is required before requesting a new fee quote.');
}
