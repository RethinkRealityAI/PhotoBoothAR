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
  KEEPSAKE_REVEAL_IDS,
  fillKeepsakeCopy,
  keepsakeTheme,
  type KeepsakeCopy,
  type KeepsakeCopyContext,
  type KeepsakeDownloadId,
  type KeepsakeRevealId,
  type KeepsakeSettings,
} from './keepsakeSettings';
import { keepsakeTrack } from './keepsakeMusic';
import { CARD_REVEAL_OPTIONS } from './cardPresentation';

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

/* ── Tabs (one group of settings on screen at a time) ────────────── */

export type KeepsakeTabId = 'look' | 'greeting' | 'takehome' | 'music' | 'sending';

export interface KeepsakeTab {
  id: KeepsakeTabId;
  label: string;
  /** One line under the tab's options, saying what this group decides. */
  hint: string;
}

/** The editor's tabs in order. In the wizard they are the steps, in this order. */
export const KEEPSAKE_TABS: readonly KeepsakeTab[] = [
  { id: 'look', label: 'Look', hint: 'The album’s colours and the moment it opens with.' },
  { id: 'greeting', label: 'Greeting', hint: 'What Beamy says at the top of the album.' },
  { id: 'takehome', label: 'Take-home', hint: 'What guests can save from the album.' },
  { id: 'music', label: 'Music', hint: 'Plays under the keepsake film.' },
  { id: 'sending', label: 'Sending', hint: 'When the album reaches your guests.' },
];

export const KEEPSAKE_TAB_IDS: readonly KeepsakeTabId[] = KEEPSAKE_TABS.map((t) => t.id);

/** Whether one tab's own settings differ between what is saved and the draft.
 *  Every settings field belongs to exactly one tab (tested), so a dirty
 *  editor always shows a dot on at least one tab. */
export function keepsakeTabDirty(stored: KeepsakeSettings, draft: KeepsakeSettings, tab: KeepsakeTabId): boolean {
  switch (tab) {
    case 'look':
      return stored.theme !== draft.theme || stored.reveal !== draft.reveal;
    case 'greeting': {
      const fields: KeepsakeCopyField[] = ['headline', 'message', 'signOff', 'hostName'];
      return stored.beamy !== draft.beamy || fields.some((f) => stored.copy[f] !== draft.copy[f]);
    }
    case 'takehome':
      return KEEPSAKE_DOWNLOAD_IDS.some((d) => stored.downloads[d] !== draft.downloads[d]);
    case 'music':
      return stored.music !== draft.music;
    case 'sending':
      return stored.autoSend !== draft.autoSend;
  }
}

/** The tabs with unsaved changes, in tab order. */
export function dirtyKeepsakeTabs(stored: KeepsakeSettings, draft: KeepsakeSettings): KeepsakeTabId[] {
  return KEEPSAKE_TAB_IDS.filter((t) => keepsakeTabDirty(stored, draft, t));
}

/** Arrow-key movement across the tablist (WAI-ARIA tabs pattern): Left/Right
 *  (and Up/Down) wrap around, Home/End jump to the ends. Any other key → null. */
export function keepsakeTabForKey(current: KeepsakeTabId, key: string): KeepsakeTabId | null {
  return idForKey(KEEPSAKE_TAB_IDS, current, key);
}

function idForKey<T>(ids: readonly T[], current: T, key: string): T | null {
  const i = Math.max(0, ids.indexOf(current));
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return ids[(i + 1) % ids.length];
    case 'ArrowLeft':
    case 'ArrowUp':
      return ids[(i - 1 + ids.length) % ids.length];
    case 'Home':
      return ids[0];
    case 'End':
      return ids[ids.length - 1];
    default:
      return null;
  }
}

/** Where a tab sits as a wizard step: "Step 2 of 5", and its neighbours
 *  (null at either end — no wrap, unlike the arrow keys). */
