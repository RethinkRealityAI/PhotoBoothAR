#!/usr/bin/env node
/**
 * build-prompts.mjs — writes scripts/qr-card-art/prompts.json, the Meshy
 * (nano-banana-pro) prompts behind every QR card scene in
 * public/qr-cards/art/<id>-<p|l>.webp. Portrait is 3:4, landscape 4:3.
 *
 * Every scene is built around a HOLDER for the code that belongs to its
 * theme (a garden sign, a gift tag, a billboard, a marquee, a moon only where
 * a moon belongs) whose front is a plain pale flat square: the card prints the
 * QR code straight onto it. The rest of the composition leaves room for words:
 *   portrait   the holder just below centre; the top quarter calm for the title;
 *              decoration in the corners, down the sides and along the bottom.
 *   landscape  the holder in one half (side varies per scene); the other 45%
 *              calm for the words.
 * Each entry also records where the holder was asked for (`at`), which
 * process-art.py uses to find it.
 *
 *   node scripts/qr-card-art/build-prompts.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLE = 'Edge-to-edge layered paper-cut diorama illustration that fills the entire image, full bleed to every edge: flat artwork only, not a mock-up, not a photo of a card, no wall or table around it. Handcrafted paper layers with soft drop shadows between them and a fine paper grain, rich and detailed, vivid colours.';
const TAIL = 'No text, no letters, no numbers, no faces, no people, no white frame, no border, no margin.';

/**
 * id → { o: occasion, holder, face, sky, edges, ground, side: landscape holder side }.
 * `keep: true` = the first round's moon art stays (the moon IS the theme there).
 */
