export const BOOK_CURRENCIES = { USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, JPY: 0 } as const;
export type BookCurrency = keyof typeof BOOK_CURRENCIES;
export type AccountingTreatment = 'existing_payable' | 'existing_receivable' | 'expense' | 'customer_advance' | 'customer_refund' | 'credit_note' | 'internal_transfer' | 'investment_deposit' | 'investment_withdrawal' | 'currency_conversion' | 'fee' | 'already_recorded';
export const accountingTreatments: Record<AccountingTreatment, string> = {
  existing_payable: 'Settle a bill already in the books',
  existing_receivable: 'Collect an invoice already in the books',
  expense: 'Record an expense not yet in the books',
  customer_advance: 'Customer advance or unapplied receipt',
  customer_refund: 'Refund a recorded customer liability',
  credit_note: 'Record an issued customer credit note',
  internal_transfer: 'Transfer between company accounts',
  currency_conversion: 'Exchange currencies through conversion clearing',
  investment_deposit: 'Move cash into a lending position',
  investment_withdrawal: 'Withdraw from a lending position',
  fee: 'Payment or provider fee',
  already_recorded: 'Match a transaction already in the books',
};
export type AccountKind = 'asset' | 'payable' | 'receivable' | 'liability' | 'equity' | 'income' | 'expense';
export type BookAccount = { id: string; externalId: string; name: string; kind: AccountKind; version: number };
export type JournalLine = { account: BookAccount; debit: string; credit: string; name?: string };

