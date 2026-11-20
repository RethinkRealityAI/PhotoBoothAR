/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyVirtual — "How it works" step 6 (virtual celebrations): its copy, the
 * people and messages its scene shows, and the order the scene plays in.
 * Pure, DOM-free, tested in node (beamyVirtual.test.ts). The scene itself is
 * DOM (pages/beamy/VirtualCelebrations.tsx), run by the story's sequencer
 * (lib/beamyStory STORY_SEQ.virtual = VC_SEQ).
 *
 * WHAT SHIPS TODAY (checked 2026-11-20 against the code AND the live project,
 * so the page only promises it):
 *   • A host creates a card for one person and shares its contribution link
 *     (/c/<publicId>/contribute?t=<token>, pages/cards/CardContribute.tsx).
 *   • Anyone with the link adds a NOTE, a PHOTO or a SHORT VIDEO. Contributors
 *     may use a frames-only booth (cardBoothKit), never props or filters, so
 *     this copy still never says "booth", filters or props.
 *   • The host picks the day it goes out (host/CardsTab "Pick a date",
 *     cards.deliver_at, migration 047); the `card-deliveries` cron (every 5
 *     min) runs card-publish, which closes, publishes and emails it. Verified
 *     live: a card reached delivery_state 'sent' through that path and Resend
 *     reports the email delivered. The host can still send or share by hand.
 *   • Publishing / emailing a card needs a Premium event (or org Pro).
 *   • Everything is digital.
 *
 * AUTO_DELIVERY is the switch the test reads: with it off, the copy falls back
 * to "you send it" and the timed-delivery words are banned.
 */
import { sequence, type Sequence } from './beamyMotion';

/** Does the platform deliver a card on its own, on a day the host picks? Yes (verified live 2026-11-20). */
export const AUTO_DELIVERY: boolean = true;

/** The step's words (a How it works card: a title, and a body of 80 chars max). */
export const VC_COPY = {
  title: 'Friends anywhere sign one digital card',
  body: AUTO_DELIVERY
    ? 'Share one link for notes, photos and videos. You pick the day it goes out.'
    : 'Share one link for notes, photos and videos. You send it on the big day.',
} as const;

/** The virtual celebrations film's words (the homepage no longer shows films; kept for the film's new home in /guides). */
export const VC_FILM = {
  label: 'Celebrations',
  title: 'Celebrate together, from anywhere',
  hook: 'One link gathers notes, photos and videos from friends everywhere onto one card.',
  /** Beamy's speech-bubble line while this film is on. */
  beamy: 'Twenty-four friends on one card. I counted twice.',
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
  /** On the closed card: when it goes out (only a date the host set, when that ships). */
  when: AUTO_DELIVERY ? 'Goes out on Tolu’s birthday' : 'Ready for the big day',
} as const;

/**
 * The order the scene plays in (ms from the moment its step comes up; about
 * as long as the other steps' scenes):
 *   link     the share link appears;
 *   share    it goes out to friends (Beamy beams at the card);
 *   notes    two notes fly in from the edges and land on the card;
 *   photos   then two photos;
 *   videos   then two short videos;
 *   assemble the card closes into its cover;
 *   deliver  it goes into an envelope and arrives for Tolu.
 * The last frame holds; leaving the step resets it, so it replays.
 */
export const VC_SEQ: Sequence = sequence([
  ['link', 300], ['share', 1000], ['notes', 1700], ['photos', 2400], ['videos', 3100], ['assemble', 4400], ['deliver', 5600],
]);

/** Every line the section puts on screen, for the copy rules. */
export function vcLines(): string[] {
  const s = VC_SCENE;
  return [
    VC_COPY.title, VC_COPY.body,
    VC_FILM.label, VC_FILM.title, VC_FILM.hook, VC_FILM.beamy,
    ...VC_PIECES.flatMap((p) => [p.who, p.from, ...(p.text !== undefined ? [p.text] : [])]),
    s.linkTitle, s.linkUrl, s.copy, s.shared, s.sentTo, s.page, s.more, s.cover, s.coverSub, s.mailTitle, s.mailBody, s.mailFrom, s.when,
  ];
}

/**
 * Words that over-promise delivery ("automatic", "scheduled", "we'll send").
 * Banned from the copy always; while AUTO_DELIVERY is false the copy must also
 * say the host sends it (the test enforces both).
 */
export const AUTO_DELIVERY_RE =
  /\bauto(matic(ally)?|[- ]?(send|sent|sends|deliver\w*|email\w*|mail\w*))\b|\bschedul\w*|\bon (their|his|her|your|the) (birth)?day\b|\bbirthday (e-?mail|delivery)\b|\be-?mailed to\b|\bdelivered (automatically|on)\b|\bset (it )?and forget\b|\bwe(['’]| wi)ll (send|email|deliver)\b/i;
