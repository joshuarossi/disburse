import { describe, expect, it } from 'vitest';
import { assertReceiptConfirmations } from '../../../shared/confirmations';
describe('payment confirmation depth', () => {
  it('keeps a newly mined or orphaned future receipt pending', () => {
    expect(() => assertReceiptConfirmations(100n, 100n)).toThrow('two network confirmations');
    expect(() => assertReceiptConfirmations(100n, 99n)).toThrow('two network confirmations');
  });
  it('permits settlement after the second confirmation', () => {
    expect(() => assertReceiptConfirmations(100n, 101n)).not.toThrow();
  });
});
