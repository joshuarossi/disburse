import {
  concatHex,
  encodeAbiParameters,
  getCreate2Address,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
  encodeFunctionData,
} from "viem";
import { invoiceForwarderArtifact } from "./invoiceForwarderArtifact";
export const forwarderFactory =
  invoiceForwarderArtifact.InvoiceForwarderFactory;
export const RECEIVING_DEPLOYER = '0x4e59b44847b379578588920ca78fbf26c0b4956c' as const;
// The same immutable factory can be used by every organization. The first
// customer that needs it pays deployment; subsequent customers reuse it.
const receivingFactorySalt = keccak256(stringToHex('disburse-invoice-factory-v1'));
export const RECEIVING_FACTORY_ADDRESS = getCreate2Address({ from: RECEIVING_DEPLOYER, salt: receivingFactorySalt, bytecode: forwarderFactory.bytecode });
export function receivingFactoryCall() {
  return { to: RECEIVING_DEPLOYER, data: concatHex([receivingFactorySalt, forwarderFactory.bytecode]) };
}
export function invoiceSalt(
  orgId: string,
  invoiceId: string,
  chainId: number,
): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify(["disburse-invoice-v1", orgId, invoiceId, chainId]),
    ),
  );
}
export function invoiceAddress(
  factory: Address,
  treasury: Address,
  salt: Hex,
): Address {
  return getCreate2Address({
    from: factory,
    salt,
    bytecode: concatHex([
      invoiceForwarderArtifact.InvoiceForwarder.bytecode,
      encodeAbiParameters([{ type: "address" }], [treasury]),
    ]),
  });
}
export function sweepCall(invoice: {
  factory: string;
  treasury: string;
  salt: string;
  tokenAddress: string;
}) {
  return {
    to: invoice.factory as Address,
    data: encodeFunctionData({
      abi: forwarderFactory.abi,
      functionName: "deployAndSweep",
      args: [
        invoice.treasury as Address,
        invoice.salt as Hex,
        invoice.tokenAddress as Address,
      ],
    }),
  };
}
