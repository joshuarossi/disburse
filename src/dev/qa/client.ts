const disabled = async () => {
  throw new Error('Network operations are disabled in visual QA mode.');
};
export const convex = {
  query: async (...args: Parameters<typeof readQueryFixture>) => sessionStorage.getItem('qa:scenario')?.startsWith('nested-') ? readQueryFixture(...args) : disabled(),
  mutation: disabled,
  action: async (reference: Parameters<typeof getFunctionName>[0]) => {
    if (sessionStorage.getItem('qa:scenario') === 'nested-partial') {
      if (getFunctionName(reference) === 'paymentExecution:verifyProposal') return;
      if (getFunctionName(reference) === 'accountApprovals:forSigning') return { proposal: { safeTxHash: `0x${'ab'.repeat(32)}` }, paths: [{ path: [safes[0].safeAddress, '0x9999999999999999999999999999999999999999'], labels: ['Payroll', 'Treasury'], approved: false }] };
    }
    return disabled();
  },
};
import { getFunctionName } from 'convex/server';
import { readQueryFixture } from './convex';
import { safes } from './fixtures';
