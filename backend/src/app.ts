import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import type { Config } from './config/env';
import {
  buildLimiters,
  csrfProtection,
  errorHandler,
  notFoundHandler,
  requireDb,
} from './middleware/security';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { roomRoutes } from './routes/rooms';
import type { AuthService } from './services/authService';
import type { RoomManager } from './services/roomManager';

export interface AppDeps {
  config: Config;
  auth: AuthService;
  manager: RoomManager;
  onLogout: (userId: string) => void;
}

export function createApp({ config, auth, manager, onLogout }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.clientOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-Requested-With'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.use(healthRoutes());
  app.get('/api/health', (_req, res) => res.redirect(307, '/health/ready'));

  const limiters = buildLimiters(config);
  const api = express.Router();
  api.use(limiters.api, requireDb, csrfProtection(config));
  api.use('/auth', authRoutes({ config, auth, limiter: limiters.auth, onLogout }));
  api.use('/rooms', roomRoutes({ config, auth, manager, createLimiter: limiters.createRoom }));
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
