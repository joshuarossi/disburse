import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-950 px-6 text-white">
      <div className="max-w-md text-center">
        <p className="text-sm text-accent-400">404</p>
        <h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
        <p className="mt-4 text-slate-400">
          This link may be outdated. Choose an organization to continue.
        </p>
        <Link
          className="mt-6 inline-block rounded-lg bg-accent-400 px-5 py-3 font-medium text-navy-950"
          to="/select-org"
        >
          Open Disburse
        </Link>
        <Link className="ml-4 text-accent-400 underline" to="/">
          Go home
        </Link>
      </div>
    </main>
  );
}
