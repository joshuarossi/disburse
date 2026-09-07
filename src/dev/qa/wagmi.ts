/* eslint-disable @typescript-eslint/no-explicit-any -- development-only wallet fixture */
export * from 'wagmi';
import { wallet } from './fixtures';
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
    sendTransactionAsync: disabled,
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
