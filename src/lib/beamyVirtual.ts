/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyVirtual — the homepage's "Celebrate from anywhere" section: its copy,
 * the people and messages its scene shows, and the order the scene plays in.
 * Pure, DOM-free, tested in node (beamyVirtual.test.ts). The scene itself is
 * DOM (pages/beamy/VirtualCelebrations.tsx).
 *
 * WHAT SHIPS TODAY (checked against the code, so the page only promises it):
 *   • A host creates a card for one person and shares its contribution link
 *     (/c/<publicId>/contribute?t=<token>, pages/cards/CardContribute.tsx).
 *   • Anyone with the link adds a NOTE, a PHOTO or a SHORT VIDEO (recorded in
 *     the browser, up to 20s, or uploaded). Recording uses CaptureSurface — a
 *     plain camera, deliberately NOT the AR booth — so this copy never says
 *     "booth", filters or props.
 *   • Publishing makes the card viewable at /c/<publicId>; the host can then
 *     press "Email recipient" (card-publish `send_email`). That is a HOST
 *     action: there is no send date on `cards` (migration 007), no scheduler,
 *     no cron job for cards, and the email needs RESEND_API_KEY (absent →
 *     503 email_not_configured). The host can always share the card link.
 *   • Publishing / emailing a card needs a Premium event (or org Pro).
 *   • Everything is digital.
 *
 * So the copy says the HOST sends it on the big day. AUTO_DELIVERY is the
 * switch the test reads: flip it only when timed delivery really ships.
 */
import { sequence, type Sequence } from './beamyMotion';

/** Does the platform deliver a card on its own (a set date, a birthday)? Not today. */
export const AUTO_DELIVERY = false;

/** The section's words. */
export const VC_COPY = {
  heading: 'Celebrate from',
  /** The heading's last word, set with the page's outline shine. */
  shine: 'anywhere',
  line: 'Share one link. Friends add a note, a photo or a short video from their phone, and it all lands on one digital card that you send on the big day.',
  cta: 'Start a celebration card',
  /** What Beamy says when he gets here. */
  beamy: 'Far away? Everyone can still sign the card.',
  /** The stop's short name (logs, the style guide's progress specimen). */
  stop: 'Anywhere',
} as const;

/** A friend's contribution in the scene. */
export interface VcPiece {
  id: string;
  kind: 'note' | 'photo' | 'video';
  who: string;
  /** Where they are (it is the point: none of them are in the room). */
  from: string;
  /** A note's words; a video's length. */
  text?: string;
  /** Index into the page's photo pool (photos and video stills). */
  photo?: number;
  /** Which edge of the scene it flies in from. */
  edge: 'left' | 'right' | 'top' | 'bottom';
  /** The cue it flies in on (see VC_SEQ). */
  cue: 'notes' | 'photos' | 'videos';
}

export const VC_PIECES: readonly VcPiece[] = [
  { id: 'n1', kind: 'note', who: 'Ada', from: 'Lagos', text: 'Happy birthday! Miss you loads.', edge: 'left', cue: 'notes' },
  { id: 'n2', kind: 'note', who: 'Jon', from: 'Accra', text: 'Cake is on me next time.', edge: 'right', cue: 'notes' },
  { id: 'p1', kind: 'photo', who: 'Sam', from: 'London', photo: 0, edge: 'top', cue: 'photos' },
  { id: 'p2', kind: 'photo', who: 'Lena', from: 'Berlin', photo: 4, edge: 'right', cue: 'photos' },
  { id: 'v1', kind: 'video', who: 'Kemi', from: 'Toronto', text: '0:14', photo: 2, edge: 'left', cue: 'videos' },
  { id: 'v2', kind: 'video', who: 'Theo', from: 'Sydney', text: '0:09', photo: 5, edge: 'bottom', cue: 'videos' },
];

/** The scene's own words (short: it is a picture, the copy above carries the meaning). */
export const VC_SCENE = {
  linkTitle: 'Tolu turns 30',
  linkUrl: 'beamwall.app/c/tolu-30',
  copy: 'Copy link',
  shared: 'Link shared',
  sentTo: 'Sent to 12 friends',
  page: 'For Tolu',
  more: '+6 more',
  cover: 'Happy birthday, Tolu!',
  coverSub: 'With love from 12 friends',
  /** The card arriving: what the recipient sees. */
  mailTitle: 'Happy birthday, Tolu!',
  mailBody: '12 friends sent love',
  mailFrom: 'From Maya',
} as const;

/**
 * The order the scene plays in (ms from the moment it comes into view):
 *   link     the share link appears;
 *   share    it goes out to friends (Beamy beams at the card);
 *   notes    two notes fly in from the edges and land on the card;
 *   photos   then two photos;
 *   videos   then two short videos;
 *   assemble the card closes into its cover;
 *   deliver  it goes into an envelope and arrives for Tolu.
 * The last frame holds; leaving the section resets it, so it replays.
 */
export const VC_SEQ: Sequence = sequence([
  ['link', 300], ['share', 1100], ['notes', 2000], ['photos', 2900], ['videos', 3800], ['assemble', 5200], ['deliver', 6600],
]);

/** Every line the section puts on screen, for the copy rules. */
export function vcLines(): string[] {
  const s = VC_SCENE;
  return [
    VC_COPY.heading, VC_COPY.shine, VC_COPY.line, VC_COPY.cta, VC_COPY.beamy, VC_COPY.stop,
    ...VC_PIECES.flatMap((p) => [p.who, p.from, ...(p.text !== undefined ? [p.text] : [])]),
    s.linkTitle, s.linkUrl, s.copy, s.shared, s.sentTo, s.page, s.more, s.cover, s.coverSub, s.mailTitle, s.mailBody, s.mailFrom,
  ];
}

/**
 * Words that would promise timed or automatic delivery. Banned from the copy
 * while AUTO_DELIVERY is false (the test enforces it).
 */
export const AUTO_DELIVERY_RE =
  /\bauto(matic(ally)?|[- ]?(send|sent|sends|deliver\w*|email\w*|mail\w*))\b|\bschedul\w*|\bon (their|his|her|your|the) (birth)?day\b|\bbirthday (e-?mail|delivery)\b|\be-?mailed to\b|\bdelivered (automatically|on)\b|\bset (it )?and forget\b|\bwe(['’]| wi)ll (send|email|deliver)\b/i;
