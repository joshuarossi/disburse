import { readAllowanceState } from "../../shared/allowance";
import { getReadOnlyChainClient } from "./readOnlyChain";
export {
  ALLOWANCE_PERIODS,
  allowanceAbi,
  safeModuleAbi,
  buildAllowanceGrant,
  buildAllowanceRevocation,
  getAllowanceDeployments,
} from "../../shared/allowance";
export type {
  AllowanceSnapshot,
  AllowanceDeployment,
  OnchainAllowance,
} from "../../shared/allowance";

export async function readAllowanceSnapshot(
  chainId: number,
  safeAddress: string,
  moduleAddress: string,
  onlyDelegate?: string,
) {
  return readAllowanceState(
    getReadOnlyChainClient(chainId),
    chainId,
    safeAddress,
    moduleAddress,
    onlyDelegate,
  );
}
