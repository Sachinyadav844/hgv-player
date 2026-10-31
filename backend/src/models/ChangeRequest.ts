import mongoose, { Schema } from 'mongoose';
import type { RequestStatus } from '@hgv/shared';

export interface ChangeRequestDoc {
  _id: mongoose.Types.ObjectId;
  requestId: string;
  roomId: string;
  requesterId: string;
  requesterName: string;
  type: 'VIDEO_CHANGE';
  /** Validated payload: the video ID has already been parsed from the submitted URL. */
  payload: { videoId: string };
  status: RequestStatus;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const changeRequestSchema = new Schema<ChangeRequestDoc>(
  {
    requestId: { type: String, required: true },
    roomId: { type: String, required: true },
    requesterId: { type: String, required: true },
    requesterName: { type: String, required: true },
    type: { type: String, enum: ['VIDEO_CHANGE'], required: true },
    payload: {
      videoId: { type: String, required: true, match: /^[A-Za-z0-9_-]{11}$/ },
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
      required: true,
    },
    decidedBy: { type: String, default: null },
    decidedByName: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true },
);

changeRequestSchema.index({ requestId: 1 }, { unique: true });
// Pending-request lookups and history listing per room.
changeRequestSchema.index({ roomId: 1, status: 1, createdAt: -1 });
changeRequestSchema.index({ roomId: 1, requesterId: 1, createdAt: -1 });

export const ChangeRequestModel =
  (mongoose.models.ChangeRequest as mongoose.Model<ChangeRequestDoc>) ||
  mongoose.model<ChangeRequestDoc>('ChangeRequest', changeRequestSchema);
