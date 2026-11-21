/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * keepsakeEditor — the pure rules behind the host's Keepsake editor
 * (src/pages/host/keepsake/KeepsakeEditor.tsx). The component only wires
 * these; every decision a host can trip over is tested here in vitest's node
 * env.
 *
 * PURE: no React, no DOM, no supabase.
 */
import {
  DEFAULT_KEEPSAKE_SETTINGS,
  KEEPSAKE_COPY_MAX,
  KEEPSAKE_DOWNLOAD_IDS,
  type KeepsakeCopy,
  type KeepsakeCopyContext,
  type KeepsakeDownloadId,
  type KeepsakeSettings,
} from './keepsakeSettings';

/* ── Copy tokens ─────────────────────────────────────────────────── */

export interface KeepsakeTokenChip {
  token: '{event}' | '{photos}' | '{guests}' | '{when}' | '{host}';
  label: string;
}

/** The chips a host taps to drop a live value into their greeting. Labels are
 *  plain words; the braces are what fillKeepsakeCopy replaces. */
export const KEEPSAKE_TOKEN_CHIPS: readonly KeepsakeTokenChip[] = [
  { token: '{event}', label: 'Event name' },
  { token: '{photos}', label: 'Photo count' },
  { token: '{guests}', label: 'Guest count' },
  { token: '{when}', label: 'Day' },
  { token: '{host}', label: 'Host' },
];

export type KeepsakeCopyField = keyof KeepsakeCopy;

/**
 * Put `token` into `value` at the caret, replacing any selection. Returns null
 * when the result would pass the field's limit — the chip is then disabled
 * rather than silently truncating what the host already wrote.
 */
export function insertToken(
  value: string,
  token: string,
  selStart: number | null,
  selEnd: number | null,
  max: number,
): { value: string; caret: number } | null {
  const len = value.length;
  const clamp = (n: number | null, dflt: number) =>
    n === null || !Number.isFinite(n) ? dflt : Math.max(0, Math.min(len, Math.floor(n)));
  const start = clamp(selStart, len);
  const end = Math.max(start, clamp(selEnd, start));
  const next = value.slice(0, start) + token + value.slice(end);
  if (next.length > max) return null;
  return { value: next, caret: start + token.length };
}

/** "12 / 80", and whether to warn (within 10% of the limit). */
export function copyCounter(value: string, max: number): { text: string; near: boolean } {
  return { text: `${value.length} / ${max}`, near: value.length >= Math.floor(max * 0.9) };
}

/* ── Downloads ───────────────────────────────────────────────────── */

/** The last download left on cannot be switched off: an album with nothing to
 *  take home is never what a host meant (normalizeKeepsakeSettings enforces the
 *  same rule on read). */
export function isLastDownloadOn(downloads: Record<KeepsakeDownloadId, boolean>, id: KeepsakeDownloadId): boolean {
  return downloads[id] && KEEPSAKE_DOWNLOAD_IDS.filter((d) => downloads[d]).length === 1;
}

export function toggleDownload(
  downloads: Record<KeepsakeDownloadId, boolean>,
  id: KeepsakeDownloadId,
): Record<KeepsakeDownloadId, boolean> {
  if (isLastDownloadOn(downloads, id)) return downloads;
  return { ...downloads, [id]: !downloads[id] };
}

/* ── Host name prefill ───────────────────────────────────────────── */

/**
 * The public album page cannot read org names (orgs is member-only), so an
 * empty signer would print "your host". When the stored name is empty, offer
 * the org's name in the field — the host still has to Save it.
 */
export function prefillHostName(settings: KeepsakeSettings, orgName: string | null): KeepsakeSettings {
  if (settings.copy.hostName.trim() !== '' || orgName === null) return settings;
  const name = orgName.trim().slice(0, KEEPSAKE_COPY_MAX.hostName);
  if (name === '') return settings;
  return { ...settings, copy: { ...settings.copy, hostName: name } };
}

/** Defaults for the look and the words, keeping the delivery switch where the
 *  host left it (Reset is about how the keepsake looks, not whether it goes). */
export function resetKeepsakeLook(current: KeepsakeSettings, orgName: string | null): KeepsakeSettings {
  return prefillHostName({ ...DEFAULT_KEEPSAKE_SETTINGS, autoSend: current.autoSend }, orgName);
}

/* ── Dirty check ─────────────────────────────────────────────────── */

/** Structural equality over the closed settings shape (key order irrelevant). */
export function keepsakeSettingsEqual(a: KeepsakeSettings, b: KeepsakeSettings): boolean {
  if (a.autoSend !== b.autoSend || a.theme !== b.theme || a.reveal !== b.reveal || a.music !== b.music || a.beamy !== b.beamy) return false;
  for (const d of KEEPSAKE_DOWNLOAD_IDS) if (a.downloads[d] !== b.downloads[d]) return false;
  const fields: KeepsakeCopyField[] = ['headline', 'message', 'signOff', 'hostName'];
  return fields.every((f) => a.copy[f] === b.copy[f]);
}

/* ── Preview context ─────────────────────────────────────────────── */

/** Believable numbers for the live preview, dated "yesterday" so {when} shows
 *  what a guest reads the morning after. */
export function sampleCopyContext(eventName: string, orgName: string, now: number): KeepsakeCopyContext {
  return {
    eventName,
    photos: 128,
    guests: 46,
    eventDate: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    now,
    orgName,
  };
}
