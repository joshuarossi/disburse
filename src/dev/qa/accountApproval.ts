export async function signAccountApproval() {
  if (sessionStorage.getItem('qa:scenario')?.startsWith('account-fee-')) return '0x' + 'aa'.repeat(65);
  throw new Error('Visual QA mode is read-only. No account approval was signed.');
}
export const sendApprovedAccountPayment = signAccountApproval;
