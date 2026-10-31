import { Loader2, WifiOff } from 'lucide-react';
import type { Connection } from '../hooks/useRoom';
import { Notice } from './ui';

export function ConnectionPill({ connection }: { connection: Connection }) {
  const map = {
    connected: { dot: 'bg-ok', text: 'Connected' },
    reconnecting: { dot: 'bg-[#f0a020]', text: 'Reconnecting' },
    offline: { dot: 'bg-brand', text: 'Offline' },
  } as const;
  const { dot, text } = map[connection];
  return (
    <span role="status" className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  );
}

/** Shown above the player while the socket is down. The room resyncs by itself on reconnect. */
export function ConnectionBanner({ connection }: { connection: Connection }) {
  if (connection === 'connected') return null;
  if (connection === 'reconnecting') {
    return (
      <Notice tone="warning" title="Reconnecting to the room">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Controls are unavailable until you are back. The room resyncs automatically when the connection returns.
        </span>
      </Notice>
    );
  }
  return (
    <Notice tone="error" title="You are offline">
      <span className="inline-flex items-center gap-2">
        <WifiOff className="size-4" aria-hidden /> Could not reach the server. Check your internet connection, then reload this page.
      </span>
    </Notice>
  );
}
