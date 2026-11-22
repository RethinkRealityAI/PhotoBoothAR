/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * designPacks — ONE card design, everywhere it appears.
 *
 * A design is drawn once (its scene art and its opening) and then adapted to
 * each place the recipient meets it, because each place has things the others
 * do not:
 *
 *   core   the scene art (gate/back/mid/thumb), the opening (gateway kind),
 *          the palette, and the living pieces (lib/sceneLife.ts). Shared by all.
 *   card   the reading view after the opening: photo frame shape, corner
 *          cut-outs, filigree or not (lib/designSkins.ts).
 *   email  the inbox: a still hero image of the scene (email-safe JPG, painted
 *          by scripts/render-email-heroes.mjs) and the colours the email
 *          template uses round it.
 *   film   the keepsake film: the scene intro (hyperframes/card-scene-intro,
 *          the same opening maths as the card) and the colours of the film's
 *          title and end cards after the intro.
 *
 * Adding a design means filling in all four; src/lib/designPacks.test.ts
 * goes red until every design has a complete pack and its files exist, so a
 * new design can never ship to the card but not the email or the film.
 */
import {
  CARD_DESIGN_IDS,
  cardDesign,
  designAssets,
  type CardDesign,
  type CardDesignId,
  type DesignAssets,
  type MotifKind,
} from './cardDesigns';
import { designLife, type LifeProp } from './sceneLife';
import { designSkin, type DesignSkin } from './designSkins';

/**
 * Inbox art is cached for years by mail proxies, and an email already sent
 * keeps pointing at its URL: never repaint a hero in place, bump this instead
 * (scripts/render-email-heroes.mjs writes public/email/designs/<version>/).
 */
export const EMAIL_HERO_VERSION = 'v1';
/** Hero size in the email (CSS px); the file is painted at 2x. */
export const EMAIL_HERO_W = 600;
export const EMAIL_HERO_H = 340;

/** Where to frame the landscape hero inside the portrait scene (0 = top, 1 = bottom). */
const EMAIL_FOCUS: Partial<Record<CardDesignId, number>> = {
  'garden-gate': 0.62,
  'balloon-bash': 0.6,
  'gala-night': 0.42,
  'city-lights': 0.5,
  'moon-gate': 0.46,
  'cloud-nine': 0.5,
  'grand-hall': 0.5,
  'island-sunset': 0.56,
  'love-notes': 0.62,
  'festival-of-lights': 0.58,
  'crescent-night': 0.36,
  'golden-hour': 0.56,
  'jungle-party': 0.66,
  'winter-glow': 0.62,
  'balloon-release': 0.6,
  showtime: 0.56,
};

export interface DesignPack {
  id: CardDesignId;
  core: {
    design: CardDesign;
    assets: DesignAssets;
    life: readonly LifeProp[];
  };
  card: {
    skin: DesignSkin;
  };
  email: {
    /** Site-relative path of the hero still (served by the Netlify site). */
    hero: string;
    /** Vertical framing used when the hero was painted. */
    focusY: number;
    /** Colours round the hero: page background, panel, accent (buttons, rules), text. */
    colors: { page: string; panel: string; accent: string; text: string };
    /** One line above the title, in the design's voice. */
    kicker: string;
  };
  film: {
    /** The HyperFrames composition that plays this design's opening. */
    intro: 'card-scene-intro';
    /** Title and end cards after the intro. */
    titleCard: { bg: string; accent: string; fg: string };
    /** The drifting particles behind the title card (same set as the card's motif). */
    motif: MotifKind;
  };
}

/** A design's kicker line, in its own voice. */
const KICKERS: Record<CardDesignId, string> = {
  'garden-gate': 'The gates are open',
  'balloon-bash': 'Pop! A card for you',
  'gala-night': 'You are cordially invited',
  owambe: 'The party is for you',
  'city-lights': 'Look up, the city is glowing',
  'moon-gate': 'Step through the moon gate',
  'cloud-nine': 'A little card on cloud nine',
  'grand-hall': 'With honour',
  'island-sunset': 'Sent from paradise',
  'love-notes': 'With all our love',
  'festival-of-lights': 'The lamps are lit for you',
  'crescent-night': 'Under the new moon',
  'golden-hour': 'A toast to you',
  'jungle-party': 'Hooray, it’s party time',
  'winter-glow': 'Warm wishes, from all of us',
  'balloon-release': 'Let them go, it’s your day',
  showtime: 'Tonight, the spotlight is yours',
};

export function designPack(id: CardDesignId): DesignPack {
  const design = cardDesign(id);
  const skin = designSkin(id);
  const p = design.palette;
  return {
    id,
    core: { design, assets: designAssets(id), life: designLife(id) },
    card: { skin },
    email: {
      hero: `/email/designs/${EMAIL_HERO_VERSION}/${id}.jpg`,
      focusY: EMAIL_FOCUS[id] ?? 0.55,
      colors: { page: p.bg, panel: p.bg, accent: p.accent, text: p.fg },
      kicker: KICKERS[id],
    },
    film: {
      intro: 'card-scene-intro',
      titleCard: { bg: p.bg, accent: p.accent, fg: p.fg },
      motif: design.motif.kind,
    },
  };
}

export const DESIGN_PACKS: readonly DesignPack[] = CARD_DESIGN_IDS.map(designPack);
