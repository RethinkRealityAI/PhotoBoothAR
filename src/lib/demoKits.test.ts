import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_KITS, DEMO_KIT_IDS, FRAME_THEMES, demoKit, tryPath } from './demoKits';
import { SHADER_MAP } from './shaders';
import { HEAD_PIECE_MAP } from './headPieces';

const pub = (p: string) => resolve(__dirname, '../../public', p.replace(/^\//, ''));

describe('demo kits', () => {
  it('every frame and thumb ships in public/', () => {
    const frames = [...Object.values(DEMO_KITS).flatMap((k) => k.frames), ...FRAME_THEMES.flatMap((t) => t.frames)];
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames) {
      expect(existsSync(pub(f.src)), f.src).toBe(true);
      expect(existsSync(pub(f.thumb)), f.thumb).toBe(true);
    }
  });

  it('every effect and prop is a real built-in', () => {
    for (const k of Object.values(DEMO_KITS)) {
      for (const e of k.effects) expect(SHADER_MAP[e.id], `${k.id}:${e.id}`).toBeDefined();
      for (const p of k.props) expect(HEAD_PIECE_MAP[p.id], `${k.id}:${p.id}`).toBeDefined();
      expect(k.frames.length).toBeGreaterThan(0);
    }
  });

  it('unknown ids fall back to the wedding kit', () => {
    expect(demoKit('nope').id).toBe('wedding');
    expect(demoKit(undefined).id).toBe('wedding');
    expect(demoKit('toString').id).toBe('wedding');
    expect(DEMO_KIT_IDS).toContain('christmas');
    expect(tryPath('wedding')).toBe('/try/wedding');
  });
});

describe('cardBoothLook', () => {
  it('reads the card title', async () => {
    const { cardBoothLook } = await import('./demoKits');
    expect(cardBoothLook('Merry Christmas, Grandma!')).toBe('christmas');
    expect(cardBoothLook('Happy anniversary you two')).toBe('wedding');
    expect(cardBoothLook('Happy 60th, Mum!')).toBe('party');
    expect(cardBoothLook(null)).toBe('party');
  });
  it('always names a real kit', async () => {
    const { cardBoothLook } = await import('./demoKits');
    for (const t of ['xmas', 'wedding', 'anything']) expect(DEMO_KIT_IDS).toContain(cardBoothLook(t));
  });
});

describe('cardBoothKit', () => {
  it('never offers a sample-personalised frame', async () => {
    const { cardBoothKit } = await import('./demoKits');
    const banned = ['birthday-monogram-corner', 'wedding-monogram-drop', 'wedding-arch-mask', 'wedding-magazine-cover', 'nye-countdown'];
    for (const t of ['Happy 60th', 'Merry Christmas', 'Happy anniversary']) {
      const kit = cardBoothKit(t);
      for (const f of kit.frames) expect(banned).not.toContain(f.id);
      expect(kit.effects.length).toBeGreaterThan(0);
      expect(kit.props.length).toBeGreaterThan(0);
    }
  });
  it('keeps the themed frames that are safe', async () => {
    const { cardBoothKit } = await import('./demoKits');
    expect(cardBoothKit('Happy 60th').frames.map((f) => f.id)).toEqual(['birthday-character-hands']);
    expect(cardBoothKit('Merry Christmas').frames).toHaveLength(2);
  });
});
