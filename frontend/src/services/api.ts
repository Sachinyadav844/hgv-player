import type {
  ApiErrorBody,
  ErrorCode,
  PublicUser,
  RoomDTO,
  RoomPreview,
  RoomSummary,
} from '@hgv/shared';

/** Base URL of the backend. Empty means "same origin" (dev proxy, or a combined deployment). */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export type ClientErrorCode = ErrorCode | 'NETWORK';

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status = 0,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages from server-side validation, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as { path?: string; message?: string }[]) {
        if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
      }
    }
    return out;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        // Required by the server's CSRF protection for state-changing requests.
        'X-Requested-With': 'hgv-player',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK', 'Cannot reach the HGV Player server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(err?.code ?? 'INTERNAL', err?.message ?? 'Something went wrong. Please try again.', res.status, err?.details);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: PublicUser }>('GET', '/api/auth/me'),
  register: (input: { name: string; email: string; password: string }) =>
    request<{ user: PublicUser }>('POST', '/api/auth/register', input),
  login: (input: { email: string; password: string }) =>
    request<{ user: PublicUser }>('POST', '/api/auth/login', input),
  logout: () => request<void>('POST', '/api/auth/logout'),
  updateName: (name: string) => request<{ user: PublicUser }>('PATCH', '/api/auth/me', { name }),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<void>('POST', '/api/auth/password', input),
  createRoom: (name: string) =>
    request<{ room: RoomDTO; inviteUrl: string }>('POST', '/api/rooms', { name }),
  myRooms: () => request<{ rooms: RoomSummary[] }>('GET', '/api/rooms/mine'),
  roomPreview: (roomId: string) =>
    request<{ room: RoomPreview; inviteUrl: string }>('GET', `/api/rooms/${encodeURIComponent(roomId)}`),
};
