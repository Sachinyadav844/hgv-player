import { describe, expect, it } from 'vitest';
import { can, isAssignableRole, isRole, type Action } from '../src/permissions';
import { expectedPosition } from '../src/protocol';
import { extractRoomId, formatRoomCode } from '../src/roomCode';
import { registerSchema, socketSchemas } from '../src/schemas';

const ALL: Action[] = [
  'playback:control',
  'video:change',
  'request:create',
  'request:decide',
  'role:assign',
  'participant:remove',
  'host:transfer',
  'room:close',
];

describe('permission matrix', () => {
  it('Host can do everything except submit requests', () => {
    for (const a of ALL) expect(can('HOST', a)).toBe(a !== 'request:create');
  });

  it('Moderator controls playback and videos only (role/removal are Host-only)', () => {
    expect(can('MODERATOR', 'playback:control')).toBe(true);
    expect(can('MODERATOR', 'video:change')).toBe(true);
    expect(can('MODERATOR', 'role:assign')).toBe(false);
    expect(can('MODERATOR', 'participant:remove')).toBe(false);
    expect(can('MODERATOR', 'host:transfer')).toBe(false);
    expect(can('MODERATOR', 'room:close')).toBe(false);
    expect(can('MODERATOR', 'request:create')).toBe(false);
  });

  it('Moderator may decide requests only when the policy enables it', () => {
    expect(can('MODERATOR', 'request:decide', { moderatorsCanDecideRequests: true })).toBe(true);
    expect(can('MODERATOR', 'request:decide', { moderatorsCanDecideRequests: false })).toBe(false);
  });

  it('Participant can only submit requests', () => {
    for (const a of ALL) expect(can('PARTICIPANT', a)).toBe(a === 'request:create');
  });

  it('unknown roles get nothing', () => {
    // @ts-expect-error deliberately invalid role
    expect(can('ADMIN', 'playback:control')).toBe(false);
  });

  it('role guards', () => {
    expect(isRole('HOST')).toBe(true);
    expect(isRole('host')).toBe(false);
    expect(isAssignableRole('MODERATOR')).toBe(true);
    expect(isAssignableRole('HOST')).toBe(false);
  });
});

describe('expectedPosition', () => {
  const base = { videoId: 'dQw4w9WgXcQ', position: 10, updatedAt: 1_000, version: 1 };
  it('advances while playing', () => {
    expect(expectedPosition({ ...base, playing: true }, 4_000)).toBeCloseTo(13);
  });
  it('is frozen while paused', () => {
    expect(expectedPosition({ ...base, playing: false }, 99_000)).toBe(10);
  });
  it('never goes backwards on clock skew', () => {
    expect(expectedPosition({ ...base, playing: true }, 500)).toBe(10);
  });
});

describe('room codes', () => {
  it('extracts ids from codes and links', () => {
    expect(extractRoomId('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(extractRoomId(' ABCDE FGHJK ')).toBe('ABCDEFGHJK');
    expect(extractRoomId('https://hgv.example.com/room/ABCDEFGHJK')).toBe('ABCDEFGHJK');
    expect(extractRoomId('http://localhost:5173/room/abcdefghjk?x=1')).toBe('ABCDEFGHJK');
  });
  it('rejects invalid codes', () => {
    expect(extractRoomId('')).toBeNull();
    expect(extractRoomId('short')).toBeNull();
    expect(extractRoomId('ABCDEFGHJ0')).toBeNull(); // 0 is not in the alphabet
    expect(extractRoomId('https://x.com/other/ABCDEFGHJK')).toBeNull();
    expect(extractRoomId(123)).toBeNull();
  });
  it('formats for display', () => {
    expect(formatRoomCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
  });
});

describe('schemas', () => {
  it('normalises email and enforces password rules', () => {
    const ok = registerSchema.parse({ name: ' Ada ', email: ' ADA@Example.COM ', password: 'abcdefg1' });
    expect(ok.email).toBe('ada@example.com');
    expect(ok.name).toBe('Ada');
    expect(registerSchema.safeParse({ name: 'Ada', email: 'bad', password: 'abcdefg1' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'Ada', email: 'a@b.co', password: 'short1' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'Ada', email: 'a@b.co', password: 'abcdefghij' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'Ada', email: 'a@b.co', password: 'a1'.repeat(40) }).success).toBe(false);
  });

  it('socket payload schemas reject malformed input', () => {
    const roomId = 'ABCDEFGHJK';
    expect(socketSchemas.position.safeParse({ roomId, position: 12.5 }).success).toBe(true);
    for (const position of [-1, NaN, Infinity, '10', null, 1e12]) {
      expect(socketSchemas.position.safeParse({ roomId, position }).success).toBe(false);
    }
    expect(socketSchemas.position.safeParse({ roomId, position: 1, extra: true }).success).toBe(false);
    expect(socketSchemas.position.safeParse({ roomId: 'nope', position: 1 }).success).toBe(false);
    expect(socketSchemas.assignRole.safeParse({ roomId, userId: 'u1', role: 'HOST' }).success).toBe(false);
    expect(socketSchemas.assignRole.safeParse({ roomId, userId: 'u1', role: 'MODERATOR' }).success).toBe(true);
  });
});
