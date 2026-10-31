import { z } from 'zod';
import type { ErrorCode } from '@hgv/shared';
import { log } from './logger';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  ROOM_CLOSED: 410,
  NOT_A_MEMBER: 403,
  REMOVED_FROM_ROOM: 403,
  INVALID_VIDEO: 400,
  NO_VIDEO: 409,
  REQUEST_NOT_FOUND: 404,
  REQUEST_ALREADY_DECIDED: 409,
  ROLE_UNCHANGED: 409,
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  DB_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** An error that is safe to show to the client: it carries a stable code and message. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

const DB_ERROR_NAMES = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongooseServerSelectionError',
  'MongoTopologyClosedError',
]);

function isDbUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (DB_ERROR_NAMES.has(err.name)) return true;
  return /buffering timed out|before initial connection|topology is closed|not connected/i.test(
    err.message,
  );
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/**
 * Converts anything thrown into an AppError. Unknown errors become a generic INTERNAL error so
 * that stack traces and driver messages never reach clients.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof z.ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new AppError('VALIDATION_ERROR', err.issues[0]?.message ?? 'Invalid input', details);
  }
  if (isDbUnavailable(err)) {
    return new AppError(
      'DB_UNAVAILABLE',
      'The database is not reachable right now. Please try again shortly.',
    );
  }
  log.error('Unhandled error', err);
  return new AppError('INTERNAL', 'Something went wrong on our side. Please try again.');
}
