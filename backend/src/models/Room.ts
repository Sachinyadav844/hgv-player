import mongoose, { Schema } from 'mongoose';
import { ROOM_ID_REGEX, type RoomStatus } from '@hgv/shared';

export interface RoomDoc {
  _id: mongoose.Types.ObjectId;
  /** Public, unpredictable identifier used in invite links. Never the Mongo _id. */
  roomId: string;
  name: string;
  /** The user who created the room. */
  ownerId: string;
  /** The current Host. Starts as the owner and changes on host transfer. */
  hostId: string;
  status: RoomStatus;
  videoId: string | null;
  playing: boolean;
  /** Last persisted playback position (seconds). */
  position: number;
  positionUpdatedAt: Date;
  /** Monotonic counter. Persisted state is only overwritten by a higher version. */
  version: number;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const roomSchema = new Schema<RoomDoc>(
  {
    roomId: { type: String, required: true, match: ROOM_ID_REGEX },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    ownerId: { type: String, required: true },
    hostId: { type: String, required: true },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN', required: true },
    videoId: { type: String, default: null, match: /^[A-Za-z0-9_-]{11}$/ },
    playing: { type: Boolean, default: false },
    position: { type: Number, default: 0, min: 0 },
    positionUpdatedAt: { type: Date, default: () => new Date() },
    version: { type: Number, default: 0, min: 0 },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

roomSchema.index({ roomId: 1 }, { unique: true });
// Used by the idle-room sweeper.
roomSchema.index({ status: 1, updatedAt: 1 });
roomSchema.index({ ownerId: 1, createdAt: -1 });

export const RoomModel =
  (mongoose.models.Room as mongoose.Model<RoomDoc>) || mongoose.model<RoomDoc>('Room', roomSchema);
