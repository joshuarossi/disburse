import { expect, it } from 'vitest';
import { ConvexError } from 'convex/values';
import { userErrorMessage } from '../userErrors';

it('preserves actionable validation from a Convex envelope without its request id or stack', () => {
  const error = new Error('[CONVEX M(receivables:create)] [Request ID: abc123] Server Error\nUncaught Error: Invoice number already exists. Choose another number.\n    at handler (../convex/receivables.ts:101:2)\nCalled by client');
  expect(userErrorMessage(error, 'Could not save invoice.')).toBe('Invoice number already exists. Choose another number.');
});
it('preserves structured application errors without changing payment state', () => {
  expect(userErrorMessage(new ConvexError({ code: 'DUPLICATE', message: 'This recipient already exists.' }), 'Fallback')).toBe('This recipient already exists.');
  expect(userErrorMessage({ code: 4001 }, 'Could not save your approval.')).toBe('Could not save your approval.');
});
it.each([undefined, null, 42, {}, { message: {} }, new Error('HTTP request failed.'), new Error('Failed to fetch'), new Error('TypeError: Cannot read properties of null'), new Error('RPC request to https://rpc.example/api-key'), new Error(`Call data 0x${'aa'.repeat(80)}`), new Error('message\nwith a stack'), new Error('x'.repeat(1000)), { get message() { throw new Error('getter failed'); } }])('provides a short fallback for unknown or technical errors', error => {
  expect(userErrorMessage(error, 'Your changes could not be saved. Try again.')).toBe('Your changes could not be saved. Try again.');
});
it('does not unwrap arbitrary provider text that resembles an application error', () => {
  expect(userErrorMessage(new Error('Uncaught Error: raw RPC trace'), 'Fallback')).toBe('Fallback');
});
