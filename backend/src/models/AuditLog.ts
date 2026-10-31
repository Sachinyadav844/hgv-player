import mongoose, { Schema } from 'mongoose';

export type AuditAction =
  | 'ROOM_CREATED'
  | 'ROOM_CLOSED'
  | 'ROLE_ASSIGNED'
  | 'PARTICIPANT_REMOVED'
  | 'VIDEO_CHANGED'
  | 'REQUEST_APPROVED'
  | 'REQUEST_REJECTED'
  | 'HOST_TRANSFERRED';

export interface AuditLogDoc {
  _id: mongoose.Types.ObjectId;
  roomId: string;
  actorId: string;
  action: AuditAction;
  targetId: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    roomId: { type: String, required: true },
    actorId: { type: String, required: true },
    action: { type: String, required: true },
    targetId: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ roomId: 1, createdAt: -1 });

export const AuditLogModel =
  (mongoose.models.AuditLog as mongoose.Model<AuditLogDoc>) ||
  mongoose.model<AuditLogDoc>('AuditLog', auditLogSchema);
