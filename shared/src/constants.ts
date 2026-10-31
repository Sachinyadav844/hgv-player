export const APP_NAME = 'HGV Player';

/** Alphabet for room codes: no I, O, 0, 1 to avoid look-alike characters. */
export const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_ID_LENGTH = 10;
export const ROOM_ID_REGEX = /^[A-HJ-NP-Z2-9]{10}$/;

export const LIMITS = {
  roomNameMin: 2,
  roomNameMax: 60,
  displayNameMin: 2,
  displayNameMax: 40,
  passwordMin: 8,
  /** bcrypt only uses the first 72 bytes of a password. */
  passwordMaxBytes: 72,
  /** Upper bound for a playback position (7 days in seconds). */
  maxPlaybackSeconds: 7 * 24 * 60 * 60,
  maxPendingRequestsPerUser: 3,
  maxRequestsReturned: 50,
} as const;

/** Reasonable bounds for client-side drift reconciliation (seconds). */
export const SYNC = {
  /** While playing, seek only when the player is further than this from the target. */
  playingDriftThreshold: 2,
  /** While paused, seek only when further than this from the target. */
  pausedDriftThreshold: 0.75,
  /** Never issue two reconciliation seeks closer together than this (ms). */
  minSeekIntervalMs: 3000,
  /** How often clients compare their player with the expected position (ms). */
  reconcileIntervalMs: 2000,
} as const;
