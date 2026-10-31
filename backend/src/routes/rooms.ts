import { Router } from 'express';
import { createRoomSchema, roomIdSchema } from '@hgv/shared';
import type { Config } from '../config/env';
import { requireAuth } from '../middleware/security';
import type { AuthService } from '../services/authService';
import type { RoomManager } from '../services/roomManager';

interface Deps {
  config: Config;
  auth: AuthService;
  manager: RoomManager;
  createLimiter: import('express').RequestHandler;
}

export function roomRoutes({ config, auth, manager, createLimiter }: Deps): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.post('/', createLimiter, async (req, res) => {
    const { name } = createRoomSchema.parse(req.body);
    const room = await manager.createRoom(req.user!, name);
    res.status(201).json({ room, inviteUrl: `${config.clientOrigin}/room/${room.roomId}` });
  });

  router.get('/mine', async (req, res) => {
    res.json({ rooms: await manager.roomsForUser(req.user!.id) });
  });

  router.get('/:roomId', async (req, res) => {
    const roomId = roomIdSchema.parse(req.params.roomId);
    const room = await manager.preview(roomId, req.user!.id);
    res.json({ room, inviteUrl: `${config.clientOrigin}/room/${room.roomId}` });
  });

  return router;
}
