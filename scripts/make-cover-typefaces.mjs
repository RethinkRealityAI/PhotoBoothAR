#!/usr/bin/env node
/**
 * Builds the three.js typeface JSONs the 3D magazine-cover mastheads extrude
 * (public/fonts/cover/typeface/*.json) from the OFL fonts the 2D covers use.
 *
 * Run once when a masthead font is added; the output is committed, so the app
 * never needs this script or opentype.js at runtime:
 *
 *   npm pack @fontsource/<family> && tar xzf …     # gives files/*.woff
 *   npx -p opentype.js@2.0.0 node scripts/make-cover-typefaces.mjs <src-dir>
 *
 * (If npx cannot resolve the import, install opentype.js@2.0.0 in a scratch
 * folder and set NODE_PATH to its node_modules.)
 *
 * The conversion is facetype.js's: glyph outlines scaled to resolution 1000,
 * quadratic `q` and cubic `b` segments written end point first, which is the
 * order three's FontLoader reads them in. Only the characters a cover can
 * show are kept (printable ASCII + Latin-1 letters + typographic quotes), so
 * each file stays small.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'fonts', 'cover', 'typeface');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: make-cover-typefaces.mjs <dir with fontsource packages>'); process.exit(1); }

/** id → source .woff inside the fontsource packages. */
const FONTS = {
  'playfair-900': 'playfair-display/package/files/playfair-display-latin-900-normal.woff',
  'abril': 'abril-fatface/package/files/abril-fatface-latin-400-normal.woff',
  'anton': 'anton/package/files/anton-latin-400-normal.woff',
  'cinzel-700': 'cinzel/package/files/cinzel-latin-700-normal.woff',
  'creepster': 'creepster/package/files/creepster-latin-400-normal.woff',
  'limelight': 'limelight/package/files/limelight-latin-400-normal.woff',
  'fredoka-700': 'fredoka/package/files/fredoka-latin-700-normal.woff',
};

const CHARS = new Set();
for (let c = 32; c <= 126; c++) CHARS.add(String.fromCharCode(c));
for (let c = 0xc0; c <= 0xff; c++) CHARS.add(String.fromCharCode(c));
for (const c of '’‘“”–—•·…') CHARS.add(c);

function convert(font) {
  const scale = (1000 * 100) / ((font.unitsPerEm || 2048) * 72);
  const glyphs = {};
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    const codes = g.unicodes?.length ? g.unicodes : (g.unicode !== undefined ? [g.unicode] : []);
    for (const u of codes) {
      const ch = String.fromCodePoint(u);
      if (!CHARS.has(ch)) continue;
      let o = '';
      for (const cmd of g.path.commands) {
        const t = cmd.type.toLowerCase() === 'c' ? 'b' : cmd.type.toLowerCase();
        o += `${t} `;
        if (cmd.x !== undefined && cmd.y !== undefined) o += `${Math.round(cmd.x * scale)} ${Math.round(cmd.y * scale)} `;
        if (cmd.x1 !== undefined && cmd.y1 !== undefined) o += `${Math.round(cmd.x1 * scale)} ${Math.round(cmd.y1 * scale)} `;
        if (cmd.x2 !== undefined && cmd.y2 !== undefined) o += `${Math.round(cmd.x2 * scale)} ${Math.round(cmd.y2 * scale)} `;
      }
      const m = g.getMetrics();
      glyphs[ch] = {
        ha: Math.round(g.advanceWidth * scale),
        x_min: Math.round((m.xMin ?? 0) * scale),
        x_max: Math.round((m.xMax ?? 0) * scale),
        o: o.trim(),
      };
    }
  }
  const head = font.tables.head;
  return {
    glyphs,
    familyName: font.names.fontFamily?.en ?? 'cover',
    ascender: Math.round(font.ascender * scale),
    descender: Math.round(font.descender * scale),
    underlinePosition: Math.round((font.tables.post?.underlinePosition ?? 0) * scale),
    underlineThickness: Math.round((font.tables.post?.underlineThickness ?? 0) * scale),
    boundingBox: {
      xMin: Math.round(head.xMin * scale), yMin: Math.round(head.yMin * scale),
      xMax: Math.round(head.xMax * scale), yMax: Math.round(head.yMax * scale),
    },
    resolution: 1000,
    // OFL: the licence travels with the font (public/fonts/cover/OFL.txt).
    original_font_information: { license: 'SIL Open Font License 1.1', family: font.names.fontFamily?.en ?? '' },
  };
}

mkdirSync(OUT, { recursive: true });
for (const [id, rel] of Object.entries(FONTS)) {
  const buf = readFileSync(join(SRC, rel));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const json = convert(font);
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(json));
  console.log(`${id}: ${Object.keys(json.glyphs).length} glyphs`);
}
