import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ParticipantDTO, RequestDTO, Role } from '@hgv/shared';
import { InviteButton } from '../components/InviteButton';
import { ParticipantList } from '../components/ParticipantList';
import { RequestPanel } from '../components/RequestPanel';
import { VideoUrlForm } from '../components/VideoUrlForm';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { ToastProvider } from '../context/ToastContext';
import { formatTime, initials } from '../utils/format';
import { safeNext } from '../utils/nav';

beforeEach(() => {
  // useVideoInfo calls fetch for titles; make it fail quietly like an offline browser.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
});
afterEach(() => vi.unstubAllGlobals());

const person = (userId: string, displayName: string, role: Role, online = true): ParticipantDTO => ({
  userId,
  displayName,
  role,
  online,
  joinedAt: '2026-01-01T00:00:00.000Z',
});
const PEOPLE = [person('h', 'Hana', 'HOST'), person('m', 'Mo', 'MODERATOR'), person('p', 'Pat', 'PARTICIPANT', false)];

describe('ParticipantList role-dependent controls', () => {
  const setup = (meId: string, meRole: Role) => {
    const handlers = { onAssignRole: vi.fn(), onTransferHost: vi.fn(), onRemove: vi.fn() };
    render(<ParticipantList participants={PEOPLE} meId={meId} meRole={meRole} {...handlers} />);
    return handlers;
  };

  it('shows names, role badges, the current user and online status', () => {
    setup('p', 'PARTICIPANT');
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText('Host')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Moderator')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Pat')).toBeInTheDocument();
    expect(within(items[2]!).getByText('(you)')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Offline, can rejoin')).toBeInTheDocument();
  });

  it.each([['PARTICIPANT', 'p'], ['MODERATOR', 'm']] as const)('hides management controls from a %s', (role, id) => {
    setup(id, role);
    expect(screen.queryByRole('button', { name: /manage/i })).not.toBeInTheDocument();
  });

  it('gives the Host a menu to promote, demote, transfer and remove', async () => {
    const user = userEvent.setup();
    const h = setup('h', 'HOST');
    expect(screen.queryByRole('button', { name: 'Manage Hana' })).not.toBeInTheDocument(); // not on yourself
    await user.click(screen.getByRole('button', { name: 'Manage Pat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make moderator' }));
    expect(h.onAssignRole).toHaveBeenCalledWith('p', 'MODERATOR');

    await user.click(screen.getByRole('button', { name: 'Manage Mo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make participant' }));
    expect(h.onAssignRole).toHaveBeenCalledWith('m', 'PARTICIPANT');

    await user.click(screen.getByRole('button', { name: 'Manage Mo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make host' }));
    expect(h.onTransferHost).toHaveBeenCalledWith('m');

    await user.click(screen.getByRole('button', { name: 'Manage Pat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from room' }));
    expect(h.onRemove).toHaveBeenCalledWith('p');
  });

  it('shows an empty state with no participants', () => {
    render(<ParticipantList participants={[]} meId="x" meRole="HOST" onAssignRole={vi.fn()} onTransferHost={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('Nobody here yet')).toBeInTheDocument();
  });
});

