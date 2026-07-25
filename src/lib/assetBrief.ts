/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Brief completeness — deciding when we know enough to spend a credit.
 *
 * The old flow generated from whatever the host typed, so "gold frame" became
 * a generic gold frame and the host paid for it. Two words cannot describe a
 * frame, and the model fills the gap with the most average thing it knows.
 *
 * This does not gate on length — a short brief can be excellent ("art-deco
 * sunburst in brass and black") and a long one can be vague. It gates on
 * whether the brief answers the dimensions that actually change the output.
 * Pure, so both the confirm card and the agent reason from the same rules.
 */

export interface BriefGap {
  /** Stable key so callers can dedupe and order. */
  id: string;
  /** The question to put to the host, in their language. */
  question: string;
  /** A concrete example answer — people answer examples far more readily. */
  example: string;
}

/** Answered when the brief names a colour, metal or an explicit palette.
 *  The hex alternative sits OUTSIDE the \b group: `#` is a non-word character,
 *  so a leading \b can never match it and `#D4AF37` was silently missed. */
const COLOUR = /#[0-9a-f]{3,8}\b|\b(gold|golden|silver|brass|bronze|copper|chrome|black|white|ivory|cream|red|crimson|blue|navy|teal|cyan|green|emerald|olive|purple|violet|lilac|pink|rose|magenta|orange|amber|yellow|peach|brown|tan|beige|grey|gray|pastel|neon|monochrome|rainbow|iridescent|holographic)\b/i;

/** Answered when the brief names a style, era, or aesthetic. */
const STYLE = /\b(art[- ]?deco|art[- ]?nouveau|minimal|minimalist|modern|vintage|retro|classic|classical|baroque|rococo|gothic|victorian|bohemian|boho|rustic|industrial|futuristic|cyberpunk|vaporwave|y2k|90s|80s|70s|tropical|botanical|floral|geometric|abstract|hand[- ]?drawn|watercolou?r|neon|glam|elegant|whimsical|playful|festive|nautical|celestial|cosmic|winter|autumn|spring|summer)\b/i;

/** Answered when the brief names a motif — the actual subject matter.
 *
 *  Deliberately EXCLUDES `frame` and `border`: they are the noun of the thing
 *  being made, not a motif, and including them made the style check trivially
 *  satisfiable — `frameBriefGaps('a gold frame')` returned [] and the card
 *  offered to spend a credit on the exact two-word brief this module exists to
 *  catch. `light` is out for the same reason: "light gold" is a shade, not a
 *  subject (`beam`, `glitter` and `sparkle` still cover real light motifs). */
const MOTIF = /\b(flower|floral|rose|leaf|leaves|vine|palm|fern|star|stars|moon|sun|sunburst|heart|hearts|confetti|balloon|ribbon|bow|lace|filigree|scroll|feather|butterfly|bird|crown|diamond|gem|marble|wave|chevron|stripe|dot|polka|geometric|arch|column|glitter|sparkle|beam|smoke|cloud|firework|snow|tree|mountain|city|skyline)\b/i;

/** Answered when a 3D brief says what the object physically IS. */
const OBJECT = /\b(mask|helmet|hat|cap|crown|tiara|glasses|sunglasses|shades|goggles|ears?|antlers?|horns?|headband|halo|wig|trophy|cup|statue|figurine|bouquet|wand|sword|balloon|sign)\b/i;

/** Answered when a 3D brief says what it is made of. */
const MATERIAL = /\b(gold|silver|brass|bronze|copper|chrome|metal|metallic|wood|wooden|glass|crystal|plastic|acrylic|leather|fabric|velvet|silk|feather|fur|stone|marble|ceramic|porcelain|neon|matte|glossy|brushed|polished|iridescent|holographic)\b/i;

const MIN_MEANINGFUL_WORDS = 3;

function words(brief: string): string[] {
  return brief.trim().split(/\s+/).filter(Boolean);
}

/**
 * What a frame brief is missing. Returns [] when it is specific enough to
 * generate something worth paying for.
 */
export function frameBriefGaps(brief: string): BriefGap[] {
  const text = brief.trim();
  const gaps: BriefGap[] = [];
  if (words(text).length < MIN_MEANINGFUL_WORDS) {
    gaps.push({
      id: 'detail',
      question: 'What should the frame look like?',
      example: 'art-deco sunburst corners in brass on black',
    });
    return gaps; // Nothing else is worth asking until there is a brief at all.
  }
  if (!COLOUR.test(text)) {
    gaps.push({
      id: 'colour',
      question: 'What colours should it use?',
      example: 'ivory and gold',
    });
  }
  if (!STYLE.test(text) && !MOTIF.test(text)) {
    gaps.push({
      id: 'style',
      question: 'What style or motif — anything it should feature?',
      example: 'botanical vines, or clean art-deco geometry',
    });
  }
  return gaps;
}

/**
 * What a 3D-prop brief is missing. Stricter than frames, because a 3D
 * generation costs ~11 credits and takes minutes — a wasted one hurts more.
 */
export function pieceBriefGaps(brief: string): BriefGap[] {
  const text = brief.trim();
  const gaps: BriefGap[] = [];
  if (words(text).length < MIN_MEANINGFUL_WORDS) {
    gaps.push({
      id: 'detail',
      question: 'What should the prop be?',
      example: 'a feathered venetian masquerade mask in gold',
    });
    return gaps;
  }
  if (!OBJECT.test(text)) {
    gaps.push({
      id: 'object',
      question: 'What kind of thing is it — something worn on the head, or held?',
      example: 'a mask, a crown, a pair of glasses',
    });
  }
  if (!MATERIAL.test(text) && !COLOUR.test(text)) {
    gaps.push({
      id: 'material',
      question: 'What is it made of, or what colour?',
      example: 'brushed gold metal, or matte black with neon trim',
    });
  }
  return gaps;
}

/**
 * Is this brief good enough to spend on? Callers use this to enable the
 * Generate button — a card that offers to spend a credit on "gold" is the
 * thing we are trying to stop.
 */
export function briefIsReady(brief: string, gaps: BriefGap[]): boolean {
  return words(brief).length >= MIN_MEANINGFUL_WORDS && gaps.length === 0;
}

/**
 * One short line naming what is still missing, for the confirm card. Kept to
 * the two most valuable gaps: a card listing five questions reads as a form
 * and gets abandoned.
 */
export function gapSummary(gaps: BriefGap[]): string {
  if (gaps.length === 0) return '';
  const top = gaps.slice(0, 2);
  return `Add ${top.map((g) => g.id === 'detail' ? 'more detail' : g.id).join(' and ')} for a better result — e.g. ${top[0].example}.`;
}