/** Quantities and book values use different scales. Never round user input. */
export function bookUnits(value: string, currency: BookCurrency, allowZero = false) {
  const precision = BOOK_CURRENCIES[currency];
  if (precision === undefined || !/^\d{1,24}(\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > precision)
    throw new Error(`Enter a book value with up to ${precision ?? 2} decimal places in ${currency}`);
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0') || '0');
  if (!allowZero && units <= 0n) throw new Error('Book values must be positive');
  return units;
}
export function formatBookUnits(value: bigint, currency: BookCurrency) {
  const precision = BOOK_CURRENCIES[currency], sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(precision + 1, '0');
  return sign + (precision ? digits.slice(0, -precision) + '.' + digits.slice(-precision) : digits);
}
export function assertPostingDate(date: string, closedThrough?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new Error('Choose a valid accounting date');
  if (closedThrough && date <= closedThrough) throw new Error(`The books are closed through ${closedThrough}. Use an open accounting date.`);
}
export function buildSettlementJournal(input: {
  treatment: Exclude<AccountingTreatment, 'already_recorded'>; direction: 'inflow' | 'outflow' | 'noncash'; currency: BookCurrency;
  assetBookValue: string; obligationBookValue?: string;
  assetAccount: BookAccount; counterAccount: BookAccount; differenceAccount?: BookAccount; externalName?: string;
  companyTransfer: boolean;
  nonCash?: 'credit_note'; customerRefund?: boolean;
  lendingMovement?: 'supply' | 'withdraw';
  conversionMovement?: 'inflow' | 'outflow';
  receiptHasExcess?: boolean; advanceBookValue?: string; advanceAccount?: BookAccount;
  deliveryFeeRequired?: boolean; deliveryFeeBookValue?: string; deliveryFeeAccount?: BookAccount;
}): JournalLine[] {
  const { treatment, direction, currency, assetAccount, counterAccount, differenceAccount } = input;
  if (input.nonCash || direction === 'noncash' || treatment === 'credit_note') {
    if(input.nonCash !== 'credit_note' || direction !== 'noncash' || treatment !== 'credit_note')throw new Error('The accounting treatment must match the issued credit note.');
    if(!['income','expense'].includes(assetAccount.kind) || counterAccount.kind !== 'receivable')throw new Error('Choose a sales returns or adjustment account and the customer receivable account.');
    if(!input.externalName?.trim())throw new Error('Enter the exact customer name used in the books.');
    const total=bookUnits(input.assetBookValue,currency), receivable=bookUnits(input.obligationBookValue ?? '',currency,true);
    if(receivable > total)throw new Error('The receivable reduction cannot exceed the reviewed credit value.');
    const liability=total-receivable;
    if(liability && input.advanceAccount?.kind !== 'liability')throw new Error('Choose a customer liability account for the credit available for refund.');
    const line=(account:BookAccount, debit:bigint, credit:bigint):JournalLine=>({account,debit:debit?formatBookUnits(debit,currency):'',credit:credit?formatBookUnits(credit,currency):'',name:input.externalName?.trim()});
    return [line(assetAccount,total,0n),...(receivable?[line(counterAccount,0n,receivable)]:[]),...(liability?[line(input.advanceAccount!,0n,liability)]:[])];
  }
  if(input.customerRefund ? treatment !== 'customer_refund' : treatment === 'customer_refund')throw new Error('The accounting treatment must match a verified customer refund.');
  if (assetAccount.kind !== 'asset') throw new Error('Choose an asset account for the settled currency holding');
  if (assetAccount.id === counterAccount.id) throw new Error('Choose different accounts for the two sides of the journal');
  if (input.companyTransfer && treatment !== 'internal_transfer') throw new Error('A transfer between company accounts must not be posted as income, an expense or a customer collection');
  if (input.conversionMovement ? treatment !== 'currency_conversion' || direction !== input.conversionMovement : treatment === 'currency_conversion')
    throw new Error('The accounting treatment must match a verified currency conversion');
  const investment = treatment === 'investment_deposit' || treatment === 'investment_withdrawal';
  if (input.lendingMovement ? treatment !== (input.lendingMovement === 'supply' ? 'investment_deposit' : 'investment_withdrawal') : investment)
    throw new Error('The accounting treatment must match the verified lending movement');
  if (treatment === 'internal_transfer' && !input.companyTransfer) throw new Error('The other address has not been identified as a company account');
  const out = ['existing_payable', 'expense', 'fee', 'investment_deposit', 'customer_refund'];
  const incoming = ['existing_receivable', 'customer_advance', 'investment_withdrawal'];
  if ((out.includes(treatment) && direction !== 'outflow') || (incoming.includes(treatment) && direction !== 'inflow'))
    throw new Error('The accounting treatment does not match the settled direction');
  const kind: Record<Exclude<AccountingTreatment, 'already_recorded'>, AccountKind[]> = {
    existing_payable: ['payable'], existing_receivable: ['receivable'], expense: ['expense'],
    customer_advance: ['liability'], internal_transfer: ['asset'], fee: ['expense'],
    investment_deposit: ['asset'], investment_withdrawal: ['asset'], currency_conversion: ['asset'],
    customer_refund: ['liability'], credit_note: ['receivable'],
  };
  if (!kind[treatment].includes(counterAccount.kind)) throw new Error('The selected offset account does not match this accounting treatment');
  const obligation = treatment === 'existing_payable' || treatment === 'existing_receivable' || treatment === 'customer_refund';
  if (obligation && !input.externalName?.trim()) throw new Error('Enter the exact vendor or customer name used in the books');
  const assetValue = bookUnits(input.assetBookValue, currency);
  const settledValue = obligation || treatment === 'investment_withdrawal' || treatment === 'currency_conversion' && direction === 'inflow' ? bookUnits(input.obligationBookValue ?? '', currency, treatment === 'investment_withdrawal') : assetValue;
  const hasAdvance = treatment === 'existing_receivable' && input.receiptHasExcess;
  const hasDeliveryFee = treatment === 'internal_transfer' && direction === 'inflow' && input.deliveryFeeRequired;
  const deliveryFee = hasDeliveryFee ? bookUnits(input.deliveryFeeBookValue ?? '', currency, true) : 0n;
  if (hasDeliveryFee && input.deliveryFeeAccount?.kind !== 'expense') throw new Error('Choose an expense account for the delivery fee retained by the transfer provider');
  const advanceValue = hasAdvance ? bookUnits(input.advanceBookValue ?? '', currency) : 0n;
  if (hasAdvance && input.advanceAccount?.kind !== 'liability')
    throw new Error('Choose a customer liability account for the excess receipt');
  const line = (account: BookAccount, signedDebit: bigint, name?: string): JournalLine => ({
    account, debit: signedDebit > 0n ? formatBookUnits(signedDebit, currency) : '',
    credit: signedDebit < 0n ? formatBookUnits(-signedDebit, currency) : '', name,
  });
  const assetDebit = direction === 'inflow' ? assetValue : -assetValue;
  const offsetDebit = direction === 'outflow' ? settledValue : -settledValue - deliveryFee;
  const lines = [line(assetAccount, assetDebit), line(counterAccount, offsetDebit, obligation ? input.externalName?.trim() : undefined)];
  if (hasAdvance) lines.push(line(input.advanceAccount!, -advanceValue, input.externalName?.trim()));
  if (deliveryFee) lines.push(line(input.deliveryFeeAccount!, deliveryFee));
  const differenceDebit = -assetDebit - offsetDebit + advanceValue - deliveryFee;
  if (differenceDebit) {
    if (!differenceAccount || differenceAccount.kind !== (differenceDebit > 0n ? 'expense' : 'income'))
      throw new Error(`Choose a reviewed ${differenceDebit > 0n ? 'loss / expense' : 'gain / income'} account for the valuation difference`);
    if ([assetAccount.id, counterAccount.id].includes(differenceAccount.id)) throw new Error('The valuation difference needs its own account');
    lines.push(line(differenceAccount, differenceDebit));
  }
  return lines.filter(line => line.debit || line.credit);
}
