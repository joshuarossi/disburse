import { ReactNode, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Loader2 } from 'lucide-react';
import { getSessionToken, clearSessionToken } from '@/lib/session';

interface ProtectedRouteProps {
  children: ReactNode;
  requireOrg?: boolean;
}

export function ProtectedRoute({ children, requireOrg = false }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const { address, isConnecting } = useAccount();
  const { orgId } = useParams<{ orgId: string }>();
  const token = getSessionToken();

  // Check for valid session (identity resolved server-side from the token)
  const session = useQuery(
    api.auth.validateSession,
    address && token ? { token } : 'skip'
  );

  // Check org membership if required (token-based identity)
  const orgs = useQuery(
    api.orgs.listForUser,
    address && token ? { sessionToken: token } : 'skip'
  );

  // Clear the stored token when the wallet disconnects
  useEffect(() => {
    if (!isConnecting && !address) {
      clearSessionToken();
    }
  }, [address, isConnecting]);

  // Redirect to login if not connected or no session
  useEffect(() => {
    if (isConnecting) return;

    if (!address) {
      navigate('/login');
      return;
    }

    if (!token) {
      navigate('/login');
      return;
    }

    // Session query is loading
    if (session === undefined) return;

    // No valid session
    if (session === null) {
      clearSessionToken();
      navigate('/login');
      return;
    }
  }, [address, isConnecting, token, session, navigate]);

  // Check org access if requireOrg is true (active memberships only)
  useEffect(() => {
    if (!requireOrg || !orgId || orgs === undefined) return;

    // Check if user is an ACTIVE member of this org
    const isActiveMember = orgs?.some(
      (org) => org?._id === orgId && org?.membershipStatus === 'active'
    );

    if (orgs !== undefined && !isActiveMember) {
      navigate('/select-org');
    }
  }, [requireOrg, orgId, orgs, navigate]);

  // Show loading state while checking auth
  if (isConnecting || session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-950">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent-400" />
          <p className="mt-4 text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  // No address, token, or session means not authenticated
  if (!address || !token || !session) {
    return null;
  }

  // If requireOrg, check org access
  if (requireOrg && orgId) {
    const isActiveMember = orgs?.some(
      (org) => org?._id === orgId && org?.membershipStatus === 'active'
    );
    if (orgs === undefined) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-navy-950">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent-400" />
            <p className="mt-4 text-slate-400">Verifying access...</p>
          </div>
        </div>
      );
    }
    if (!isActiveMember) {
      return null;
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