export function keepsakeStep(tab: KeepsakeTabId): { number: number; total: number; prev: KeepsakeTabId | null; next: KeepsakeTabId | null } {
  const ids = KEEPSAKE_TAB_IDS;
  const i = Math.max(0, ids.indexOf(tab));
  return {
    number: i + 1,
    total: ids.length,
    prev: i > 0 ? ids[i - 1] : null,
    next: i < ids.length - 1 ? ids[i + 1] : null,
  };
}

/* ── Guided steps (owner, 2026-11-21: "they go forward and they know
      they've checked whatever") ─────────────────────────────────────
   The first time a host opens the editor it walks them through every tab in
   order, then a Review. Once every step has been seen, the step bar becomes
   free tabs. The wizard is first-time setup, so it is always guided. */

/** A step of the editor: the five tabs, then Review. */
export type KeepsakeStepId = KeepsakeTabId | 'review';

export interface KeepsakeStep {
  id: KeepsakeStepId;
  label: string;
  hint: string;
}

export const KEEPSAKE_REVIEW_STEP: KeepsakeStep = {
  id: 'review',
  label: 'Review',
  hint: 'Everything you chose, in one place. Change any step, then press Save.',
};

/** The steps in order: the five tabs, then Review. */
export const KEEPSAKE_STEPS: readonly KeepsakeStep[] = [...KEEPSAKE_TABS, KEEPSAKE_REVIEW_STEP];
export const KEEPSAKE_STEP_IDS: readonly KeepsakeStepId[] = KEEPSAKE_STEPS.map((s) => s.id);

export function keepsakeStepLabel(id: KeepsakeStepId): string {
  return KEEPSAKE_STEPS.find((s) => s.id === id)?.label ?? '';
}

/** 'guided' = one step after another, only steps already seen can be clicked.
 *  'free' = the same bar as ordinary tabs. */
export type KeepsakeEditorMode = 'guided' | 'free';

export function keepsakeAllStepsSeen(seen: readonly KeepsakeStepId[]): boolean {
  return KEEPSAKE_STEP_IDS.every((s) => seen.includes(s));
}

/** The wizard is always guided; Share & Print is guided until every step has been seen. */
export function keepsakeEditorMode(variant: 'panel' | 'wizard', seen: readonly KeepsakeStepId[]): KeepsakeEditorMode {
  if (variant === 'wizard') return 'guided';
  return keepsakeAllStepsSeen(seen) ? 'free' : 'guided';
}

/** Add a step to the seen list, in step order, without duplicates. Returns the
 *  same array when the step was already seen (no needless re-render). */
export function markKeepsakeStepSeen(seen: readonly KeepsakeStepId[], step: KeepsakeStepId): readonly KeepsakeStepId[] {
  if (seen.includes(step)) return seen;
  return KEEPSAKE_STEP_IDS.filter((s) => s === step || seen.includes(s));
}

/** Can the host click this step in the bar? Guided: only steps already seen
 *  (going back is always fine; going ahead is what Next is for). Free: any. */
export function keepsakeStepReachable(step: KeepsakeStepId, seen: readonly KeepsakeStepId[], mode: KeepsakeEditorMode): boolean {
  return mode === 'free' || seen.includes(step);
}

/** Back/Next targets for a step (no wrap). Sending's Next is Review; Review has none. */
export function keepsakeStepNav(step: KeepsakeStepId): { prev: KeepsakeStepId | null; next: KeepsakeStepId | null } {
  const ids = KEEPSAKE_STEP_IDS;
  const i = Math.max(0, ids.indexOf(step));
  return { prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null };
}

/** Arrow keys across the free-mode tabs, Review included (same rules as keepsakeTabForKey). */
export function keepsakeStepForKey(current: KeepsakeStepId, key: string): KeepsakeStepId | null {
  return idForKey(KEEPSAKE_STEP_IDS, current, key);
}

/** Where "seen every step" is remembered, per event, on this device. */
export function keepsakeSeenStorageKey(eventUuid: string): string {
  return `bw.keepsakeEditor.seen.${eventUuid}`;
}

