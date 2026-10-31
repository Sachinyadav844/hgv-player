import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Tv2 } from 'lucide-react';
import { createRoomSchema, formatRoomCode, type RoomSummary } from '@hgv/shared';
import { AppShell, PageHeading } from '../components/AppShell';
import { JoinRoomForm } from '../components/JoinRoomForm';
import { Button, EmptyState, Field, Notice, RoleBadge, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../services/api';

export default function Rooms() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    api
      .myRooms()
      .then(({ rooms }) => setRooms(rooms))
      .catch((err: ApiError) => setLoadError(err.message));
  };

  useEffect(load, []);
  useEffect(() => nameRef.current?.focus(), []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createRoomSchema.safeParse({ name });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? 'Enter a room name');
      return;
    }
    setNameError(null);
    setCreating(true);
    try {
      const { room } = await api.createRoom(parsed.data.name);
      toast.success('Room created. You are the host.');
      navigate(`/room/${room.roomId}`);
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : 'Could not create the room.');
      setCreating(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-10">
        <PageHeading title={`Hi ${user?.name.split(' ')[0] ?? 'there'}, ready to watch?`}>Start a room or join one with a code.</PageHeading>

        <div className="grid gap-6 md:grid-cols-2">
          <section aria-labelledby="create-title" className="rounded-panel border border-line p-5">
            <h2 id="create-title" className="text-lg font-bold">
              Create a watch party
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted">You become the host and decide who controls playback.</p>
            <form onSubmit={create} noValidate className="space-y-3">
              <Field ref={nameRef} label="Room name" value={name} maxLength={60} error={nameError} placeholder="Friday movie night" onChange={(e) => { setName(e.target.value); if (nameError) setNameError(null); }} />
              <Button type="submit" size="lg" loading={creating}>
                <Plus className="size-5" aria-hidden /> Create room
              </Button>
            </form>
          </section>

          <section aria-labelledby="join-title" className="rounded-panel border border-line p-5">
            <h2 id="join-title" className="text-lg font-bold">
              Join a room
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted">Paste the invite link you were sent, or type the room code.</p>
            <JoinRoomForm id="rooms-join" />
          </section>
        </div>

        <section aria-labelledby="mine-title" className="mt-10">
          <h2 id="mine-title" className="mb-3 text-xl font-bold">
            Your rooms
          </h2>
          {loadError ? (
            <Notice tone="error" title="Could not load your rooms" action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>
              {loadError}
            </Notice>
          ) : rooms === null ? (
            <Spinner label="Loading your rooms..." />
          ) : rooms.length === 0 ? (
            <EmptyState icon={<Tv2 className="size-6" aria-hidden />} title="No rooms yet">
              Rooms you create or join appear here so you can jump back in.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line rounded-panel border border-line">
              {rooms.map((room) => (
                <li key={room.roomId}>
                  <Link to={`/room/${room.roomId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-wash">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{room.name}</p>
                      <p className="font-mono text-xs tracking-wider text-muted">{formatRoomCode(room.roomId)}</p>
                    </div>
                    <RoleBadge role={room.role} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
