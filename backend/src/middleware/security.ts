import type { ErrorRequestHandler, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { Config } from '../config/env';
import { isDbReady } from '../config/db';
import type { AuthService } from '../services/authService';
import { AppError, toAppError } from '../utils/errors';
import type { ApiErrorBody } from '@hgv/shared';

export const SESSION_COOKIE = 'hgv_session';
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'hgv-player';

/**
 * CSRF defence for cookie authentication. State-changing requests must
 *  1. come from an allow-listed Origin (when the browser sends one), and
 *  2. carry a custom header. A cross-site page cannot add custom headers without a CORS
 *     preflight, and the preflight is only approved for allow-listed origins.
 */
export function csrfProtection(config: Pick<Config, 'clientOrigins'>): RequestHandler {
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !config.clientOrigins.includes(origin)) {
      throw new AppError('FORBIDDEN', 'This origin is not allowed to call the API.');
    }
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new AppError('FORBIDDEN', 'Missing required request header.');
    }
    next();
  };
}

/** Answers 503 DB_UNAVAILABLE instead of letting a request hang while MongoDB is down. */
export const requireDb: RequestHandler = (_req, _res, next) => {
  if (!isDbReady()) {
    throw new AppError(
      'DB_UNAVAILABLE',
      'The database is not connected. Check MONGODB_URI in backend/.env and that MongoDB is running.',
    );
  }
  next();
};

export function requireAuth(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const session = await auth.authenticateToken(req.cookies?.[SESSION_COOKIE]);
    if (!session) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
    req.user = session.user;
    next();
  };
}

function limiter(windowMs: number, limit: number, message: string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      const body: ApiErrorBody = { error: { code: 'TOO_MANY_REQUESTS', message } };
      res.status(429).json(body);
    },
  });
}

export function buildLimiters(config: Pick<Config, 'rateLimit'>) {
  const r = config.rateLimit;
  return {
    api: limiter(r.apiWindowMs, r.apiMax, 'Too many requests. Please slow down.'),
    auth: limiter(r.authWindowMs, r.authMax, 'Too many sign-in attempts. Try again in a few minutes.'),
    createRoom: limiter(r.createRoomWindowMs, r.createRoomMax, 'You created too many rooms. Try again later.'),
  };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found.' } };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Body-parser failures carry a `type` and an HTTP status; translate them to our format.
  const type = (err as { type?: string })?.type;
  let appError: AppError;
  if (type === 'entity.parse.failed') {
    appError = new AppError('VALIDATION_ERROR', 'Request body is not valid JSON.');
  } else if (type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is too large.' } });
    return;
  } else {
    appError = toAppError(err);
  }
  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    },
  };
  res.status(appError.status).json(body);
};
