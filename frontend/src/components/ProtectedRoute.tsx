import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Header } from './AppShell';
import { Button, Notice, Spinner } from './ui';

/** Gate for pages that need a signed-in user. Sends visitors to login and back again afterwards. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, error, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Checking your session..." />
      </div>
    );
  }

  if (status === 'anonymous') {
    if (error) {
      return (
        <div className="min-h-screen">
          <Header showNav={false} />
          <div className="mx-auto mt-16 max-w-md px-4">
            <Notice
              tone="error"
              title="Cannot reach the server"
              action={
                <Button size="sm" variant="secondary" onClick={retry}>
                  <WifiOff className="size-4" aria-hidden /> Try again
                </Button>
              }
            >
              {error}
            </Notice>
          </div>
        </div>
      );
    }
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}
