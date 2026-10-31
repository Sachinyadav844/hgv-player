import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, DoorOpen, Lock, Users, XCircle } from 'lucide-react';
import { can, formatRoomCode } from '@hgv/shared';
import { useRoom } from '../hooks/useRoom';
import { useVideoInfo } from '../hooks/useVideoTitle';
import { useToast } from '../context/ToastContext';
import { AccountMenu } from './AppShell';
import { ConnectionBanner, ConnectionPill } from './ConnectionBanner';
import { InviteButton } from './InviteButton';
import { Logo } from './Logo';
import { ParticipantList } from './ParticipantList';
import { PlayerStage } from './PlayerStage';
import { RequestPanel } from './RequestPanel';
import { VideoUrlForm } from './VideoUrlForm';
import { Button, ConfirmDialog, Notice, RoleBadge, Spinner } from './ui';

type Tab = 'people' | 'requests';
type Pending =
  | { kind: 'leave' }
  | { kind: 'close' }
  | { kind: 'remove'; userId: string; name: string }
  | { kind: 'host'; userId: string; name: string };

function RoomEnded({ title, message, actionLabel = 'Back to your rooms' }: { title: string; message: string; actionLabel?: string }) {
  return (
    <div className="mx-auto mt-20 max-w-md px-4 text-center">
      <XCircle className="mx-auto size-10 text-brand" aria-hidden />
      <h1 className="mt-3 text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted">{message}</p>
      <Link to="/rooms" className="mt-6 inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark">
        {actionLabel}
      </Link>
    </div>
  );
}