/** The value stored under keepsakeSeenStorageKey once every step has been seen. */
export const KEEPSAKE_SEEN_ALL = 'all';

/** The seen list to start from, given what storage held (null = nothing, or
 *  storage threw). Anything but the exact flag starts guided on step one. */
export function keepsakeSeenFromStorage(raw: string | null): readonly KeepsakeStepId[] {
  return raw === KEEPSAKE_SEEN_ALL ? KEEPSAKE_STEP_IDS : ['look'];
}

/* ── Review ──────────────────────────────────────────────────────── */

export interface KeepsakeReviewRow {
  step: KeepsakeTabId;
  label: string;
  /** One plain line saying what the host chose. */
  value: string;
}

const DOWNLOAD_LABEL: Record<KeepsakeDownloadId, string> = { film: 'Film', collage: 'Collage', photos: 'Photos' };
const REVIEW_HEADLINE_MAX = 60;

/** "A", "A and B", "A, B and C". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** One row per tab for the Review step, in tab order. `ctx` fills the
 *  headline's tokens the way the live preview does. */
export function keepsakeReviewRows(settings: KeepsakeSettings, ctx: KeepsakeCopyContext, filmIncluded: boolean | null): KeepsakeReviewRow[] {
  const theme = keepsakeTheme(settings.theme);
  const reveal = keepsakeRevealChoice(settings.reveal);
  const headline = fillKeepsakeCopy(settings.copy.headline, ctx, settings.copy.hostName).trim();
  const downloads = KEEPSAKE_DOWNLOAD_IDS.filter((d) => settings.downloads[d]).map((d) =>
    d === 'film' && filmIncluded === false ? 'Film (after you upgrade)' : DOWNLOAD_LABEL[d],
  );
  const track = keepsakeTrack(settings.music);
  const value: Record<KeepsakeTabId, string> = {
    look: `${theme.label} colours · ${reveal.id === 'none' ? 'no opening moment' : `opens with ${reveal.label}`}`,
    greeting: !settings.beamy
      ? 'Beamy’s greeting is off'
      : headline === ''
        ? 'Beamy says hello · no headline yet'
        : `Beamy says hello · “${clip(headline, REVIEW_HEADLINE_MAX)}”`,
    takehome: downloads.length > 0 ? listWords(downloads) : 'Nothing to take home',
    music: track !== null ? track.title : 'No music',
    sending: settings.autoSend ? 'Emailed to guests the morning after' : 'Off · only when you press Send keepsakes now',
  };
  return KEEPSAKE_TABS.map((t) => ({ step: t.id, label: t.label, value: value[t.id] }));
}

/* ── Reveal choices ──────────────────────────────────────────────── */

export interface KeepsakeRevealChoice {
  id: KeepsakeRevealId;
  label: string;
  description: string;
}

/**
 * The tap-to-open moments a host picks from, in KEEPSAKE_REVEAL_IDS order.
 * The card reveals keep the words hosts already know from keepsake cards
 * (CARD_REVEAL_OPTIONS); only 'beam' (Beamwall's own) and 'none' read
 * differently here, because the thing that opens is an album, not a card.
 */
export const KEEPSAKE_REVEAL_CHOICES: readonly KeepsakeRevealChoice[] = KEEPSAKE_REVEAL_IDS.map((id) => {
  if (id === 'beam') {
    return { id, label: 'Beamwall beam', description: 'A beam of light sweeps across and the album opens in its glow.' };
  }
  if (id === 'none') {
    return { id, label: 'Straight to the album', description: 'No opening moment. The photos are on screen the second the link opens.' };
  }
  const card = CARD_REVEAL_OPTIONS.find((o) => o.id === id);
  return { id, label: card?.label ?? id, description: card?.description ?? '' };
});

export function keepsakeRevealChoice(id: KeepsakeRevealId): KeepsakeRevealChoice {
  return KEEPSAKE_REVEAL_CHOICES.find((c) => c.id === id) ?? KEEPSAKE_REVEAL_CHOICES[0];
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
