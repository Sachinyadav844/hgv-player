import { randomInt, randomUUID } from 'node:crypto';
import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from '@hgv/shared';

/** 10 characters from a 32-symbol alphabet (~50 bits) using a CSPRNG. */
export function generateRoomId(): string {
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)];
  }
  return id;
}

export function newRequestId(): string {
  return randomUUID();
}
