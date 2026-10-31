import mongoose, { Schema } from 'mongoose';
import { ROLES, type Role } from '@hgv/shared';

export type ParticipantStatus = 'ACTIVE' | 'LEFT' | 'REMOVED';

export interface ParticipantDoc {
  _id: mongoose.Types.ObjectId;
  roomId: string;
  /** Account identity. Socket IDs are never stored as identity. */
  userId: string;
  displayName: string;
  role: Role;
  status: ParticipantStatus;
  joinedAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const participantSchema = new Schema<ParticipantDoc>(
  {
    roomId: { type: String, required: true },
    userId: { type: String, required: true },
    displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
    role: { type: String, enum: ROLES, default: 'PARTICIPANT', required: true },
    status: { type: String, enum: ['ACTIVE', 'LEFT', 'REMOVED'], default: 'ACTIVE', required: true },
    joinedAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

// One membership document per (room, user). REMOVED documents double as the room ban list.
participantSchema.index({ roomId: 1, userId: 1 }, { unique: true });
participantSchema.index({ roomId: 1, status: 1 });
participantSchema.index({ userId: 1, status: 1 });
// Used by the stale-participant sweeper.
participantSchema.index({ status: 1, lastSeenAt: 1 });

export const ParticipantModel =
  (mongoose.models.Participant as mongoose.Model<ParticipantDoc>) ||
  mongoose.model<ParticipantDoc>('Participant', participantSchema);
