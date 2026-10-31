import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from '../src/models';
import { CSRF, ORIGIN, hasDb, http, registerUser, startExtraServer, startTestServer, uniqueEmail, type TestServer } from './helpers';

describe.skipIf(!hasDb)('authentication (real MongoDB)', () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterAll(async () => {
    await srv.stop();
  });

  it('registers a user, hashes the password and sets an HttpOnly session cookie', async () => {
    const email = uniqueEmail('reg');
    const res = await http(srv).post('/api/auth/register', { name: 'Ada Lovelace', email: email.toUpperCase(), password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Ada Lovelace', email });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const cookie = res.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/hgv_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const stored = await UserModel.findOne({ email }).lean();
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
    expect(stored?.passwordHash).not.toContain('password123');
  });

  it('rejects duplicate registration, including a different letter case', async () => {
    const email = uniqueEmail('dup');
    const first = await http(srv).post('/api/auth/register', { name: 'First', email, password: 'password123' });
    expect(first.status).toBe(201);
    const second = await http(srv).post('/api/auth/register', { name: 'Second', email: email.toUpperCase(), password: 'password123' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('handles simultaneous duplicate registrations: exactly one wins', async () => {
    const email = uniqueEmail('race');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => http(srv).post('/api/auth/register', { name: 'Racer', email, password: 'password123' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await UserModel.countDocuments({ email })).toBe(1);
  });

  it.each([
    [{ name: 'A', email: 'a@b.co', password: 'password123' }, 'name'],
    [{ name: 'Ada', email: 'not-an-email', password: 'password123' }, 'email'],
    [{ name: 'Ada', email: 'a@b.co', password: 'short' }, 'password'],
    [{ name: 'Ada', email: 'a@b.co', password: 'onlyletters' }, 'password'],
    [{}, 'name'],
  ])('rejects invalid registration input %#', async (body, field) => {
    const res = await http(srv).post('/api/auth/register', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain(field);
  });

  it('logs in with correct credentials (email is case-insensitive)', async () => {
    const user = await registerUser(srv, 'Grace');
    const res = await http(srv).post('/api/auth/login', { email: user.email.toUpperCase(), password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.headers['set-cookie']![0]).toMatch(/hgv_session=/);
    const stored = await UserModel.findById(user.id).lean();
    expect(stored?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong password and an unknown email with the same generic error', async () => {
    const user = await registerUser(srv);
    const wrong = await http(srv).post('/api/auth/login', { email: user.email, password: 'wrongpass1' });
    const unknown = await http(srv).post('/api/auth/login', { email: uniqueEmail('ghost'), password: 'password123' });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('returns the current user for /me and 401 without a session', async () => {
    const user = await registerUser(srv, 'Linus');
    const me = await http(srv, user).get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ id: user.id, name: 'Linus', email: user.email });
    const anon = await http(srv).get('/api/auth/me');
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout clears the cookie', async () => {
    const user = await registerUser(srv);
    const res = await http(srv, user).post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']![0]).toMatch(/hgv_session=;/);
  });

  it('rejects forged, expired, wrong-algorithm and garbage tokens', async () => {
    const user = await registerUser(srv);
    const bad: Record<string, string> = {
      forged: jwt.sign({ sub: user.id }, 'some-other-secret-some-other-secret-12'),
      expired: jwt.sign({ sub: user.id }, srv.config.jwtSecret, { expiresIn: -10 }),
      none: `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id })).toString('base64url')}.`,
      garbage: 'not-a-token',
      unknownUser: jwt.sign({ sub: '64b7f0f0f0f0f0f0f0f0f0f0' }, srv.config.jwtSecret),
      badSub: jwt.sign({ sub: 'nope' }, srv.config.jwtSecret),
    };
    for (const [label, token] of Object.entries(bad)) {
      const res = await http(srv).get('/api/auth/me').set('Cookie', `hgv_session=${token}`);
      expect(res.status, label).toBe(401);
    }
  });

  it('rejects a session whose account has been disabled', async () => {
    const user = await registerUser(srv);
    await UserModel.updateOne({ _id: user.id }, { $set: { status: 'DISABLED' } });
    expect((await http(srv, user).get('/api/auth/me')).status).toBe(401);
    const login = await http(srv).post('/api/auth/login', { email: user.email, password: user.password });
    expect(login.status).toBe(401);
  });

  it('users only ever see their own account data', async () => {
    const a = await registerUser(srv, 'Alice');
    const b = await registerUser(srv, 'Bob');
    const meA = await http(srv, a).get('/api/auth/me');
    const meB = await http(srv, b).get('/api/auth/me');
    expect(meA.body.user.email).toBe(a.email);
    expect(meB.body.user.email).toBe(b.email);
    const rename = await http(srv, a).patch('/api/auth/me', { name: 'Alice Renamed' });
    expect(rename.body.user.name).toBe('Alice Renamed');
    expect((await http(srv, b).get('/api/auth/me')).body.user.name).toBe('Bob');
  });

  it('changes password only with the correct current password', async () => {
    const user = await registerUser(srv);
    const bad = await http(srv, user).post('/api/auth/password', { currentPassword: 'wrongpass1', newPassword: 'newpassword1' });
    expect(bad.status).toBe(401);
    const ok = await http(srv, user).post('/api/auth/password', { currentPassword: user.password, newPassword: 'newpassword1' });
    expect(ok.status).toBe(204);
    expect((await http(srv).post('/api/auth/login', { email: user.email, password: user.password })).status).toBe(401);
    expect((await http(srv).post('/api/auth/login', { email: user.email, password: 'newpassword1' })).status).toBe(200);
  });

  describe('request protection', () => {
    it('refuses state-changing requests without the CSRF header', async () => {
      const res = await http(srv).post('/api/auth/login', { email: 'a@b.co', password: 'x' }).unset('X-Requested-With');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('refuses state-changing requests from a foreign Origin', async () => {
      const res = await http(srv).post('/api/auth/login', { email: 'a@b.co', password: 'x' }).set('Origin', 'https://evil.example');
      expect(res.status).toBe(403);
    });

    it('allows the configured origin and answers CORS with credentials', async () => {
      const res = await http(srv).get('/health').set('Origin', ORIGIN);
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      const evil = await http(srv).get('/health').set('Origin', 'https://evil.example');
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('sends security headers and hides the framework', async () => {
      const res = await http(srv).get('/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('rejects malformed JSON and oversized bodies without leaking internals', async () => {
      const bad = await http(srv)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      const big = await http(srv).post('/api/auth/login', { email: 'a@b.co', password: 'x'.repeat(20_000) });
      expect(big.status).toBe(413);
      expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.(js|ts)/);
    });

    it('returns a JSON 404 for unknown routes', async () => {
      const res = await http(srv).get('/api/nope');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('rate limiting', () => {
    it('limits repeated login attempts with a 429', async () => {
      const limited = await startExtraServer({
        rateLimit: { ...srv.config.rateLimit, authMax: 3 },
      });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) {
          const res = await fetch(`${limited.url}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...CSRF },
            body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever1' }),
          });
          statuses.push(res.status);
        }
        expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
        expect(statuses.slice(3)).toEqual([429, 429]);
      } finally {
        await limited.stop();
      }
    });
  });
});
