/**
 * The email art on disk matches what revealEmail.ts asks for, and the render
 * script's palette mirror matches THEME_PALETTES. A theme or unlock added on
 * one side only goes red here, not in someone's inbox as a broken image.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REVEAL_THEMES, REVEAL_UNLOCKS, THEME_PALETTES } from './revealModel';
import { REVEAL_ART_VERSION, revealButtonFile, revealHeroFile } from './revealEmail';

const ROOT = join(__dirname, '..', '..', '..');
const DIR = join(ROOT, 'public', 'email', 'reveals', REVEAL_ART_VERSION);
const SCRIPT = readFileSync(join(ROOT, 'scripts', 'render-reveal-email-art.mjs'), 'utf8');

describe('reveal email art', () => {
  it('the script mirrors every theme\'s panel, accent and core', () => {
    for (const t of REVEAL_THEMES) {
      const p = THEME_PALETTES[t];
      const line = SCRIPT.split('\n').find((l) => l.trim().startsWith(`${t}: {`));
      expect(line, `THEMES.${t} missing in the script`).toBeDefined();
      expect(line).toContain(`panel: '${p.panel}'`);
      expect(line).toContain(`accent: '${p.accent}'`);
      expect(line).toContain(`core: '${p.core}'`);
    }
    expect(SCRIPT).toContain(`const VERSION = '${REVEAL_ART_VERSION}'`);
    expect(SCRIPT).toContain(`export const UNLOCKS = [${REVEAL_UNLOCKS.map((u) => `'${u}'`).join(', ')}]`);
  });

  it('every file the email references exists and is within budget', () => {
    const files = [
      ...REVEAL_THEMES.map((t) => revealButtonFile(t)),
      ...REVEAL_UNLOCKS.flatMap((u) => REVEAL_THEMES.map((t) => revealHeroFile(u, t))),
    ];
    for (const f of files) {
      const path = join(DIR, f);
      expect(existsSync(path), `${f} missing: run scripts/render-reveal-email-art.mjs`).toBe(true);
      expect(statSync(path).size).toBeLessThanOrEqual(150 * 1024);
    }
  });
});
