import { concatHex, encodeAbiParameters, hashMessage, keccak256, padHex, stringToHex, toHex, type Address, type Hex } from 'viem';
import { recoverAddress } from './signatures';
import type { PreparedOwnerProposal } from './ownerProposal';

export type SafeTransactionData = PreparedOwnerProposal['safeTransactionData'];
export type AccountSignature = { owner: string; signature: string; isContractSignature?: boolean };
export const safeTransactionTypes = { SafeTx: [
  { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
  { name: 'operation', type: 'uint8' }, { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' }, { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
] } as const;
export const safeMessageTypes = { SafeMessage: [{ name: 'message', type: 'bytes' }] } as const;
const domainType = keccak256(stringToHex('EIP712Domain(uint256 chainId,address verifyingContract)'));
const transactionType = keccak256(stringToHex('SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)'));
const messageType = keccak256(stringToHex('SafeMessage(bytes message)'));
function envelope(chainId: number, account: string, structHash: Hex) {
  const domain = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [domainType, BigInt(chainId), account as Address]));
  return concatHex(['0x1901', domain, structHash]);
}
/** Exact preimage passed by Safe 1.3/1.4 to its owners' EIP-1271 validators. */
export function transactionSigningData(chainId: number, account: string, tx: SafeTransactionData) {
  return envelope(chainId, account, keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint8' },
    { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' },
  ], [transactionType, tx.to as Address, BigInt(tx.value), keccak256(tx.data as Hex), tx.operation, BigInt(tx.safeTxGas), BigInt(tx.baseGas), BigInt(tx.gasPrice), tx.gasToken as Address, tx.refundReceiver as Address, BigInt(tx.nonce)])));
}
export function messageSigningData(chainId: number, account: string, message: Hex) {
  return envelope(chainId, account, keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [messageType, keccak256(message)])));
}
/** Path contains the paying account, then each owning account up to the human signer. */
export function approvalSigningData(chainId: number, path: string[], tx: SafeTransactionData) {
  if (!path.length || path.length > 4) throw new Error('Unsupported approval path');
  return nestedSigningData(chainId, path, transactionSigningData(chainId, path[0], tx));
}
/** Wrap the exact root preimage for each owning Safe. SafeOp approvals use a
 * different root preimage from SafeTx approvals; their signatures are never interchangeable. */
export function nestedSigningData(chainId: number, path: string[], rootData: Hex) {
  if (!path.length || path.length > 4) throw new Error('Unsupported approval path');
  let data = rootData;
  let message = data;
  for (const account of path.slice(1)) {
    message = data;
    data = messageSigningData(chainId, account, message);
  }
  return { data, hash: keccak256(data), message };
}
export async function recoverSafeSigner(hash: Hex, signature: string) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Invalid account approval signature');
  const v = parseInt(signature.slice(-2), 16);
  if (![27, 28, 31, 32].includes(v)) throw new Error('Unsupported account approval signature');
  return (await recoverAddress({ hash: v > 30 ? hashMessage({ raw: hash }) : hash, signature: (v > 30 ? signature.slice(0, -2) + (v - 4).toString(16) : signature) as Hex })).toLowerCase();
}
/** Recalculate dynamic offsets after sorting. Concatenating contract signatures is invalid. */
export function packSafeSignatures(signatures: AccountSignature[]): Hex {
  const sorted = [...signatures].sort((a, b) => a.owner.toLowerCase() < b.owner.toLowerCase() ? -1 : 1);
  if (sorted.length > 50 || new Set(sorted.map(s => s.owner.toLowerCase())).size !== sorted.length) throw new Error('Invalid or duplicate account approvals');
  const fixed: Hex[] = [], dynamic: Hex[] = [];
  let offset = sorted.length * 65;
  for (const s of sorted) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(s.owner) || !/^0x(?:[0-9a-fA-F]{2})+$/.test(s.signature) || s.signature.length > 65538) throw new Error('Invalid account signature encoding');
    if (s.isContractSignature) {
      const size = (s.signature.length - 2) / 2;
      fixed.push(concatHex([padHex(s.owner as Hex, { size: 32 }), toHex(offset, { size: 32 }), '0x00']));
      dynamic.push(concatHex([toHex(size, { size: 32 }), s.signature as Hex]));
      offset += 32 + size;
    } else {
      if (s.signature.length !== 132 || ![27, 28, 31, 32].includes(parseInt(s.signature.slice(-2), 16))) throw new Error('Invalid human approval signature');
      fixed.push(s.signature as Hex);
    }
  }
  return concatHex([...fixed, ...dynamic]);
}
