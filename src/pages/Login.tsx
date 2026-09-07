import { useCallback, useEffect, useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useSignMessage } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import {
  useSessionToken,
  saveSessionToken,
  clearSessionToken,
} from '@/lib/session';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const signInAttemptedRef = useRef(false);
  const signingRef = useRef(false);
  const activeAddress = useRef(address);
  activeAddress.current = address;
  const [signInError, setSignInError] = useState<string | null>(null);
  const location = useLocation();
  const requestedPath = location.state?.returnTo;
  const returnTo =
    typeof requestedPath === 'string' &&
    requestedPath.startsWith('/') &&
    !requestedPath.startsWith('//')
      ? requestedPath
      : '/select-org';

  const generateNonce = useMutation(api.auth.generateNonce);
  const verifySignature = useMutation(api.auth.verifySignature);
  const existingToken = useSessionToken();
  const session = useQuery(
    api.auth.validateSession,
    existingToken ? { token: existingToken } : 'skip',
  );

  // If already authenticated with a valid token, redirect to select-org
  useEffect(() => {
    if (
      session &&
      session.walletAddress.toLowerCase() === address?.toLowerCase()
    ) {
      navigate(returnTo, { replace: true });
    }
  }, [session, address, navigate, returnTo]);

  const handleSignIn = useCallback(async () => {
    if (!address || signingRef.current) return;
    signingRef.current = true;
    signInAttemptedRef.current = true;
    setSignInError(null);
    setIsSigningIn(true);

    try {
      clearSessionToken();

      // Server builds the SIWE message and issues a single-use nonce
      const { message } = await generateNonce({ walletAddress: address });

      // User signs the server-authored message with their wallet
      const signature = await signMessageAsync({ message });

      // Backend cryptographically verifies the signature against the claimed
      // address, consumes the nonce, and returns a one-time opaque session token
      const result = await verifySignature({
        walletAddress: address,
        signature,
        message,
      });

      if (activeAddress.current !== address) return;
      saveSessionToken(result.token);

      // Redirect now that we hold a valid token
      navigate(returnTo, { replace: true });
    } catch (error) {
      console.error('Sign in failed:', error);
      clearSessionToken();
      setSignInError(
        t('auth.login.signInFailed', {
          defaultValue:
            'Sign-in was not completed. Try again when you are ready.',
        }),
      );
    } finally {
      signingRef.current = false;
      setIsSigningIn(false);
    }
  }, [
    address,
    navigate,
    returnTo,
    generateNonce,
    signMessageAsync,
    verifySignature,
    t,
  ]);

  // Reset the sign-in attempt flag when wallet disconnects
  useEffect(() => {
    signInAttemptedRef.current = false;
    setSignInError(null);
  }, [address]);

  // When wallet connects, start SIWE flow (with guard against double-execution)
  useEffect(() => {
    if (
      isConnected &&
      address &&
      (!existingToken || session !== undefined) &&
      (!session ||
        session.walletAddress.toLowerCase() !== address.toLowerCase()) &&
      !isSigningIn &&
      !signInAttemptedRef.current
    ) {
      signInAttemptedRef.current = true;
      handleSignIn();
    }
  }, [isConnected, address, existingToken, session, isSigningIn, handleSignIn]);

  return (
    <div className="workspace workspace-entry flex min-h-screen flex-col items-center justify-center bg-navy-950 px-6 py-12">
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
          {t('auth.login.backToHome')}
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
            {t('auth.login.title')}
          </h1>
          <p className="mb-8 text-center text-slate-400">
            {t('auth.login.subtitle')}
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
                          <Button
                            onClick={openConnectModal}
                            size="lg"
                            className="w-full"
                          >
                            {t('auth.login.connectWallet')}
                          </Button>
                        );
                      }

                      if (chain.unsupported) {
                        return (
                          <Button
                            onClick={openChainModal}
                            variant="secondary"
                            size="lg"
                          >
                            {t('auth.login.wrongNetwork')}
                          </Button>
                        );
                      }

                      return (
                        <div className="flex flex-col gap-3">
                          <Button
                            onClick={openAccountModal}
                            variant="secondary"
                            size="lg"
                          >
                            {account.displayName}
                          </Button>
                          <p className="text-center text-sm text-slate-400">
                            {isSigningIn ? t('auth.login.signingIn') : null}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                );
              }}
            </ConnectButton.Custom>
          </div>

          {signInError && (
            <div className="mt-4 text-center">
              <p role="alert" className="mb-3 text-sm text-red-400">
                {signInError}
              </p>
              <Button onClick={handleSignIn} disabled={isSigningIn}>
                {t('common.retry', { defaultValue: 'Try again' })}
              </Button>
            </div>
          )}

          <p className="mt-6 text-center text-xs text-slate-500">
            {t('auth.login.terms')}{' '}
            <Link to="/terms" className="text-accent-400 hover:underline">
              {t('auth.login.termsOfService')}
            </Link>{' '}
            {t('auth.login.and')}{' '}
            <Link to="/privacy" className="text-accent-400 hover:underline">
              {t('auth.login.privacyPolicy')}
            </Link>
          </p>
        </div>

        {/* Info */}
        <p className="mt-8 text-center text-sm text-slate-500">
          {t('auth.login.newToWeb3')}{' '}
          <Link to="/docs" className="text-accent-400 hover:underline">
            {t('auth.login.learnWallet')}
          </Link>
        </p>
      </div>
    </div>
  );
}
