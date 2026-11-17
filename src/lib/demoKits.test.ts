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
