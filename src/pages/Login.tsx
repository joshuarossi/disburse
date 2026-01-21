import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Wallet } from 'lucide-react'

export default function Login() {
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

          {/* Connect button - placeholder for now */}
          <Button className="w-full" size="lg">
            <Wallet className="h-5 w-5" />
            Connect Wallet
          </Button>

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
  )
}
