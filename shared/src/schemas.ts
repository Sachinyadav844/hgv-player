import { z } from 'zod';
import { LIMITS, ROOM_ID_REGEX } from './constants';
import { ASSIGNABLE_ROLES } from './permissions';

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export const nameSchema = z
  .string()
  .trim()
  .min(LIMITS.displayNameMin, `Name must be at least ${LIMITS.displayNameMin} characters`)
  .max(LIMITS.displayNameMax, `Name must be at most ${LIMITS.displayNameMax} characters`);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `Password must be at least ${LIMITS.passwordMin} characters`)
  .refine((s) => byteLength(s) <= LIMITS.passwordMaxBytes, 'Password is too long (max 72 bytes)')
  .refine(
    (s) => /[A-Za-z]/.test(s) && /\d/.test(s),
    'Password must contain at least one letter and one number',
  );

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});

export const updateProfileSchema = z.object({ name: nameSchema });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(200),
  newPassword: passwordSchema,
});

export const roomNameSchema = z
  .string()
  .trim()
  .min(LIMITS.roomNameMin, `Room name must be at least ${LIMITS.roomNameMin} characters`)
  .max(LIMITS.roomNameMax, `Room name must be at most ${LIMITS.roomNameMax} characters`);

export const createRoomSchema = z.object({ name: roomNameSchema });

export const roomIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ROOM_ID_REGEX, 'Invalid room code');

const userIdSchema = z.string().min(1).max(64);
const positionSchema = z
  .number()
  .finite('Position must be a finite number')
  .min(0, 'Position cannot be negative')
  .max(LIMITS.maxPlaybackSeconds, 'Position is out of range');

export const socketSchemas = {
  roomId: z.object({ roomId: roomIdSchema }).strict(),
  position: z.object({ roomId: roomIdSchema, position: positionSchema }).strict(),
  changeVideo: z.object({ roomId: roomIdSchema, url: z.string().min(1).max(2048) }).strict(),
  assignRole: z
    .object({
      roomId: roomIdSchema,
      userId: userIdSchema,
      role: z.enum(ASSIGNABLE_ROLES),
    })
    .strict(),
  targetUser: z.object({ roomId: roomIdSchema, userId: userIdSchema }).strict(),
  requestId: z.object({ roomId: roomIdSchema, requestId: z.string().min(8).max(64) }).strict(),
  rejectRequest: z
    .object({
      roomId: roomIdSchema,
      requestId: z.string().min(8).max(64),
      reason: z.string().trim().max(200).optional(),
    })
    .strict(),
} as const;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
