import { getAddress } from 'viem';
import { getPublicClient } from 'wagmi/actions';
import { config } from '@/lib/wagmi';
import { getTokensForChain } from '@/lib/chains';
import {
  type RelayFeeMode,
  type RelayFeeTokenSymbol,
  SUPPORTED_RELAY_FEE_TOKENS,
} from '@/lib/relayConfig';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const ERC20_FEE_SUPPORTED_MAINNETS = new Set([1, 137, 8453, 42161]);

const erc20BalanceAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export type RelayFeeSelection = {
  feeTokenAddress: `0x${string}`;
  feeTokenSymbol: RelayFeeTokenSymbol | 'NATIVE';
  usedFallback: boolean;
  fallbackReason?: string;
};

export async function selectRelayFeeToken(args: {
  chainId: number;
  safeAddress: string;
  feeTokenSymbol: RelayFeeTokenSymbol;
  feeMode: RelayFeeMode;
}): Promise<RelayFeeSelection> {
  const safeAddress = getAddress(args.safeAddress);
  const feeTokenSymbol = SUPPORTED_RELAY_FEE_TOKENS.includes(
    args.feeTokenSymbol
  )
    ? args.feeTokenSymbol
    : 'USDC';

  const client = getPublicClient(config, { chainId: args.chainId });
  if (!client) {
    throw new Error('No public client available for selected chain.');
  }

  const tokens = getTokensForChain(args.chainId);
  const feeTokenConfig = tokens[feeTokenSymbol];
  const erc20SupportedForRelay = ERC20_FEE_SUPPORTED_MAINNETS.has(args.chainId);

  const nativeBalance = await client.getBalance({ address: safeAddress });

  if (!feeTokenConfig || !erc20SupportedForRelay) {
    if (args.feeMode === 'stablecoin_only') {
      throw new Error('Fee token not supported on this network.');
    }

    if (nativeBalance > 0n) {
      return {
        feeTokenAddress: ZERO_ADDRESS,
        feeTokenSymbol: 'NATIVE',
        usedFallback: true,
        fallbackReason: erc20SupportedForRelay
          ? 'Fee token not available on this chain.'
          : 'Fee tokens are not supported for relay on this network.',
      };
    }

    throw new Error('Insufficient balance to pay relay fees.');
  }

  const stableBalance = await client.readContract({
    address: feeTokenConfig.address,
    abi: erc20BalanceAbi,
    functionName: 'balanceOf',
    args: [safeAddress],
  });

  if (stableBalance > 0n) {
    return {
      feeTokenAddress: feeTokenConfig.address,
      feeTokenSymbol,
      usedFallback: false,
    };
  }

  if (args.feeMode === 'stablecoin_only') {
    throw new Error(
      `Insufficient ${feeTokenSymbol} balance to pay relay fees.`
    );
  }

  if (nativeBalance > 0n) {
    return {
      feeTokenAddress: ZERO_ADDRESS,
      feeTokenSymbol: 'NATIVE',
      usedFallback: true,
      fallbackReason: `No ${feeTokenSymbol} balance available.`,
    };
  }

  throw new Error('Insufficient balance to pay relay fees.');
}