const SCENES = {
  'moonlit-arch': { keep: true, side: 'right' },
  'garden-vows': { o: 'a garden wedding', holder: 'a whitewashed wooden sign hanging by twine from a rose-covered garden arbour', face: 'cream', sky: 'soft lilac and dusky-rose evening sky', edges: 'cascading purple wisteria and white roses with greenery', ground: 'a garden aisle lined with white chairs and little lanterns', side: 'left' },
  'grand-ballroom': { o: 'a black-tie wedding', holder: 'a tall gilded easel holding a square ivory card in a thin gold frame', face: 'ivory', sky: 'deep navy ballroom wall with a faint gold art-deco pattern', edges: 'gold art-deco columns, navy velvet drapes with gold tassels and small crystal chandeliers', ground: 'candlelit round banquet tables with gold chairs', side: 'right' },
  'balloon-bash': { o: 'a birthday party', holder: 'a big square cream party sign held up in the air by a bunch of colourful balloons tied to its top corners', face: 'cream', sky: 'warm peach and coral party wall', edges: 'clusters of coral, yellow, lilac and teal paper balloons with bunting', ground: 'a birthday cake on a table with wrapped gifts and confetti', side: 'right' },
  'party-pop': { o: 'a birthday party', holder: 'a giant instant-photo card pinned up with a strip of pink tape, its square picture area completely blank', face: 'cream', sky: 'soft pink candy-striped backdrop', edges: 'paper pinwheels, curly streamers and confetti', ground: 'a tiered pink birthday cake, gift boxes and party hats', side: 'left' },
  'jungle-jam': { o: 'a kids birthday party', holder: 'a wooden jungle signboard on two posts wrapped in vines, its front panel painted', face: 'light cream', sky: 'soft mint and teal sky', edges: 'lush tropical jungle leaves, hanging vines and a toucan', ground: 'rolling green hills with a picnic, a birthday cake, presents and little jungle animals', side: 'right' },
  'golden-hour': { o: 'a vineyard anniversary dinner', holder: 'a rustic wooden easel under an olive tree holding a square welcome board', face: 'warm cream', sky: 'warm apricot-to-lilac sunset sky', edges: 'olive tree branches and tall wild wheat grass', ground: 'vineyard rows and a long candlelit dinner table under string lights', side: 'left' },
  'love-notes': { o: 'an anniversary', holder: 'a large open envelope with a square love-letter card standing up out of it, sealed with a small red wax heart', face: 'cream', sky: 'deep plum and violet dusk sky', edges: 'climbing pink roses and strings of tiny paper hearts', ground: 'a path scattered with rose petals and purple hills', side: 'right' },
  'island-sunset': { o: 'a beach retirement party', holder: 'a driftwood beach sign on a post stuck in the sand, its front board', face: 'pale sand', sky: 'layered coral, peach and lilac sunset sky with wavy paper clouds', edges: 'silhouetted palm trees', ground: 'turquoise paper waves, a wooden pier and seashells on the sand', side: 'right' },
  'cloud-nine': { o: 'a retirement party', holder: 'a big square cream banner card hanging by ropes beneath a pastel hot-air balloon', face: 'cream', sky: 'soft periwinkle and blush pastel sky with tiny stars', edges: 'more small pastel hot-air balloons and fluffy paper clouds', ground: 'layers of fluffy pastel clouds', side: 'left' },
  'city-lights': { o: 'a corporate evening event', holder: 'a huge square billboard screen on top of a city tower, glowing plain warm white and completely blank', face: 'warm white', sky: 'deep indigo night sky', edges: 'warm string lights draping from the corners and potted plants on a rooftop', ground: 'a glowing night city skyline behind a rooftop terrace balustrade', side: 'right' },
  'beam-brand': { o: 'a modern brand event', holder: 'a floating square panel of soft white light with rounded corners, like a glowing blank screen, with beams of periwinkle light streaming into it', face: 'soft white', sky: 'deep periwinkle-to-indigo night', edges: 'flowing translucent glass ribbons and soft periwinkle and lilac light beams with tiny sparkles', ground: 'soft glowing waves of periwinkle light', side: 'right' },
  'showtime': { o: 'a product launch', holder: 'a theatre marquee sign ringed with glowing gold light bulbs hanging above the stage, its centre panel', face: 'warm ivory', sky: 'deep crimson theatre backdrop', edges: 'red velvet stage curtains with gold tassels', ground: 'a polished wooden stage with glowing footlights', side: 'right' },
  'gold-reveal': { o: 'a luxury product launch', holder: 'a square ivory card standing on a gold pedestal as a gold silk sheet slides off it, being unveiled', face: 'ivory', sky: 'rich black backdrop with fine gold confetti', edges: 'gold silk drapes and gold art-deco fan shapes', ground: 'a gold stage with curling gold ribbons', side: 'left' },
  'winter-glow': { o: 'a Christmas party', holder: 'a snow-capped wooden sign on a post in the snow with a little red scarf tied round the post, its front board', face: 'cream', sky: 'deep navy starry night with gently falling snow', edges: 'tall snowy pine trees', ground: 'a cozy snowy village with glowing cottages and a decorated Christmas tree', side: 'right' },
  'silent-night': { o: 'a Christmas party', holder: 'a big square cream gift tag hanging by a red velvet ribbon from a pine branch', face: 'cream', sky: 'deep forest-green backdrop with tiny gold stars', edges: 'pine branches, red baubles, gold stars and candy canes', ground: 'a fireplace mantel with stockings, presents and candles', side: 'left' },
  'pumpkin-moon': { keep: true, side: 'right' },
  'spellbound': { o: 'a Halloween party', holder: 'a tall magic mirror in a twisted bronze frame with a crow perched on top, its glass glowing', face: 'pale lilac-white', sky: 'dark violet witch study wall', edges: 'cobwebs, hanging dried herbs, spell books and candles on shelves', ground: 'a bubbling cauldron, potion bottles, candles and a black cat', side: 'right' },
  'grand-hall': { o: 'a graduation', holder: 'a large square parchment certificate in a carved gold frame on a wooden easel, completely blank', face: 'cream parchment', sky: 'warm ochre gothic stone wall', edges: 'tall wooden bookshelves, navy pennants and gold lanterns', ground: 'stacks of leather books, a diploma scroll tied with ribbon and graduation caps', side: 'right' },
  'big-day': { o: 'a graduation party', holder: 'a big square cream banner hanging from a laurel garland strung across the sky', face: 'cream', sky: 'twilight blue-to-peach sky', edges: 'graduation caps tossed into the air with tassels, confetti and laurel branches', ground: 'a navy campus silhouette with a clock tower and trees', side: 'left' },
  'little-one': { o: 'a baby shower', holder: 'a square cream sign hanging by pastel ribbons from a baby mobile of paper stars, moons and clouds', face: 'cream', sky: 'soft pastel lilac sky with tiny stars', edges: 'paper stars and tiny hot-air balloons hanging on strings, and pastel clouds', ground: 'fluffy pastel clouds with a sleeping teddy bear and baby blocks without letters', side: 'right' },
  'owambe': { o: 'a Nigerian owambe celebration', holder: 'an ornate gold picture frame on a stand, its picture area completely blank', face: 'pale ivory', sky: 'rich emerald green backdrop', edges: 'draped coral, gold and emerald fabric swags, gold hand fans and tropical flowers', ground: 'banquet tables with gold chairs and floral centrepieces', side: 'left' },
  'festival-of-lights': { o: 'a Diwali celebration', holder: 'a palace doorway with a pointed arch, framed by marigold garlands, its doorway filled with plain soft glowing light', face: 'pale cream', sky: 'deep violet night sky', edges: 'marigold garlands hanging down the sides and colourful paper star lanterns', ground: 'glowing diyas and a colourful rangoli on a palace terrace', side: 'right' },
  'crescent-night': { o: 'an Eid celebration', holder: 'a square cream card hanging by a gold ribbon from a slim golden crescent moon', face: 'cream', sky: 'deep blue night sky with stars', edges: 'hanging brass lanterns', ground: 'a mosque silhouette with domes and minarets and palm trees', side: 'left' },
};

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Where each prompt asks the holder's square face to be (fractions of the picture). */
const AT = { p: { x: 0.5, y: 0.56 }, right: { x: 0.68, y: 0.52 }, left: { x: 0.32, y: 0.52 } };

