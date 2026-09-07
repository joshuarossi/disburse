import { encodeFunctionData } from 'viem';
import { packSafeSignatures } from '../../shared/safeSignatures';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SAFE_EXEC_TX_ABI = [
  {
    type: 'function',
    name: 'execTransaction',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const;

interface SafeConfirmation {
  owner: string;
  signature: string;
  isContractSignature?: boolean;
}

interface SafeTxPayload {
  to: string;
  value?: string | number;
  data?: string;
  operation?: string | number;
  safeTxGas?: string | number;
  baseGas?: string | number;
  gasPrice?: string | number;
  gasToken?: string;
  refundReceiver?: string;
  confirmations?: SafeConfirmation[];
}

export function encodeExecTransaction(safeTx: SafeTxPayload): string {
  const signaturesHex = packSafeSignatures(safeTx.confirmations || []);

  const operation =
    typeof safeTx.operation === 'string'
      ? Number(safeTx.operation)
      : (safeTx.operation ?? 0);

  const dataHex = (safeTx.data || '0x') as `0x${string}`;
  const gasToken = (safeTx.gasToken || ZERO_ADDRESS) as `0x${string}`;
  const refundReceiver = (safeTx.refundReceiver ||
    ZERO_ADDRESS) as `0x${string}`;
  return encodeFunctionData({
    abi: SAFE_EXEC_TX_ABI,
    functionName: 'execTransaction',
    args: [
      safeTx.to as `0x${string}`,
      BigInt(safeTx.value ?? 0),
      dataHex,
      operation,
      BigInt(safeTx.safeTxGas ?? 0),
      BigInt(safeTx.baseGas ?? 0),
      BigInt(safeTx.gasPrice ?? 0),
      gasToken,
      refundReceiver,
      signaturesHex as `0x${string}`,
    ],
  });
}
