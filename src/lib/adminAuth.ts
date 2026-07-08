/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Admin-roster guard logic for the Admins screen. Pure — unit tested. Mirrors
 * admin-api's removeAdmin (the server-side check is authoritative; this lets
 * the UI disable/explain a blocked action before the round-trip).
 */

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type RemoveAdminBlockReason = 'cannot_remove_self' | 'cannot_remove_last_admin';

export interface RemoveAdminCheck {
  ok: boolean;
  reason?: RemoveAdminBlockReason;
}

/** Can `actorUserId` remove `targetUserId` from the admin roster? */
export function canRemoveAdmin(params: {
  actorUserId: string;
  targetUserId: string;
  totalAdmins: number;
}): RemoveAdminCheck {
  if (params.targetUserId === params.actorUserId) return { ok: false, reason: 'cannot_remove_self' };
  if (params.totalAdmins <= 1) return { ok: false, reason: 'cannot_remove_last_admin' };
  return { ok: true };
}
