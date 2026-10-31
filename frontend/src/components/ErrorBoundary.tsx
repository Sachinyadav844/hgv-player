import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  failed: boolean;
}

/** Last line of defence: a crash in one screen shows a recovery page instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto size-10 text-brand" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold">Something broke on this page</h1>
          <p className="mt-2 text-muted">Reload to try again. If you were in a room, you will rejoin it and resync automatically.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
