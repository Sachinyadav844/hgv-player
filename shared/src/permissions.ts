export const ROLES = ['HOST', 'MODERATOR', 'PARTICIPANT'] as const;
export type Role = (typeof ROLES)[number];

/** Roles the Host may hand out with assign_role. HOST is only reachable via transfer_host. */
export const ASSIGNABLE_ROLES = ['MODERATOR', 'PARTICIPANT'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export type Action =
  | 'playback:control' // play, pause, seek
  | 'video:change' // change the current video directly
  | 'request:create' // ask for a change that needs approval
  | 'request:decide' // approve or reject requests
  | 'role:assign'
  | 'participant:remove'
  | 'host:transfer'
  | 'room:close';

export interface PermissionPolicy {
  /** When true, Moderators may approve/reject participant change requests. */
  moderatorsCanDecideRequests: boolean;
}

export const DEFAULT_POLICY: PermissionPolicy = {
  moderatorsCanDecideRequests: true,
};

const HOST_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'playback:control',
  'video:change',
  'request:decide',
  'role:assign',
  'participant:remove',
  'host:transfer',
  'room:close',
]);

const MODERATOR_ACTIONS: ReadonlySet<Action> = new Set<Action>(['playback:control', 'video:change']);

const PARTICIPANT_ACTIONS: ReadonlySet<Action> = new Set<Action>(['request:create']);

/**
 * Single source of truth for the permission matrix. The server enforces it on every
 * sensitive event; the client uses the same function only to decide which controls to show.
 */
export function can(role: Role, action: Action, policy: PermissionPolicy = DEFAULT_POLICY): boolean {
  switch (role) {
    case 'HOST':
      return HOST_ACTIONS.has(action);
    case 'MODERATOR':
      if (action === 'request:decide') return policy.moderatorsCanDecideRequests;
      return MODERATOR_ACTIONS.has(action);
    case 'PARTICIPANT':
      return PARTICIPANT_ACTIONS.has(action);
    default:
      return false;
  }
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}
