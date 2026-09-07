import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { Doc } from '../../../../convex/_generated/dataModel';
import { DelegatedPayment } from '../DelegatedPayment';

const mock = vi.hoisted(() => ({
  address: '0x1111111111111111111111111111111111111111',
  quote: vi.fn(), prepare: vi.fn(), sign: vi.fn(), switchChain: vi.fn(), start: vi.fn(), send: vi.fn(), record: vi.fn(), rejected: vi.fn(),
}));
vi.mock('convex/react', () => ({ useMutation: () => mock.rejected, useAction: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref).endsWith(':quote') ? mock.quote : getFunctionName(ref) === 'delegatedNative:start' ? mock.start : getFunctionName(ref).endsWith(':recordSubmission') ? mock.record : mock.prepare }));
vi.mock('@/lib/accountApproval', () => ({ sendApprovedAccountPayment: (...args: unknown[]) => mock.send(...args) }));
vi.mock('wagmi', () => ({ useAccount: () => ({ address: mock.address, chainId: 11155111 }), useSwitchChain: () => ({ switchChainAsync: mock.switchChain }) }));
vi.mock('@/lib/session', () => ({ useSessionToken: () => 'test-session' }));
vi.mock('@/lib/delegatedTransfer', () => ({ signAllowanceAuthorization: (...args: unknown[]) => mock.sign(...args) }));
const payment = { _id: 'payment1', chainId: 11155111, status: 'draft', token: 'USDC', totalAmount: '30', updatedAt: 1 } as Doc<'disbursements'>;
const props = { payment, blocked: false, onBusyChange: vi.fn(), onModeChange: vi.fn(), onFeeModeChange: vi.fn() };
async function review() {
  fireEvent.click(screen.getByText('Pay with a spending allowance'));
  fireEvent.click(screen.getByRole('button', { name: 'Check my allowance' }));
  await screen.findByRole('checkbox');
  fireEvent.click(screen.getByRole('checkbox'));
}
beforeEach(() => {
  mock.address = '0x1111111111111111111111111111111111111111';
  mock.quote.mockResolvedValue({ hash: 'recipient-one', additionalTransfers: [{ hash: 'recipient-two', recipientAddress: 'recipient2', amount: '20' }], feeHash: 'fee', fee: { amount: '0.05', token: 'USDC' }, available: '100000000', delegate: mock.address, chainId: 11155111 });
  mock.sign.mockImplementation(async (_chain, _delegate, hash) => 'signature:' + hash);
  mock.prepare.mockResolvedValue({ feeAuthorization: { token: 'USDC' } });
  mock.start.mockResolvedValue({ to: '0xmodule', data: '0xcall', attemptId: 'wallet1' }); mock.send.mockResolvedValue('0xreceipt'); mock.record.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('delegated payment signing story', () => {
  it('links a reserved authorization back to its original payment before asking for signatures', async () => {
    mock.quote.mockRejectedValue(new ConvexError({ code: 'ALLOWANCE_AUTHORIZATION_RESERVED', message: 'An earlier payment still holds this authorization.', disbursementId: 'original-payment' }));
    render(<DelegatedPayment {...props} payment={{ ...payment, orgId: 'org1' } as Doc<'disbursements'>} />);
    fireEvent.click(screen.getByText('Pay with a spending allowance'));
    fireEvent.click(screen.getByRole('button', { name: 'Check my allowance' }));
    const link = await screen.findByRole('link', { name: 'Open the original payment' });
    expect(link).toHaveAttribute('href', '/org/org1/disbursements?focus=original-payment');
    expect(mock.sign).not.toHaveBeenCalled();
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it('collects every recipient authorization and the fee before submitting once', async () => {
    render(<DelegatedPayment {...props} />);
    await review();
    fireEvent.click(screen.getByRole('button', { name: 'Pay using allowance' }));
    await waitFor(() => expect(mock.prepare).toHaveBeenCalledTimes(1));
    expect(mock.sign.mock.calls.map(call => call[2])).toEqual(['recipient-one', 'recipient-two', 'fee']);
    expect(mock.prepare).toHaveBeenCalledWith(expect.objectContaining({ signature: 'signature:recipient-one', additionalSignatures: ['signature:recipient-two'], feeSignature: 'signature:fee' }));
    await screen.findByText(/Payment submitted/);
  });
  it('does not submit or request the fee signature when a recipient signature is rejected', async () => {
    mock.sign.mockResolvedValueOnce('first-signature').mockRejectedValueOnce({ cause: { code: 4001 } });
    render(<DelegatedPayment {...props} />);
    await review();
    fireEvent.click(screen.getByRole('button', { name: 'Pay using allowance' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Wallet confirmation cancelled');
    expect(mock.sign).toHaveBeenCalledTimes(2);
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pay using allowance' })).toBeEnabled();
  });
  it('invalidates the quote when the payment changes', async () => {
    const view = render(<DelegatedPayment {...props} />);
    await review();
    view.rerender(<DelegatedPayment {...props} payment={{ ...payment, updatedAt: 2 }} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pay using allowance' })).toBeNull();
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it('stops before submission if the connected member changes during signing', async () => {
    let finish!: (signature: string) => void;
    mock.sign.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const view = render(<DelegatedPayment {...props} />);
    await review();
    fireEvent.click(screen.getByRole('button', { name: 'Pay using allowance' }));
    await waitFor(() => expect(mock.sign).toHaveBeenCalledTimes(1));
    mock.address = '0x2222222222222222222222222222222222222222';
    view.rerender(<DelegatedPayment {...props} />);
    finish('old-member-signature');
    await screen.findByRole('alert');
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.sign).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

it('can reconcile an existing receipt even when new payments are blocked', async () => {
  const saved = { ...payment, allowanceExecution: { delegate: mock.address }, txHash: '0xreceipt', status: 'relaying' } as Doc<'disbursements'>;
  render(<DelegatedPayment {...props} payment={saved} blocked />);
  fireEvent.click(screen.getByRole('button', { name: 'Link receipt' }));
  await screen.findByText('Receipt linked. Settlement is being verified.');
  expect(mock.record).toHaveBeenCalledWith({ disbursementId: payment._id, sessionToken: 'test-session', txHash: '0xreceipt' });
  expect(mock.sign).not.toHaveBeenCalled();
});

it('wallet-paid allowance sends only recipient authorizations and records a declined attempt', async () => {
  mock.quote.mockResolvedValue({ hash: 'recipient-one', additionalTransfers: [], available: '100000000', delegate: mock.address, chainId: 11155111 });
  mock.prepare.mockResolvedValue({});
  mock.send.mockRejectedValue(Object.assign(new Error('User rejected request'), { code: 4001 }));
  render(<DelegatedPayment {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Execution fee' }), { target: { value: 'wallet' } });
  await review();
  expect(screen.getByText(/1 signature to authorize/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Pay using allowance' }));
  await screen.findByText(/original allowance authorization is saved/);
  expect(mock.sign.mock.calls.map(call => call[2])).toEqual(['recipient-one']);
  expect(mock.prepare).toHaveBeenCalledWith(expect.objectContaining({ feeMode: 'wallet', feeHash: undefined, feeSignature: undefined }));
  expect(mock.rejected).toHaveBeenCalledWith({ disbursementId: payment._id, sessionToken: 'test-session', attemptId: 'wallet1' });
  expect(mock.record).not.toHaveBeenCalled();
});
