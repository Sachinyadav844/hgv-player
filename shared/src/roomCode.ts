import { ROOM_ID_REGEX } from './constants';

/** Groups a room ID for display: ABCDEFGHJK -> ABCDE-FGHJK. */
export function formatRoomCode(roomId: string): string {
  return roomId.length === 10 ? `${roomId.slice(0, 5)}-${roomId.slice(5)}` : roomId;
}

/**
 * Accepts a raw room code ("abcde-fghjk", "ABCDE FGHJK"), a bare room ID, or a full
 * invitation link ("https://host/room/ABCDEFGHJK") and returns the normalized room ID,
 * or null if it cannot be a valid room ID.
 */
export function extractRoomId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value || value.length > 2048) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const match = url.pathname.match(/\/room\/([^/]+)/i);
      if (!match || !match[1]) return null;
      value = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }

  const normalized = value.replace(/[\s-]+/g, '').toUpperCase();
  return ROOM_ID_REGEX.test(normalized) ? normalized : null;
}

export function isValidRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID_REGEX.test(value);
}
