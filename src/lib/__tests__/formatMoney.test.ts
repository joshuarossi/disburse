import { describe, expect, it } from 'vitest';
import { formatMoney, formatAssetAmount } from '../formatMoney';
describe('finance amount presentation', () => {
  it('does not label native asset quantities as dollars or round away their precision', () => {
    expect(formatAssetAmount('0.030000000000000001', 'ETH')).toBe('0.030000000000000001');
    expect(formatAssetAmount('-1.123456789', 'CUSTOM')).toBe('-1.123456789');
    expect(formatAssetAmount('0.010001', 'USDC')).toBe('$0.010001');
  });
  it('preserves a large exact amount in payment details', () => {
    expect(formatMoney('9007199254740993.000001', 'USDC', true)).toBe(
      '$9,007,199,254,740,993.000001',
    );
  });
  it('shows small amounts in detailed review and rounds overview amounts once', () => {
    expect(formatMoney('0.000001', 'USDC', true)).toBe('$0.000001');
    expect(formatMoney('999.995', 'USDC')).toBe('$1,000.00');
    expect(formatMoney('12.5', 'EURC', true)).toBe('€12.50');
  });
  it('shows unavailable data explicitly', () => {
    expect(formatMoney('NaN')).toBe('Unavailable');
  });
});
