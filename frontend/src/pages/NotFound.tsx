import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { AppShell } from '../components/AppShell';

export default function NotFound() {
  return (
    <AppShell>
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <Compass className="mx-auto size-10 text-muted" aria-hidden />
        <h1 className="mt-4 text-3xl font-bold">Page not found</h1>
        <p className="mt-2 text-muted">The page you are looking for does not exist or has moved.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/" className="inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark">
            Go to the home page
          </Link>
          <Link to="/rooms" className="inline-flex h-10 items-center rounded-full border border-line px-5 text-sm font-semibold hover:bg-wash">
            Your rooms
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
