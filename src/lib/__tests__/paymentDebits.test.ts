import { describe, expect, it } from 'vitest';
import { paymentDebits } from '../../../shared/executionFee';
const fee = { token: 'USDC', tokenAddress: '0x1', collector: '0x2', amount: '0.050001' };
describe('account debit totals', () => {
  it('adds the fee exactly, including values beyond floating point precision', () => {
    expect(paymentDebits('USDC', '9007199254.740993', fee)).toEqual([{ token: 'USDC', amount: '9007199254.790994' }]);
  });
  it('does not convert or sum unlike currencies', () => {
    expect(paymentDebits('USDT', '1000', fee)).toEqual([{ token: 'USDT', amount: '1000' }, { token: 'USDC', amount: '0.050001' }]);
  });
});
