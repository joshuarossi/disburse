import { ReactNode, useEffect } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { PageLoading } from './PageLoading';
import { useSessionToken, clearSessionToken } from '@/lib/session';

interface ProtectedRouteProps {
  children: ReactNode;
  requireOrg?: boolean;
}

export function ProtectedRoute({
  children,
  requireOrg = false,
}: ProtectedRouteProps) {
  const { address, isConnecting, isReconnecting } = useAccount();
  const { orgId } = useParams<{ orgId: string }>();
  const location = useLocation();
  const token = useSessionToken();
  const connecting = isConnecting || isReconnecting;
  const session = useQuery(
    api.auth.validateSession,
    address && token ? { token } : 'skip',
  );
  const matchesWallet =
    !!session && session.walletAddress.toLowerCase() === address?.toLowerCase();
  const orgs = useQuery(
    api.orgs.listForUser,
    requireOrg && token && matchesWallet ? { sessionToken: token } : 'skip',
  );

  useEffect(() => {
    if (connecting) return;
    if (!address || session === null || (session && !matchesWallet))
      clearSessionToken();
  }, [address, connecting, session, matchesWallet]);

  if (connecting) return <PageLoading />;
  if (!address || !token || session === null || (session && !matchesWallet)) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          returnTo: location.pathname + location.search + location.hash,
        }}
      />
    );
  }
  if (session === undefined) return <PageLoading />;
  if (requireOrg) {
    if (orgs === undefined) return <PageLoading />;
    if (
      !orgId ||
      !orgs.some(
        (org) => org?._id === orgId && org.membershipStatus === 'active',
      )
    ) {
      return <Navigate to="/select-org" replace />;
    }
  }
  return <>{children}</>;
}

/**
 * Wrapper for routes that require authentication
 */
export function AuthRequired({ children }: { children: ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

/**
 * Wrapper for routes that require org membership
 */
export function OrgRequired({ children }: { children: ReactNode }) {
  return <ProtectedRoute requireOrg>{children}</ProtectedRoute>;
}
