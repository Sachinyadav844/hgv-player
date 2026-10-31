import { useState } from 'react';
import { Check, Inbox, X } from 'lucide-react';
import { youtubeThumbnailUrl, type RequestDTO, type RequestStatus } from '@hgv/shared';
import { useVideoInfo } from '../hooks/useVideoTitle';
import { Button, EmptyState } from './ui';

const STATUS_STYLES: Record<RequestStatus, string> = {
  PENDING: 'bg-warn-wash text-warn',
  APPROVED: 'bg-ok-wash text-ok',
  REJECTED: 'bg-brand-wash text-brand',
  CANCELLED: 'bg-wash text-muted',
};
const STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

interface Props {
  requests: RequestDTO[];
  meId: string;
  /** True for the Host (and Moderators when the server policy allows). */
  canDecide: boolean;
  onApprove: (requestId: string) => Promise<unknown>;
  onReject: (requestId: string, reason?: string) => Promise<unknown>;
}

function RequestItem({ request, meId, canDecide, onApprove, onReject }: { request: RequestDTO } & Omit<Props, 'requests'>) {
  const info = useVideoInfo(request.videoId);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = request.status === 'PENDING';

  const run = async (kind: 'approve' | 'reject', fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      setRejecting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="py-3">
      <div className="flex gap-3">
        <img
          src={youtubeThumbnailUrl(request.videoId)}
          alt=""
          loading="lazy"
          width={96}
          height={54}
          className="h-[54px] w-24 shrink-0 rounded-lg bg-wash object-cover"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{info?.title ?? `Video ${request.videoId}`}</p>
          <p className="text-xs text-muted">
            {request.requesterId === meId ? 'You' : request.requesterName} suggested this
          </p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[request.status]}`}>
            {STATUS_LABELS[request.status]}
            {request.status !== 'PENDING' && request.decidedByName ? ` by ${request.decidedByName}` : ''}
          </span>
          {request.status === 'REJECTED' && request.rejectionReason && (
            <p className="mt-1 text-xs text-muted">Reason: {request.rejectionReason}</p>
          )}
        </div>
      </div>

      {canDecide && pending && !rejecting && (
        <div className="mt-2.5 flex gap-2 pl-[108px]">
          <Button size="sm" loading={busy === 'approve'} disabled={busy !== null} onClick={() => run('approve', () => onApprove(request.requestId))}>
            <Check className="size-4" aria-hidden /> Approve
          </Button>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setRejecting(true)}>
            <X className="size-4" aria-hidden /> Reject
          </Button>
        </div>
      )}
      {canDecide && pending && rejecting && (
        <form
          className="mt-2.5 flex flex-wrap gap-2 pl-[108px]"
          onSubmit={(e) => {
            e.preventDefault();
            void run('reject', () => onReject(request.requestId, reason.trim() || undefined));
          }}
        >
          <label className="sr-only" htmlFor={`reason-${request.requestId}`}>
            Reason for rejecting (optional)
          </label>
          <input
            id={`reason-${request.requestId}`}
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="h-8 min-w-0 flex-1 rounded-lg border border-line px-2 text-sm"
          />
          <Button size="sm" type="submit" loading={busy === 'reject'}>
            Confirm reject
          </Button>
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-1.5 pl-[108px] text-xs text-brand">
          {error}
        </p>
      )}
    </li>
  );
}

export function RequestPanel({ requests, meId, canDecide, onApprove, onReject }: Props) {
  if (requests.length === 0) {
    return (
      <EmptyState icon={<Inbox className="size-6" aria-hidden />} title={canDecide ? 'No requests yet' : 'You have not suggested a video'}>
        {canDecide
          ? 'When a participant suggests a video, it shows up here for you to approve or reject.'
          : 'Use "Suggest a video" under the player. The host or a moderator will approve or reject it.'}
      </EmptyState>
    );
  }
  const ordered = [...requests].sort(
    (a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING') || b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <ul aria-label="Video requests" className="divide-y divide-line">
      {ordered.map((r) => (
        <RequestItem key={r.requestId} request={r} meId={meId} canDecide={canDecide} onApprove={onApprove} onReject={onReject} />
      ))}
    </ul>
  );
}
