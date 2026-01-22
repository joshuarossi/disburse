import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useSignMessage } from 'wagmi';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const signInAttemptedRef = useRef(false);
  
  const generateNonce = useMutation(api.auth.generateNonce);
  const verifySignature = useMutation(api.auth.verifySignature);
  const session = useQuery(
    api.auth.getSession, 
    address ? { walletAddress: address } : 'skip'
  );

  // If already authenticated, redirect to select-org
  useEffect(() => {
    if (session) {
      navigate('/select-org');
    }
  }, [session, navigate]);

  // When wallet connects, start SIWE flow (with guard against double-execution)
  useEffect(() => {
    if (isConnected && address && !session && !isSigningIn && !signInAttemptedRef.current) {
      signInAttemptedRef.current = true;
      handleSignIn();
    }
  }, [isConnected, address, session, isSigningIn]);

  // Reset the sign-in attempt flag when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      signInAttemptedRef.current = false;
    }
  }, [isConnected]);

  const handleSignIn = async () => {
    if (!address || isSigningIn) return;
    setIsSigningIn(true);

    try {
      // Generate nonce
      const { nonce } = await generateNonce({ walletAddress: address });

      // Create SIWE message
      const message = `Sign in to Disburse\n\nThis request will not trigger a blockchain transaction or cost any gas fees.\n\nWallet: ${address}\nNonce: ${nonce}`;

      // Sign message
      const signature = await signMessageAsync({ message });

      // Verify with backend
      await verifySignature({
        walletAddress: address,
        signature,
        message,
      });

      // Session query will update and trigger redirect
    } catch (error) {
      console.error('Sign in failed:', error);
      // Reset the attempt flag so user can retry
      signInAttemptedRef.current = false;
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-6">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/10 blur-[120px]" />
      </div>

      <div className="w-full max-w-sm">
        {/* Back link */}
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-8">
          {/* Logo */}
          <div className="mb-8 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-400">
              <svg
                className="h-6 w-6 text-navy-950"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>

          <h1 className="mb-2 text-center text-2xl font-bold text-white">
            Welcome to Disburse
          </h1>
          <p className="mb-8 text-center text-slate-400">
            Connect your wallet to get started
          </p>

          {/* RainbowKit Connect Button */}
          <div className="flex justify-center">
            <ConnectButton.Custom>
              {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                mounted,
              }) => {
                const ready = mounted;
                const connected = ready && account && chain;

                return (
                  <div
                    {...(!ready && {
                      'aria-hidden': true,
                      style: {
                        opacity: 0,
                        pointerEvents: 'none',
                        userSelect: 'none',
                      },
                    })}
                  >
                    {(() => {
                      if (!connected) {
                        return (
                          <Button onClick={openConnectModal} size="lg" className="w-full">
                            Connect Wallet
                          </Button>
                        );
                      }

                      if (chain.unsupported) {
                        return (
                          <Button onClick={openChainModal} variant="secondary" size="lg">
                            Wrong network
                          </Button>
                        );
                      }

                      return (
                        <div className="flex flex-col gap-3">
                          <Button onClick={openAccountModal} variant="secondary" size="lg">
                            {account.displayName}
                          </Button>
                          <p className="text-center text-sm text-slate-400">
                            Signing you in...
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                );
              }}
            </ConnectButton.Custom>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            By connecting, you agree to our{' '}
            <a href="#" className="text-accent-400 hover:underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="#" className="text-accent-400 hover:underline">
              Privacy Policy
            </a>
          </p>
        </div>

        {/* Info */}
        <p className="mt-8 text-center text-sm text-slate-500">
          New to Web3?{' '}
          <a href="#" className="text-accent-400 hover:underline">
            Learn how to set up a wallet
          </a>
        </p>
      </div>
    </div>
  );
}
