import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CARD_DESIGN_IDS } from './cardDesigns';
import { DECOR_KINDS, PHOTO_SHAPES } from './designSkins';
import { DESIGN_PACKS, EMAIL_HERO_H, EMAIL_HERO_VERSION, EMAIL_HERO_W } from './designPacks';
import {
  cardEmailHtml,
  EMAIL_DESIGN_HERO,
  EMAIL_DESIGNS,
  normalizeEmailDesign,
} from '../../supabase/functions/card-publish/email.ts';

const ROOT = resolve(__dirname, '../..');
const HEX = /^#[0-9A-F]{6}$/i;
const publicFile = (sitePath: string) => resolve(ROOT, 'public', sitePath.replace(/^\//, ''));

/** JPEG size from the SOF0/SOF2 marker, so the hero's real pixels are checked. */
function jpegSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error(`no SOF marker in ${path}`);
}

describe('design packs — every design, everywhere it appears', () => {
  it('there is exactly one pack per design, in library order', () => {
    expect(DESIGN_PACKS.map((p) => p.id)).toEqual([...CARD_DESIGN_IDS]);
    expect(DESIGN_PACKS.length).toBe(15);
  });

  for (const pack of DESIGN_PACKS) {
    describe(pack.id, () => {
      it('core: the scene art exists, and the scene has living pieces', () => {
        for (const f of Object.values(pack.core.assets)) {
          const path = publicFile(f);
          expect(existsSync(path), f).toBe(true);
          expect(statSync(path).size).toBeGreaterThan(2000);
        }
        expect(pack.core.life.length).toBeGreaterThanOrEqual(2);
      });

      it('card: a reading-view skin with a known frame shape and cut-outs', () => {
        const skin = pack.card.skin;
        expect(PHOTO_SHAPES).toContain(skin.photo);
        expect(DECOR_KINDS).toContain(skin.decor);
        expect(skin.colors).toHaveLength(3);
        for (const c of skin.colors) expect(c).toMatch(HEX);
      });

      it('email: a hero still at 2x the email size, the colours, and a kicker', () => {
        const path = publicFile(pack.email.hero);
        expect(existsSync(path), `${pack.email.hero} — run node scripts/render-email-heroes.mjs ${pack.id}`).toBe(true);
        expect(jpegSize(path)).toEqual({ w: EMAIL_HERO_W * 2, h: EMAIL_HERO_H * 2 });
        expect(statSync(path).size).toBeLessThan(250 * 1024);
        for (const c of Object.values(pack.email.colors)) expect(c).toMatch(HEX);
        expect(pack.email.kicker.length).toBeGreaterThan(3);
        expect(pack.email.focusY).toBeGreaterThanOrEqual(0);
        expect(pack.email.focusY).toBeLessThanOrEqual(1);
      });

      it('email: the edge function knows the design and renders its email', () => {
        expect(EMAIL_DESIGNS[pack.id]).toEqual({
          bg: pack.email.colors.page,
          accent: pack.email.colors.accent,
          fg: pack.email.colors.text,
          kicker: pack.email.kicker,
        });
        const html = cardEmailHtml({
          title: 'Happy birthday',
          url: 'https://beamwall.app/c/abc',
          presentation: { design: pack.id },
          assetBase: 'https://beamwall.app/email',
        });
        expect(html).toContain(`https://beamwall.app/email/designs/${EMAIL_HERO_VERSION}/${pack.id}.jpg`);
        expect(html).toContain(pack.email.colors.accent);
      });

      it('film: the intro composition can play it, and the title card has colours', () => {
        const bundle = readFileSync(resolve(ROOT, 'hyperframes', pack.film.intro, 'scene-frame.js'), 'utf8');
        expect(bundle).toContain(`"${pack.id}"`);
        expect(existsSync(resolve(ROOT, 'hyperframes', pack.film.intro, 'index.html'))).toBe(true);
        for (const c of Object.values(pack.film.titleCard)) expect(c).toMatch(HEX);
        expect(pack.film.motif).toBe(pack.core.design.motif.kind);
      });
    });
  }

  it('the edge function mirrors the hero version and size', () => {
    expect(EMAIL_DESIGN_HERO).toEqual({ version: EMAIL_HERO_VERSION, w: EMAIL_HERO_W, h: EMAIL_HERO_H });
    expect(Object.keys(EMAIL_DESIGNS).sort()).toEqual([...CARD_DESIGN_IDS].sort());
  });

  it('an unknown or missing design keeps the email as it was', () => {
    expect(normalizeEmailDesign({ design: 'nope' })).toBeNull();
    expect(normalizeEmailDesign({ design: 'none' })).toBeNull();
    expect(normalizeEmailDesign(null)).toBeNull();
    const plain = cardEmailHtml({ title: 'Hi', url: 'https://beamwall.app/c/x', presentation: { email: 'glow' } });
    expect(plain).not.toContain('/designs/');
  });
});