const req = (over: Partial<RequestDTO>): RequestDTO => ({
  requestId: 'r1',
  roomId: 'ABCDEFGHJK',
  type: 'VIDEO_CHANGE',
  videoId: 'dQw4w9WgXcQ',
  requesterId: 'p',
  requesterName: 'Pat',
  status: 'PENDING',
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  rejectionReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('RequestPanel', () => {
  it('lets approvers approve a pending request', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<RequestPanel requests={[req({})]} meId="h" canDecide onApprove={onApprove} onReject={vi.fn()} />);
    expect(screen.getByText('Pat suggested this')).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith('r1');
  });

  it('lets approvers reject with an optional reason', async () => {
    const user = userEvent.setup();
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<RequestPanel requests={[req({})]} meId="h" canDecide onApprove={vi.fn()} onReject={onReject} />);
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    await user.type(screen.getByLabelText(/reason for rejecting/i), 'Too long');
    await user.click(screen.getByRole('button', { name: 'Confirm reject' }));
    expect(onReject).toHaveBeenCalledWith('r1', 'Too long');
  });

  it('shows a decision error inline when the server refuses', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn().mockRejectedValue(new Error('This request has already been handled.'));
    render(<RequestPanel requests={[req({})]} meId="h" canDecide onApprove={onApprove} onReject={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been handled');
  });

  it('shows participants only the status of their own request, with no decision buttons', () => {
    render(
      <RequestPanel
        requests={[req({ requesterId: 'p', status: 'REJECTED', decidedByName: 'Hana', rejectionReason: 'Not tonight' })]}
        meId="p"
        canDecide={false}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('You suggested this')).toBeInTheDocument();
    expect(screen.getByText('Rejected by Hana')).toBeInTheDocument();
    expect(screen.getByText('Reason: Not tonight')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve|reject/i })).not.toBeInTheDocument();
  });

  it('does not offer buttons for requests that are already decided', () => {
    render(<RequestPanel requests={[req({ status: 'APPROVED', decidedByName: 'Hana' })]} meId="h" canDecide onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('Approved by Hana')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('shows different empty states for approvers and participants', () => {
    const { rerender } = render(<RequestPanel requests={[]} meId="h" canDecide onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('No requests yet')).toBeInTheDocument();
    rerender(<RequestPanel requests={[]} meId="p" canDecide={false} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('You have not suggested a video')).toBeInTheDocument();
  });

  it('lists pending requests first', () => {
    render(
      <RequestPanel
        requests={[
          req({ requestId: 'old', status: 'APPROVED', createdAt: '2026-01-03T00:00:00.000Z' }),
          req({ requestId: 'new', status: 'PENDING', createdAt: '2026-01-01T00:00:00.000Z' }),
        ]}
        meId="h"
        canDecide
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Waiting for approval')).toBeInTheDocument();
  });
});

describe('InviteButton', () => {
  it('copies the invite link and confirms', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <ToastProvider>
        <InviteButton url="http://localhost:5173/room/ABCDEFGHJK" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(writeText).toHaveBeenCalledWith('http://localhost:5173/room/ABCDEFGHJK');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByText('Invite link copied')).toBeInTheDocument();
  });

  it('tells the user when copying is not possible', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    render(
      <ToastProvider>
        <InviteButton url="http://localhost:5173/room/ABCDEFGHJK" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(await screen.findByText(/could not copy automatically/i)).toBeInTheDocument();
  });
});

describe('VideoUrlForm', () => {
  it('rejects links that are not YouTube before calling the server', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<VideoUrlForm mode="direct" onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Video link'), 'https://evil.example/watch?v=dQw4w9WgXcQ');
    await user.click(screen.getByRole('button', { name: 'Load video' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a YouTube link');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('asks for a link when empty', async () => {
    const user = userEvent.setup();
    render(<VideoUrlForm mode="direct" onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Load video' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste a YouTube link first');
  });

  it('submits a valid link in direct mode and clears the field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<VideoUrlForm mode="direct" onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Video link'), 'https://youtu.be/dQw4w9WgXcQ');
    await user.click(screen.getByRole('button', { name: 'Load video' }));
    expect(onSubmit).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ');
    await waitFor(() => expect(screen.getByLabelText('Video link')).toHaveValue(''));
  });

  it('uses request wording for participants and shows server refusals', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('You already requested that video.'));
    render(<VideoUrlForm mode="request" onSubmit={onSubmit} />);
    expect(screen.getByLabelText('Suggest a video')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Suggest a video'), 'dQw4w9WgXcQ');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You already requested that video.');
  });
});

describe('connection states', () => {
  it('shows nothing while connected', () => {
    const { container } = render(<ConnectionBanner connection="connected" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('explains reconnecting and offline states', () => {
    const { rerender } = render(<ConnectionBanner connection="reconnecting" />);
    expect(screen.getByText('Reconnecting to the room')).toBeInTheDocument();
    rerender(<ConnectionBanner connection="offline" />);
    expect(screen.getByText('You are offline')).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75.9)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-4)).toBe('0:00');
  });
  it('builds initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('  grace  ')).toBe('G');
    expect(initials('')).toBe('?');
  });
  it('only allows same-site redirect targets', () => {
    expect(safeNext('/room/ABC')).toBe('/room/ABC');
    expect(safeNext('//evil.com')).toBe('/rooms');
    expect(safeNext('https://evil.com')).toBe('/rooms');
    expect(safeNext('/\\evil.com')).toBe('/rooms');
    expect(safeNext(null)).toBe('/rooms');
  });
});
