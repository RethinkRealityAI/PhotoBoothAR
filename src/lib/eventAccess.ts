/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Who may open an event's guest surface.
 *
 * A `draft` event is one the host is still building, and an `ended` one is over
 * — but both were fully open to anyone with the link. A guest who scanned a QR
 * code early could take pictures and post them to a wall the host had not opened
 * yet, and a guest scanning a poster weeks later could post to an event that had
 * finished. Neither is a thing the host asked for.
 *
 * The reason this was not simply gated long ago: hosts test their draft THROUGH
 * the guest booth — the copilot's `test_experience` hands them the real guest
 * URL — so a blunt "drafts are closed" rule would break a shipped path. The
 * distinction that makes both work is not the event's status alone, it is the
 * status TOGETHER with whether the viewer is a member of the event's org.
 *
 * Pure and tested so the rule is one statement rather than a condition smeared
 * across the provider.
 */

/** What the guest surface should do for a given event. */
export type GuestAccess =
  /** Render the booth/wall as normal. */
  | 'open'
  /** Members-only preview of an unopened event — render it, but say so. */
  | 'preview'
  /** Not open to guests yet. */
  | 'not-yet'
  /** Over. */
  | 'ended';

/**
 * `archived` and `ended` are both "over" as far as a guest is concerned; the
 * difference is an operator one (archived is a soft-delete). A member still
 * gets a preview of an ended event so a host can check their own wall.
 */
export function guestAccess(status: string, isMember: boolean): GuestAccess {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'live') return 'open';
  if (s === 'draft') return isMember ? 'preview' : 'not-yet';
  if (s === 'ended' || s === 'archived') return isMember ? 'preview' : 'ended';
  // An unknown status is not a licence to open the doors — a typo or a new
  // status added server-side must not silently expose an event.
  return isMember ? 'preview' : 'not-yet';
}

/** Does this access level render the real guest experience? */
export function accessAllowsBooth(access: GuestAccess): boolean {
  return access === 'open' || access === 'preview';
}

/**
 * Whether the viewer's membership even needs checking. Skipping the round-trip
 * on a live event keeps the common path — a guest scanning a QR at the party —
 * exactly as fast as it was.
 */
export function needsMemberCheck(status: string): boolean {
  return (status ?? '').trim().toLowerCase() !== 'live';
}
