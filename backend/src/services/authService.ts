import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import type { PublicUser } from '@hgv/shared';
import type { Config } from '../config/env';
import { UserModel, type UserDoc } from '../models';
import { AppError, isDuplicateKeyError } from '../utils/errors';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export function toPublicUser(user: AuthUser): PublicUser {
  return { id: user.id, name: user.name, email: user.email };
}

function toAuthUser(doc: Pick<UserDoc, '_id' | 'name' | 'email'>): AuthUser {
  return { id: String(doc._id), name: doc.name, email: doc.email };
}

export interface VerifiedSession {
  user: AuthUser;
  /** Token expiry as ms since epoch. */
  expiresAt: number;
}

export class AuthService {
  private dummyHash: string | null = null;

  constructor(private readonly config: Pick<Config, 'jwtSecret' | 'bcryptCost' | 'sessionTtlSeconds'>) {}

  private async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.config.bcryptCost);
  }

  async register(input: { name: string; email: string; password: string }): Promise<AuthUser> {
    const existing = await UserModel.exists({ email: input.email });
    if (existing) throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.');
    const passwordHash = await this.hash(input.password);
    try {
      const doc = await UserModel.create({
        name: input.name,
        email: input.email,
        passwordHash,
        lastLoginAt: new Date(),
      });
      return toAuthUser(doc);
    } catch (err) {
      // Two simultaneous registrations can both pass the exists() check; the unique index decides.
      if (isDuplicateKeyError(err)) {
        throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.');
      }
      throw err;
    }
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const doc = await UserModel.findOne({ email }).lean();
    // Always run a bcrypt comparison so response time does not reveal whether the email exists.
    const hash = doc?.passwordHash ?? (this.dummyHash ??= bcrypt.hashSync('hgv-dummy-password', this.config.bcryptCost));
    const ok = await bcrypt.compare(password, hash);
    if (!doc || !ok || doc.status !== 'ACTIVE') {
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.');
    }
    await UserModel.updateOne({ _id: doc._id }, { $set: { lastLoginAt: new Date() } });
    return toAuthUser(doc);
  }

  async updateName(userId: string, name: string): Promise<AuthUser> {
    const doc = await UserModel.findByIdAndUpdate(userId, { $set: { name } }, { returnDocument: 'after' }).lean();
    if (!doc) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
    return toAuthUser(doc);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const doc = await UserModel.findById(userId).lean();
    if (!doc) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
    const ok = await bcrypt.compare(currentPassword, doc.passwordHash);
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Your current password is incorrect.');
    await UserModel.updateOne({ _id: doc._id }, { $set: { passwordHash: await this.hash(newPassword) } });
  }

  signToken(user: AuthUser): string {
    return jwt.sign({ sub: user.id }, this.config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.config.sessionTtlSeconds,
    });
  }

  /**
   * Validates a session token and loads the account. Returns null for any invalid, expired or
   * forged token, or for a disabled/deleted account. Throws only when the database fails.
   */
  async authenticateToken(token: string | undefined): Promise<VerifiedSession | null> {
    if (!token) return null;
    let payload: jwt.JwtPayload;
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret, { algorithms: ['HS256'] });
      if (typeof decoded === 'string') return null;
      payload = decoded;
    } catch {
      return null;
    }
    const sub = payload.sub;
    if (typeof sub !== 'string' || !mongoose.isValidObjectId(sub)) return null;
    const doc = await UserModel.findById(sub).lean();
    if (!doc || doc.status !== 'ACTIVE') return null;
    return { user: toAuthUser(doc), expiresAt: (payload.exp ?? 0) * 1000 };
  }
}
