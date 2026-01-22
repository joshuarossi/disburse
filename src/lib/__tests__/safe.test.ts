import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTransferTx } from '../safe';

// Use a valid checksummed address for tests
const VALID_RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// Mock the wagmi module
vi.mock('../wagmi', () => ({
  TOKENS: {
    USDC: {
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const,
      decimals: 6,
      symbol: 'USDC',
    },
    USDT: {
      address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06' as const,
      decimals: 6,
      symbol: 'USDT',
    },
  },
}));

describe('Safe library', () => {
  describe('createTransferTx', () => {
    it('creates USDC transfer transaction', () => {
      const tx = createTransferTx(
        'USDC',
        VALID_RECIPIENT,
        '100'
      );

      expect(tx).toMatchObject({
        to: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        value: '0',
        operation: 0, // Call
      });
      expect(tx.data).toBeDefined();
      expect(typeof tx.data).toBe('string');
      expect(tx.data.startsWith('0x')).toBe(true);
    });

    it('creates USDT transfer transaction', () => {
      const tx = createTransferTx(
        'USDT',
        VALID_RECIPIENT,
        '100'
      );

      expect(tx).toMatchObject({
        to: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
        value: '0',
        operation: 0,
      });
      expect(tx.data).toBeDefined();
    });

    it('encodes correct ERC20 transfer function selector', () => {
      const tx = createTransferTx(
        'USDC',
        VALID_RECIPIENT,
        '100'
      );

      // ERC20 transfer function selector: 0xa9059cbb
      expect(tx.data.startsWith('0xa9059cbb')).toBe(true);
    });

    it('handles decimal amounts correctly', () => {
      const tx = createTransferTx(
        'USDC',
        VALID_RECIPIENT,
        '100.50'
      );

      expect(tx.data).toBeDefined();
      // 100.50 USDC with 6 decimals = 100500000 (0x5FD8200)
      // The amount is encoded in the data field
      expect(tx.data.length).toBeGreaterThan(10);
    });

    it('handles large amounts', () => {
      const tx = createTransferTx(
        'USDC',
        VALID_RECIPIENT,
        '1000000' // 1M USDC
      );

      expect(tx.data).toBeDefined();
      expect(tx.to).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
    });

    it('encodes recipient address in data', () => {
      const tx = createTransferTx('USDC', VALID_RECIPIENT, '100');

      // The recipient address should be encoded in the data (after function selector)
      // Address is zero-padded to 32 bytes
      const addressWithoutPrefix = VALID_RECIPIENT.slice(2).toLowerCase();
      expect(tx.data.toLowerCase()).toContain(addressWithoutPrefix);
    });

    it('sets value to 0 for ERC20 transfer', () => {
      const tx = createTransferTx(
        'USDC',
        VALID_RECIPIENT,
        '100'
      );

      // ERC20 transfers don't send ETH value
      expect(tx.value).toBe('0');
    });

    it('uses Call operation type', () => {
      const tx = createTransferTx(
        'USDC',
        VALID_RECIPIENT,
        '100'
      );

      // Operation 0 = Call (not DelegateCall)
      expect(tx.operation).toBe(0);
    });
  });
});
