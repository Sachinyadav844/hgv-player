import { Router, type Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '@hgv/shared';
import type { Config } from '../config/env';
import { SESSION_COOKIE, requireAuth } from '../middleware/security';
import { toPublicUser, type AuthService, type AuthUser } from '../services/authService';

interface Deps {
  config: Config;
  auth: AuthService;
  limiter: import('express').RequestHandler;
  /** Called after logout so live sockets of that user can be closed. */
  onLogout: (userId: string) => void;
}

export function authRoutes({ config, auth, limiter, onLogout }: Deps): Router {
  const router = Router();

  const cookieOptions = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/',
  } as const;

  const startSession = (res: Response, user: AuthUser) => {
    res.cookie(SESSION_COOKIE, auth.signToken(user), {
      ...cookieOptions,
      maxAge: config.sessionTtlSeconds * 1000,
    });
  };

  router.post('/register', limiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await auth.register(input);
    startSession(res, user);
    res.status(201).json({ user: toPublicUser(user) });
  });

  router.post('/login', limiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await auth.login(input.email, input.password);
    startSession(res, user);
    res.json({ user: toPublicUser(user) });
  });

  router.post('/logout', async (req, res) => {
    // Best effort: identify the user so their live sockets can be dropped, but always succeed.
    const session = await auth.authenticateToken(req.cookies?.[SESSION_COOKIE]).catch(() => null);
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    if (session) onLogout(session.user.id);
    res.status(204).end();
  });

  router.get('/me', requireAuth(auth), (req, res) => {
    res.json({ user: toPublicUser(req.user!) });
  });

  router.patch('/me', requireAuth(auth), async (req, res) => {
    const { name } = updateProfileSchema.parse(req.body);
    const user = await auth.updateName(req.user!.id, name);
    res.json({ user: toPublicUser(user) });
  });

  router.post('/password', requireAuth(auth), limiter, async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await auth.changePassword(req.user!.id, currentPassword, newPassword);
    res.status(204).end();
  });

  return router;
}