export function WatchRoom({ roomId, inviteUrl }: { roomId: string; inviteUrl: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const r = useRoom(roomId);
  const [tab, setTab] = useState<Tab>('people');
  const [panelOpen, setPanelOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024));
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const info = useVideoInfo(r.playback?.videoId);

  const failWith = (err: unknown) => toast.error(err instanceof Error ? err.message : 'That did not work.');

  if (r.phase === 'removed') {
    return <RoomEnded title="You were removed from this room" message="The host removed you, so you cannot rejoin this room." />;
  }
  if (r.phase === 'closed') {
    return <RoomEnded title="This room is closed" message={r.failure?.message ?? 'The host closed this room.'} />;
  }
  if (r.phase === 'left') {
    return <RoomEnded title="You left the room" message="You can come back any time with the invite link." />;
  }
  if (r.phase === 'failed') {
    return (
      <div className="mx-auto mt-20 max-w-md px-4">
        <Notice
          tone="error"
          title="Could not join the room"
          action={
            r.failure?.code === 'UNAUTHENTICATED' ? (
              <Link to={`/login?next=${encodeURIComponent(`/room/${roomId}`)}`} className="text-sm font-semibold underline">
                Log in
              </Link>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            )
          }
        >
          {r.failure?.message ?? 'Something went wrong.'}
        </Notice>
      </div>
    );
  }
  if (r.phase !== 'ready' || !r.room || !r.me) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <Spinner label={r.connection === 'offline' ? 'Cannot reach the server...' : 'Joining the room...'} />
          {r.connection === 'offline' && <p className="mt-2 text-sm text-muted">Check your internet connection and reload.</p>}
        </div>
      </div>
    );
  }

  const { room, me } = r;
  const canControl = can(me.role, 'playback:control');
  const canChangeVideo = can(me.role, 'video:change');
  const canDecide = can(me.role, 'request:decide');
  const isHost = me.role === 'HOST';
  const pendingCount = r.requests.filter((q) => q.status === 'PENDING').length;
  const online = r.participants.filter((p) => p.online).length;
  const offline = r.connection !== 'connected';

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'leave') {
        await r.leave();
        toast.success('You left the room');
        navigate('/rooms');
      } else if (pending.kind === 'close') {
        await r.closeRoom();
        toast.success('Room closed');
        navigate('/rooms');
      } else if (pending.kind === 'remove') {
        await r.removeParticipant(pending.userId);
        toast.success(`${pending.name} was removed`);
      } else {
        await r.transferHost(pending.userId);
        toast.success(`${pending.name} is now the host`);
      }
      setPending(null);
    } catch (err) {
      failWith(err);
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const tabClass = (active: boolean) =>
    `flex-1 border-b-2 px-3 py-2.5 text-sm font-semibold ${active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`;

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-3 px-4">
          <Logo to="/rooms" className="hidden sm:inline-flex" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold sm:text-lg">{room.name}</h1>
          </div>
          <ConnectionPill connection={r.connection} />
          <Button variant="secondary" size="sm" onClick={() => setPending({ kind: 'leave' })}>
            <DoorOpen className="size-4" aria-hidden /> <span className="hidden sm:inline">Leave room</span>
            <span className="sm:hidden">Leave</span>
          </Button>
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Player" className="min-w-0 space-y-4">
          <ConnectionBanner connection={r.connection} />
          <PlayerStage
            playback={r.playback}
            getServerNow={r.getServerNow}
            canControl={canControl && !offline}
            onPlay={r.play}
            onPause={r.pause}
            onSeek={r.seek}
            onError={(m) => toast.error(m)}
            emptyHint={
              canChangeVideo
                ? 'Paste a YouTube link below to start the party.'
                : 'Waiting for the host to pick a video. You can suggest one below.'
            }
          />

          <div>
            <h2 className="text-lg font-bold">{info?.title ?? (r.playback?.videoId ? `Video ${r.playback.videoId}` : 'Nothing playing')}</h2>
            {info?.author && <p className="text-sm text-muted">{info.author}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-wash px-3 py-1.5 font-medium">
                Room code <span className="font-mono tracking-wider">{formatRoomCode(room.roomId)}</span>
              </span>
              <InviteButton url={inviteUrl} />
              <span className="inline-flex items-center gap-1.5 text-muted">
                <Users className="size-4" aria-hidden /> {r.participants.length} in room, {online} online
              </span>
              <span className="ml-auto inline-flex items-center gap-2 text-muted">
                You are <RoleBadge role={me.role} />
              </span>
            </div>
          </div>

          <div className="rounded-panel border border-line p-4">
            {canChangeVideo ? (
              <VideoUrlForm
                mode="direct"
                disabled={offline}
                onSubmit={async (url) => {
                  await r.changeVideo(url);
                  toast.success('Video loaded for everyone');
                }}
              />
            ) : (
              <VideoUrlForm
                mode="request"
                disabled={offline}
                onSubmit={async (url) => {
                  await r.requestChange(url);
                  setTab('requests');
                  setPanelOpen(true);
                  toast.success('Request sent');
                }}
              />
            )}
            {!canChangeVideo && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <Lock className="size-3.5" aria-hidden /> Only the host and moderators can change the video directly.
              </p>
            )}
          </div>
        </section>

        <aside aria-label="Room panel" className="min-w-0">
          <button
            type="button"
            className="mb-2 flex w-full items-center justify-between rounded-panel border border-line px-4 py-3 text-sm font-semibold lg:hidden"
            aria-expanded={panelOpen}
            aria-controls="room-panel"
            onClick={() => setPanelOpen((o) => !o)}
          >
            <span className="inline-flex items-center gap-2">
              <Users className="size-4" aria-hidden /> People and requests ({r.participants.length})
              {pendingCount > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-white">{pendingCount}</span>}
            </span>
            <ChevronDown className={`size-4 transition-transform ${panelOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>

          <div id="room-panel" className={`${panelOpen ? 'block' : 'hidden'} rounded-panel border border-line lg:block`}>
            <div role="tablist" aria-label="Room panel" className="flex border-b border-line">
              <button role="tab" type="button" aria-selected={tab === 'people'} className={tabClass(tab === 'people')} onClick={() => setTab('people')}>
                People ({r.participants.length})
              </button>
              <button role="tab" type="button" aria-selected={tab === 'requests'} className={tabClass(tab === 'requests')} onClick={() => setTab('requests')}>
                Requests
                {pendingCount > 0 && <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-xs text-white">{pendingCount}</span>}
              </button>
            </div>

            <div role="tabpanel" className="max-h-[560px] overflow-y-auto px-4 py-2">
              {tab === 'people' ? (
                <>
                  <p className="py-2 text-xs text-muted">The host and moderators control playback. Everyone else watches and can suggest videos.</p>
                  <ParticipantList
                    participants={r.participants}
                    meId={me.userId}
                    meRole={me.role}
                    onAssignRole={(userId, role) =>
                      r
                        .assignRole(userId, role)
                        .then(() => toast.success(role === 'MODERATOR' ? 'Made a moderator' : 'Made a participant'))
                        .catch(failWith)
                    }
                    onTransferHost={(userId) =>
                      setPending({ kind: 'host', userId, name: r.participants.find((p) => p.userId === userId)?.displayName ?? 'this person' })
                    }
                    onRemove={(userId) =>
                      setPending({ kind: 'remove', userId, name: r.participants.find((p) => p.userId === userId)?.displayName ?? 'this person' })
                    }
                  />
                </>
              ) : (
                <RequestPanel
                  requests={r.requests}
                  meId={me.userId}
                  canDecide={canDecide}
                  onApprove={(id) =>
                    r.approve(id).then(() => toast.success('Request approved. The video is loaded for everyone.'))
                  }
                  onReject={(id, reason) => r.reject(id, reason).then(() => toast.success('Request rejected'))}
                />
              )}
            </div>

            {isHost && (
              <div className="border-t border-line p-4">
                <p className="mb-2 text-sm font-semibold">Host controls</p>
                <Button variant="danger" size="sm" onClick={() => setPending({ kind: 'close' })}>
                  Close room for everyone
                </Button>
              </div>
            )}
          </div>
        </aside>
      </main>

      {pending?.kind === 'leave' && (
        <ConfirmDialog
          title="Leave this room?"
          message={isHost ? 'You are the host. If other people are in the room, hosting passes to a moderator or the longest-standing member. If you are the last person, the room closes.' : 'You can rejoin later with the invite link.'}
          confirmLabel="Leave room"
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'close' && (
        <ConfirmDialog
          title="Close this room?"
          message="Everyone is disconnected and the room cannot be joined again."
          confirmLabel="Close room"
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'remove' && (
        <ConfirmDialog
          title={`Remove ${pending.name}?`}
          message="They are disconnected immediately and cannot rejoin this room with their account."
          confirmLabel="Remove"
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'host' && (
        <ConfirmDialog
          title={`Make ${pending.name} the host?`}
          message="They get full control of the room and you become a moderator."
          confirmLabel="Transfer host"
          tone="primary"
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
