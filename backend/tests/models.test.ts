import type { Document } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AllModels, ChangeRequestModel, ParticipantModel, RoomModel, UserModel } from '../src/models';

// These checks need no database: they validate schema rules and declared indexes in memory.

async function errorsOf(doc: Document): Promise<Record<string, unknown> | undefined> {
  try {
    await doc.validate();
    return undefined;
  } catch (err) {
    return (err as { errors: Record<string, unknown> }).errors;
  }
}

const indexSpecs = (m: { schema: { indexes(): [Record<string, unknown>, Record<string, unknown>][] } }) =>
  m.schema.indexes().map(([fields, opts]) => ({ fields, unique: Boolean(opts.unique) }));

describe('Mongoose schemas', () => {
  it('User requires fields, lower-cases email and has a unique email index', async () => {
    expect(await errorsOf(new UserModel({}))).toMatchObject({
      name: expect.anything(),
      email: expect.anything(),
      passwordHash: expect.anything(),
    });
    const u = new UserModel({ name: 'Ada', email: '  ADA@Example.com ', passwordHash: 'x' });
    expect(u.email).toBe('ada@example.com');
    expect(u.status).toBe('ACTIVE');
    expect(indexSpecs(UserModel)).toContainEqual({ fields: { email: 1 }, unique: true });
  });

  it('Room validates the public room ID and video ID, and has a unique roomId index', async () => {
    const base = { name: 'Room', ownerId: 'u1', hostId: 'u1' };
    expect((await errorsOf(new RoomModel({ ...base, roomId: 'bad' })))?.roomId).toBeDefined();
    expect((await errorsOf(new RoomModel({ ...base, roomId: 'ABCDEFGHJK', videoId: 'x' })))?.videoId).toBeDefined();
    expect(await errorsOf(new RoomModel({ ...base, roomId: 'ABCDEFGHJK' }))).toBeUndefined();
    expect(indexSpecs(RoomModel)).toContainEqual({ fields: { roomId: 1 }, unique: true });
  });

  it('Participant restricts role and status and is unique per room and user', async () => {
    const base = { roomId: 'ABCDEFGHJK', userId: 'u1', displayName: 'Ada' };
    expect((await errorsOf(new ParticipantModel({ ...base, role: 'ADMIN' })))?.role).toBeDefined();
    expect((await errorsOf(new ParticipantModel({ ...base, status: 'GONE' })))?.status).toBeDefined();
    expect(new ParticipantModel(base).role).toBe('PARTICIPANT');
    expect(indexSpecs(ParticipantModel)).toContainEqual({ fields: { roomId: 1, userId: 1 }, unique: true });
  });

  it('ChangeRequest defaults to PENDING, validates the video ID and indexes pending lookups', async () => {
    const base = { requestId: 'r-1', roomId: 'ABCDEFGHJK', requesterId: 'u1', requesterName: 'Ada', type: 'VIDEO_CHANGE' };
    const doc = new ChangeRequestModel({ ...base, payload: { videoId: 'dQw4w9WgXcQ' } });
    expect(doc.status).toBe('PENDING');
    expect((await errorsOf(new ChangeRequestModel({ ...base, payload: { videoId: 'bad' } })))?.['payload.videoId']).toBeDefined();
    const specs = indexSpecs(ChangeRequestModel);
    expect(specs).toContainEqual({ fields: { requestId: 1 }, unique: true });
    expect(specs).toContainEqual({ fields: { roomId: 1, status: 1, createdAt: -1 }, unique: false });
  });

  it('registers all five collections', () => {
    expect(AllModels.map((m) => m.modelName).sort()).toEqual(
      ['AuditLog', 'ChangeRequest', 'Participant', 'Room', 'User'],
    );
  });
});
