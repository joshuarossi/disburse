import { ReactNode, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requireOrg?: boolean;
}

export function ProtectedRoute({ children, requireOrg = false }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const { address, isConnecting } = useAccount();
  const { orgId } = useParams<{ orgId: string }>();

  // Check for valid session
  const session = useQuery(
    api.auth.getSession,
    address ? { walletAddress: address } : 'skip'
  );

  // Check org membership if required
  const orgs = useQuery(
    api.orgs.listForUser,
    address ? { walletAddress: address } : 'skip'
  );

  // Redirect to login if not connected or no session
  useEffect(() => {
    if (isConnecting) return;
    
    if (!address) {
      navigate('/login');
      return;
    }

    // Session query is loading
    if (session === undefined) return;

    // No valid session
    if (session === null) {
      navigate('/login');
      return;
    }
  }, [address, isConnecting, session, navigate]);

  // Check org access if requireOrg is true
  useEffect(() => {
    if (!requireOrg || !orgId || orgs === undefined) return;

    // Check if user is a member of this org
    const isMember = orgs?.some((org) => org?._id === orgId);
    
    if (orgs !== undefined && !isMember) {
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

  // No address or session means not authenticated
  if (!address || !session) {
    return null;
  }

  // If requireOrg, check org access
  if (requireOrg && orgId) {
    const isMember = orgs?.some((org) => org?._id === orgId);
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
    if (!isMember) {
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
