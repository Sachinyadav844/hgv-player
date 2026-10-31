import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env';
import { redact } from '../src/utils/logger';

const GOOD = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/hgv-player',
  JWT_SECRET: 'x'.repeat(40),
  CLIENT_ORIGIN: 'http://localhost:5173',
};

function problemsOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env as NodeJS.ProcessEnv);
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  return [];
}

describe('loadConfig', () => {
  it('accepts a valid development configuration', () => {
    const c = loadConfig(GOOD as NodeJS.ProcessEnv);
    expect(c.port).toBe(4000);
    expect(c.nodeEnv).toBe('development');
    expect(c.cookieSecure).toBe(false);
    expect(c.cookieSameSite).toBe('lax');
    expect(c.clientOrigin).toBe('http://localhost:5173');
  });

  it('accepts optional MongoDB DNS server IP addresses', () => {
    const c = loadConfig({ ...GOOD, MONGODB_DNS_SERVERS: '8.8.8.8, 1.1.1.1' } as NodeJS.ProcessEnv);
    expect(c.mongoDnsServers).toEqual(['8.8.8.8', '1.1.1.1']);
    expect(loadConfig(GOOD as NodeJS.ProcessEnv).mongoDnsServers).toEqual([]);
  });

  it('rejects invalid MongoDB DNS server addresses', () => {
    expect(problemsOf({ ...GOOD, MONGODB_DNS_SERVERS: 'dns.example.com' }).join('\n')).toMatch(
      /MONGODB_DNS_SERVERS must be a comma-separated list of IPv4 or IPv6 addresses/,
    );
  });

  it('explains a missing MongoDB URI without inventing one', () => {
    const problems = problemsOf({ ...GOOD, MONGODB_URI: undefined });
    expect(problems.join('\n')).toMatch(/MONGODB_URI is not set/);
    expect(problems.join('\n')).toMatch(/backend\/\.env/);
  });

  it('rejects a non-MongoDB URI and a weak secret', () => {
    const problems = problemsOf({ ...GOOD, MONGODB_URI: 'postgres://x', JWT_SECRET: 'short' });
    expect(problems.some((p) => /MONGODB_URI must start with/.test(p))).toBe(true);
    expect(problems.some((p) => /JWT_SECRET must be at least 32/.test(p))).toBe(true);
  });

  it('reports every problem at once', () => {
    expect(problemsOf({ PORT: 'abc' }).length).toBeGreaterThanOrEqual(3);
  });

  it('production requires an explicit client origin and uses secure cookies', () => {
    expect(problemsOf({ ...GOOD, NODE_ENV: 'production', CLIENT_ORIGIN: undefined }).join()).toMatch(/CLIENT_ORIGIN is required/);
    const prod = loadConfig({ ...GOOD, NODE_ENV: 'production', CLIENT_ORIGIN: 'https://hgv.example.com/' } as NodeJS.ProcessEnv);
    expect(prod.cookieSecure).toBe(true);
    expect(prod.cookieSameSite).toBe('none');
    expect(prod.trustProxy).toBe(1);
    expect(prod.clientOrigins).toEqual(['https://hgv.example.com']);
  });

  it('refuses insecure production cookies and SameSite=None without Secure', () => {
    expect(problemsOf({ ...GOOD, NODE_ENV: 'production', COOKIE_SECURE: 'false', CLIENT_ORIGIN: 'https://a.com' }).length).toBeGreaterThan(0);
    expect(problemsOf({ ...GOOD, COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' }).join()).toMatch(/requires COOKIE_SECURE/);
  });

  it('supports several client origins', () => {
    const c = loadConfig({ ...GOOD, CLIENT_ORIGIN: 'https://a.com, https://b.com' } as NodeJS.ProcessEnv);
    expect(c.clientOrigins).toEqual(['https://a.com', 'https://b.com']);
    expect(problemsOf({ ...GOOD, CLIENT_ORIGIN: 'not a url' }).join()).toMatch(/invalid URL/);
  });

  it('never echoes secrets in error messages', () => {
    const msg = new ConfigError(problemsOf({ ...GOOD, JWT_SECRET: 'tooshort-secret-value' })).message;
    expect(msg).not.toContain('tooshort-secret-value');
  });
});

describe('redact', () => {
  it('hides credentials in connection strings', () => {
    expect(redact('failed mongodb+srv://admin:hunter2@cluster0.x.mongodb.net/db')).not.toContain('hunter2');
    expect(redact('mongodb://user:pw@host:27017/db')).toBe('mongodb://***@host:27017/db');
  });
});
