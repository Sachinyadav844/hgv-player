import { Router } from 'express';
import { isDbReady } from '../config/db';

export function healthRoutes(): Router {
  const router = Router();

  // Liveness: the process is up. Says nothing about MongoDB.
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  // Readiness: MongoDB is connected and the API can serve requests.
  router.get('/health/ready', (_req, res) => {
    const ready = isDbReady();
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'degraded',
      database: ready ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  return router;
}
