import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, DoorClosed, SearchX, Users } from 'lucide-react';
import { extractRoomId, type RoomPreview } from '@hgv/shared';
import { Header } from '../components/AppShell';
import { WatchRoom } from '../components/WatchRoom';
import { Button, Notice, Spinner } from '../components/ui';
import { api, ApiError } from '../services/api';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; room: RoomPreview; inviteUrl: string }
  | { kind: 'error'; error: ApiError };

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto mt-16 max-w-md px-4">{children}</div>
    </div>
  );
}

function Problem({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-wash text-muted">{icon}</div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted">{children}</p>
      <Link to="/rooms" className="mt-6 inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark">
        Go to your rooms
      </Link>
    </div>
  );
}

/** Looks the room up first, so invalid, closed and removed cases get a clear page before any socket is opened. */
export function RoomPage() {
  const params = useParams();
  const roomId = extractRoomId(params.roomId ?? '');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [joining, setJoining] = useState(false);

  const fetchRoom = useCallback(() => {
    if (!roomId) return;
    setLoad({ kind: 'loading' });
    api
      .roomPreview(roomId)
      .then(({ room, inviteUrl }) => setLoad({ kind: 'ready', room, inviteUrl }))
      .catch((error: ApiError) => setLoad({ kind: 'error', error }));
  }, [roomId]);

  useEffect(fetchRoom, [fetchRoom]);

  if (!roomId) {
    return (
      <Centered>
        <Problem icon={<SearchX className="size-7" aria-hidden />} title="That room code is not valid">
          Room codes are 10 letters and numbers, like ABCDE-FGHJK. Check the link or code and try again.
        </Problem>
      </Centered>
    );
  }

  if (load.kind === 'loading') {
    return (
      <Centered>
        <div className="text-center">
          <Spinner label="Looking for the room..." />
        </div>
      </Centered>
    );
  }

  if (load.kind === 'error') {
    if (load.error.code === 'ROOM_NOT_FOUND') {
      return (
        <Centered>
          <Problem icon={<SearchX className="size-7" aria-hidden />} title="Room not found">
            No room exists with the code {roomId}. It may have been mistyped, or the room is gone.
          </Problem>
        </Centered>
      );
    }
    return (
      <Centered>
        <Notice
          tone="error"
          title="Could not load the room"
          action={
            <Button size="sm" variant="secondary" onClick={fetchRoom}>
              Try again
            </Button>
          }
        >
          {load.error.message}
        </Notice>
      </Centered>
    );
  }

  const { room, inviteUrl } = load;

  if (room.removed) {
    return (
      <Centered>
        <Problem icon={<Ban className="size-7" aria-hidden />} title="You were removed from this room">
          The host removed you, so you cannot rejoin {room.name}.
        </Problem>
      </Centered>
    );
  }
  if (room.status === 'CLOSED') {
    return (
      <Centered>
        <Problem icon={<DoorClosed className="size-7" aria-hidden />} title="This room is closed">
          {room.name} was closed and cannot be joined any more. Start a new watch party from your rooms.
        </Problem>
      </Centered>
    );
  }

  if (!room.membership && !joining) {
    return (
      <Centered>
        <div className="rounded-panel border border-line p-6 text-center">
          <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-brand-wash text-brand">
            <Users className="size-7" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold">Join {room.name}?</h1>
          <p className="mt-2 text-muted">
            {room.hostName ? `${room.hostName} is hosting. ` : ''}
            {room.participantCount} {room.participantCount === 1 ? 'person is' : 'people are'} in this room. You will join as a participant.
          </p>
          <Button size="lg" className="mt-5 w-full" onClick={() => setJoining(true)}>
            Join room
          </Button>
        </div>
      </Centered>
    );
  }

  return <WatchRoom roomId={room.roomId} inviteUrl={inviteUrl} />;
}
