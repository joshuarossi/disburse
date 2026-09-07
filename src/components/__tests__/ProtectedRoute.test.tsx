import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute } from '../ProtectedRoute';
const state = vi.hoisted(() => ({
  account: { address: '0xabc', isConnecting: false, isReconnecting: false },
  session: undefined as unknown,
  orgs: undefined as unknown,
  token: 'session' as string | null,
  clear: vi.fn(),
}));
vi.mock('wagmi', () => ({ useAccount: () => state.account }));
vi.mock('@/lib/session', () => ({
  useSessionToken: () => state.token,
  clearSessionToken: state.clear,
}));
vi.mock('convex/react', () => ({
  useQuery: (_query: unknown, args: unknown) =>
    args && typeof args === 'object' && 'token' in args
      ? state.session
      : state.orgs,
}));
function LoginTarget() {
  const location = useLocation();
  return <p>Login: {location.state?.returnTo}</p>;
}
function mount() {
  return render(
    <MemoryRouter initialEntries={['/org/acme/payments?tab=recurring']}>
      <Routes>
        <Route
          path="/org/:orgId/payments"
          element={
            <ProtectedRoute requireOrg>
              <p>Finance workspace</p>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<LoginTarget />} />
        <Route path="/select-org" element={<p>Choose organization</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  state.account = {
    address: '0xabc',
    isConnecting: false,
    isReconnecting: false,
  };
  state.token = 'session';
  state.session = undefined;
  state.orgs = undefined;
  state.clear.mockClear();
});
describe('protected finance routes', () => {
  it('waits for session validation before showing private content', () => {
    mount();
    expect(screen.queryByText('Finance workspace')).not.toBeInTheDocument();
    expect(screen.queryByText(/Login:/)).not.toBeInTheDocument();
  });
  it('preserves the requested path when signing in is required', () => {
    state.token = null;
    mount();
    expect(
      screen.getByText('Login: /org/acme/payments?tab=recurring'),
    ).toBeInTheDocument();
  });
  it('rejects a session issued to a different wallet', () => {
    state.session = { walletAddress: '0xdef' };
    mount();
    expect(screen.getByText(/Login:/)).toBeInTheDocument();
    expect(state.clear).toHaveBeenCalled();
  });
  it('keeps the session during wallet reconnection', () => {
    state.account.isReconnecting = true;
    state.account.address = '';
    mount();
    expect(state.clear).not.toHaveBeenCalled();
    expect(screen.queryByText(/Login:/)).not.toBeInTheDocument();
  });
  it('requires active membership in the requested organization', () => {
    state.session = { walletAddress: '0xabc' };
    state.orgs = [{ _id: 'acme', membershipStatus: 'invited' }];
    mount();
    expect(screen.getByText('Choose organization')).toBeInTheDocument();
  });
  it('renders content for a matching wallet and active membership', () => {
    state.session = { walletAddress: '0xABC' };
    state.orgs = [{ _id: 'acme', membershipStatus: 'active' }];
    mount();
    expect(screen.getByText('Finance workspace')).toBeInTheDocument();
  });
});
