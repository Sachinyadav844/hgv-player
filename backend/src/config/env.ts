import { DEFAULT_POLICY, type PermissionPolicy } from '@hgv/shared';
import { isIP } from 'node:net';

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid server configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'Copy backend/.env.example to backend/.env and fill in the values.',
    );
    this.name = 'ConfigError';
  }
}

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  mongoUri: string;
  mongoDnsServers: string[];
  jwtSecret: string;
  /** Allowed browser origins (no trailing slash). The first one is used for invite links. */
  clientOrigins: string[];
  clientOrigin: string;
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  trustProxy: number;
  bcryptCost: number;
  sessionTtlSeconds: number;
  idleRoomHours: number;
  policy: PermissionPolicy;
  rateLimit: {
    authWindowMs: number;
    authMax: number;
    apiWindowMs: number;
    apiMax: number;
    createRoomWindowMs: number;
    createRoomMax: number;
  };
  /** Maximum socket events one connection may send per second. */
  socketEventsPerSecond: number;
}

function parseOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function parseIntStrict(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
}

/**
 * Reads and validates configuration. Every problem is collected so the developer sees all of
 * them at once. Nothing here is logged, so secrets never reach the console.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const rawEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(rawEnv)) {
    problems.push(`NODE_ENV must be development, test or production (got "${rawEnv}").`);
  }
  const nodeEnv = (['development', 'test', 'production'].includes(rawEnv)
    ? rawEnv
    : 'development') as Config['nodeEnv'];
  const isProd = nodeEnv === 'production';

  const port = parseIntStrict(env.PORT) ?? 4000;
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    problems.push('PORT must be an integer between 1 and 65535.');
  }

  const mongoUri = (env.MONGODB_URI ?? '').trim();
  if (!mongoUri) {
    problems.push(
      'MONGODB_URI is not set. Put your MongoDB connection string in backend/.env ' +
        '(for example mongodb://127.0.0.1:27017/hgv-player or a MongoDB Atlas mongodb+srv:// URI).',
    );
  } else if (!/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
    problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://.');
  }

  const mongoDnsServersRaw = (env.MONGODB_DNS_SERVERS ?? '').trim();
  const mongoDnsServers = mongoDnsServersRaw ? mongoDnsServersRaw.split(',').map((server) => server.trim()) : [];
  if (mongoDnsServers.some((server) => isIP(server) === 0)) {
    problems.push('MONGODB_DNS_SERVERS must be a comma-separated list of IPv4 or IPv6 addresses.');
  }

  const jwtSecret = env.JWT_SECRET ?? '';
  if (!jwtSecret) {
    problems.push(
      'JWT_SECRET is not set. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
    );
  } else if (jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters long.');
  }

  const originSource = (env.CLIENT_ORIGIN ?? '').trim();
  let clientOrigins: string[] = [];
  if (!originSource) {
    if (isProd) {
      problems.push('CLIENT_ORIGIN is required in production (the public URL of the frontend).');
    } else {
      clientOrigins = ['http://localhost:5173'];
    }
  } else {
    for (const part of originSource.split(',')) {
      const origin = parseOrigin(part);
      if (!origin) problems.push(`CLIENT_ORIGIN contains an invalid URL: "${part.trim()}".`);
      else clientOrigins.push(origin);
    }
  }

  const sameSiteRaw = (env.COOKIE_SAMESITE ?? (isProd ? 'none' : 'lax')).toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSiteRaw)) {
    problems.push('COOKIE_SAMESITE must be lax, strict or none.');
  }
  const cookieSameSite = (['lax', 'strict', 'none'].includes(sameSiteRaw)
    ? sameSiteRaw
    : 'lax') as Config['cookieSameSite'];
  const cookieSecure = parseBool(env.COOKIE_SECURE) ?? isProd;
  if (cookieSameSite === 'none' && !cookieSecure) {
    problems.push('COOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers reject it otherwise).');
  }
  if (isProd && !cookieSecure) {
    problems.push('COOKIE_SECURE must be true in production.');
  }

  const trustProxy = parseIntStrict(env.TRUST_PROXY) ?? (isProd ? 1 : 0);
  if (Number.isNaN(trustProxy)) problems.push('TRUST_PROXY must be a non-negative integer.');

  const bcryptCost = parseIntStrict(env.BCRYPT_COST) ?? 12;
  if (Number.isNaN(bcryptCost) || bcryptCost < 4 || bcryptCost > 15) {
    problems.push('BCRYPT_COST must be an integer between 4 and 15.');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv,
    port,
    mongoUri,
    mongoDnsServers,
    jwtSecret,
    clientOrigins,
    clientOrigin: clientOrigins[0]!,
    cookieSecure,
    cookieSameSite,
    trustProxy,
    bcryptCost,
    sessionTtlSeconds: 7 * 24 * 60 * 60,
    idleRoomHours: 48,
    policy: { ...DEFAULT_POLICY },
    rateLimit: {
      authWindowMs: 15 * 60 * 1000,
      authMax: 30,
      apiWindowMs: 60 * 1000,
      apiMax: 300,
      createRoomWindowMs: 60 * 60 * 1000,
      createRoomMax: 30,
    },
    socketEventsPerSecond: 30,
  };
}
