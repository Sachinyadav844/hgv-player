import { useEffect, useRef, useState } from 'react';
import { Crown, MoreVertical, ShieldCheck, ShieldOff, UserMinus } from 'lucide-react';
import { can, type ParticipantDTO, type Role } from '@hgv/shared';
import { Avatar, EmptyState, RoleBadge } from './ui';

interface Props {
  participants: ParticipantDTO[];
  meId: string;
  meRole: Role;
  onAssignRole: (userId: string, role: 'MODERATOR' | 'PARTICIPANT') => void;
  onTransferHost: (userId: string) => void;
  onRemove: (userId: string) => void;
}

/** Row menu. Only ever rendered for the Host; the server independently enforces every action. */
function ManageMenu({ person, onAssignRole, onTransferHost, onRemove }: { person: ParticipantDTO } & Pick<Props, 'onAssignRole' | 'onTransferHost' | 'onRemove'>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-wash';
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Manage ${person.displayName}`}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full p-1.5 text-muted hover:bg-wash hover:text-ink"
      >
        <MoreVertical className="size-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-52 rounded-panel border border-line bg-paper p-1.5 shadow-lg">
          {person.role === 'PARTICIPANT' ? (
            <button role="menuitem" type="button" className={item} onClick={act(() => onAssignRole(person.userId, 'MODERATOR'))}>
              <ShieldCheck className="size-4 text-muted" aria-hidden /> Make moderator
            </button>
          ) : (
            <button role="menuitem" type="button" className={item} onClick={act(() => onAssignRole(person.userId, 'PARTICIPANT'))}>
              <ShieldOff className="size-4 text-muted" aria-hidden /> Make participant
            </button>
          )}
          <button role="menuitem" type="button" className={item} onClick={act(() => onTransferHost(person.userId))}>
            <Crown className="size-4 text-muted" aria-hidden /> Make host
          </button>
          <div className="my-1 h-px bg-line" />
          <button role="menuitem" type="button" className={`${item} text-brand`} onClick={act(() => onRemove(person.userId))}>
            <UserMinus className="size-4" aria-hidden /> Remove from room
          </button>
        </div>
      )}
    </div>
  );
}

export function ParticipantList({ participants, meId, meRole, onAssignRole, onTransferHost, onRemove }: Props) {
  const canManage = can(meRole, 'role:assign');
  if (participants.length === 0) {
    return <EmptyState title="Nobody here yet">Share the invite link to bring people in.</EmptyState>;
  }
  return (
    <ul aria-label="Participants" className="divide-y divide-line">
      {participants.map((p) => {
        const isMe = p.userId === meId;
        return (
          <li key={p.userId} className="flex items-center gap-3 py-2.5">
            <span className="relative">
              <Avatar name={p.displayName} seed={p.userId} />
              <span
                className={`absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-paper ${p.online ? 'bg-ok' : 'bg-muted/50'}`}
                aria-hidden
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {p.displayName}
                {isMe && <span className="font-normal text-muted"> (you)</span>}
              </p>
              <p className="text-xs text-muted">{p.online ? 'Online' : 'Offline, can rejoin'}</p>
            </div>
            <RoleBadge role={p.role} />
            {canManage && !isMe && p.role !== 'HOST' && (
              <ManageMenu person={p} onAssignRole={onAssignRole} onTransferHost={onTransferHost} onRemove={onRemove} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