function prompt(s, orient) {
  const face = `Its blank front is a plain, smooth, flat ${s.face} square seen straight on, with nothing on it: no texture, no marks, no pattern, no writing and nothing in front of it`;
  if (orient === 'p') {
    return `${STYLE} The occasion is ${s.o}, portrait. The centrepiece is ${s.holder}, standing in the middle of the image slightly below centre (its square front centred at 50% across and 56% down, about 44% of the image width wide). ${face}. The top quarter of the image is open calm ${s.sky} with nothing else, empty space reserved for a title. ${cap(s.edges)} fill the top corners and the left and right edges. Nothing else crosses the centre column. The bottom 22% shows ${s.ground}, kept low. ${TAIL}`;
  }
  const other = s.side === 'right' ? 'left' : 'right';
  return `${STYLE} The occasion is ${s.o}, landscape. The centrepiece is ${s.holder}, in the ${s.side.toUpperCase()} half of the image (its square front centred at ${Math.round(AT[s.side].x * 100)}% across and 52% down, about 54% of the image height tall). ${face}. The ${other} 45% of the image is open calm ${s.sky} with nothing in it, empty space reserved for a title. ${cap(s.edges)} frame only the corners and the ${s.side} edge. The bottom 18% shows ${s.ground}, kept low. ${TAIL}`;
}

const out = [];
for (const [id, s] of Object.entries(SCENES)) {
  if (s.keep === true) {
    out.push({ id, orient: 'p', aspect: '3:4', at: AT.p, prompt: null });
    out.push({ id, orient: 'l', aspect: '4:3', at: AT[s.side], prompt: null });
    continue;
  }
  out.push({ id, orient: 'p', aspect: '3:4', at: AT.p, prompt: prompt(s, 'p') });
  out.push({ id, orient: 'l', aspect: '4:3', at: AT[s.side], prompt: prompt(s, 'l') });
}
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prompts.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${out.length} prompts`);
