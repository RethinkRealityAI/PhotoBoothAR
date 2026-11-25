/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Showcase events: real, polished events the partnerships team can send to a
 * prospect as proof ("scan this, try the booth, see the wall"). Shown in the
 * hub's Showcase tab with a copyable link and a scannable / downloadable QR.
 *
 * Links are ABSOLUTE production URLs on purpose: collateral must point at the
 * live product even when the hub is opened on a deploy preview.
 *
 * Two kinds:
 *  - 'platform' — an event on beamwall.app (`/e/<slug>/…`).
 *  - 'legacy'   — one of the three original single-event sites frozen on the
 *                 `legacy-events` branch, each on its own Netlify domain.
 *
 * Never list test events here (salesShowcase.test.ts enforces it).
 */

export const PLATFORM_ORIGIN = 'https://beamwall.app';

export type ShowcaseLinkId = 'booth' | 'wall';

export interface ShowcaseEvent {
  id: string;
  name: string;
  /** Short label shown above the name. */
  kind: string;
  /** One line on why this event sells. */
  pitch: string;
  /** 'flagship' | 'legacy' | 'demo' — drives the badge. */
  tier: 'flagship' | 'legacy' | 'demo';
  /** salesImages key for the card art. */
  image: string;
  /** Accent glow as "r, g, b". */
  rgb: string;
  /** True when the wall shows a real client's guests (needs the host's OK to share). */
  realGuests: boolean;
  links: Record<ShowcaseLinkId, string>;
}

function platformLinks(slug: string): Record<ShowcaseLinkId, string> {
  return {
    booth: `${PLATFORM_ORIGIN}/e/${slug}/welcome`,
    wall: `${PLATFORM_ORIGIN}/e/${slug}/wall`,
  };
}

function legacyLinks(site: string): Record<ShowcaseLinkId, string> {
  const origin = `https://${site}.netlify.app`;
  return { booth: `${origin}/booth`, wall: `${origin}/wall` };
}

export const SHOWCASE_LINK_LABEL: Record<ShowcaseLinkId, string> = {
  booth: 'Guest booth',
  wall: 'Live wall',
};

export const SHOWCASE_EVENTS: readonly ShowcaseEvent[] = [
  {
    id: 'lynxxx-birthday',
    name: 'Lynxxx’s Birthday',
    kind: 'Birthday',
    pitch: 'Our flagship: custom 3D shades, a matchday beanie, face paints and a neon-red live wall.',
    tier: 'flagship',
    image: 'beamy-crown',
    rgb: '255, 70, 90',
    realGuests: true,
    links: platformLinks('lynxxx-birthday'),
  },
  {
    id: 'the-winter-gala',
    name: 'The Winter Gala',
    kind: 'Gala',
    pitch: 'The full demo: every Power-Up, 3D props, Christmas Looks, challenges and a gold-glow wall.',
    tier: 'demo',
    image: 'beamy-tophat',
    rgb: '214, 178, 92',
    realGuests: false,
    links: platformLinks('the-winter-gala'),
  },
  {
    id: 'hope-gala',
    name: 'SCAGO Hope Gala',
    kind: 'Charity gala',
    pitch: 'Our first client event: a charity gala and awards night with a branded booth and wall.',
    tier: 'legacy',
    image: 'beamy-gala',
    rgb: '120, 150, 255',
    realGuests: true,
    links: legacyLinks('galabooth'),
  },
  {
    id: 'detola-wuyi',
    name: 'Detola & Wuyi',
    kind: 'Wedding',
    pitch: 'A Nigerian wedding with its own crest, couple-branded frames and a guest photo wall.',
    tier: 'legacy',
    image: 'beamy-asoebi',
    rgb: '232, 196, 120',
    realGuests: true,
    links: legacyLinks('theadetoyis'),
  },
  {
    id: 'jenna-jake',
    name: 'Jenna & Jake',
    kind: 'Wedding',
    pitch: 'A romantic wedding booth with soft, couple-branded frames.',
    tier: 'legacy',
    image: 'beamy-wedding',
    rgb: '240, 170, 200',
    realGuests: true,
    links: legacyLinks('jennajake'),
  },
];

/** A file-safe name for a downloaded QR: `<event>-<link>-qr.png`. */
export function qrFileName(ev: Pick<ShowcaseEvent, 'id'>, link: ShowcaseLinkId): string {
  return `${ev.id}-${link}-qr.png`;
}

/** The message pasted with a link: what it is and what to do with it. */
export function showcaseShareText(ev: Pick<ShowcaseEvent, 'name'>, link: ShowcaseLinkId): string {
  return link === 'booth'
    ? `Try the ${ev.name} photo booth on your phone. No app needed:`
    : `See the ${ev.name} live photo wall:`;
}
