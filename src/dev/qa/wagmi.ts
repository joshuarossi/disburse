/* eslint-disable @typescript-eslint/no-explicit-any -- development-only wallet fixture */
export * from 'wagmi';
import { wallet } from './fixtures';
import { BaseError, UserRejectedRequestError } from 'viem';
const disabled = async () => {
  throw new Error('Wallet signing is disabled in visual QA mode.');
};
const noop = () => {};
export function useAccount() {
  return {
    address: wallet,
    isConnected: true,
    isConnecting: false,
    isReconnecting: false,
    chainId: 8453,
    chain: { id: 8453 },
  };
}
export function useChainId() {
  return 8453;
}
export function useDisconnect() {
  return { disconnect: noop };
}
export function useSwitchChain() {
  return { switchChainAsync: disabled };
}
export function useSendTransaction() {
  return {
    sendTransaction: noop,
    sendTransactionAsync: async () => {
      const scenario = sessionStorage.getItem('qa:scenario');
      if (scenario?.startsWith('onboarding-wallet-')) {
        sessionStorage.setItem('qa:walletAttempts', String(Number(sessionStorage.getItem('qa:walletAttempts') ?? 0) + 1));
        if (scenario === 'onboarding-wallet-unknown') throw new Error('RPC response lost');
        throw new BaseError('User rejected the request.', { cause: new UserRejectedRequestError(new Error('User denied transaction signature.')), metaMessages: [`Request Arguments: from: ${wallet} data: 0x${'00'.repeat(2000)}`] });
      }
      return disabled();
    },
    isPending: false,
    data: undefined,
    error: null,
  };
}
export function usePublicClient() {
  return { waitForTransactionReceipt: disabled };
}
export function useWaitForTransactionReceipt() {
  return { data: undefined, isLoading: false, isSuccess: false };
}
export function useSignMessage() {
  return { signMessageAsync: disabled };
}
export function useWatchContractEvent() {}
export function useReadContracts(args: any) {
  return {
    data: args.contracts?.map(() => ({
      result: 148250500000n,
      status: 'success',
    })),
    isLoading: false,
    isPending: false,
    isFetching: false,
    refetch: noop,
  };
}
