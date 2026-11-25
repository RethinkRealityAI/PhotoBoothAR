import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { builtInModels, existingModelNamed, isLibrary3dKind, modelNameKey, sitsOnLabel } from './platformModels';
import { offeredBundledProps } from './studio/bundledProps';
import { libraryAssets } from './studio/assetLibrary';

const PUBLIC = join(__dirname, '..', '..', 'public');

describe('builtInModels', () => {
  const models = builtInModels();

  it('lists every bundled prop and every shipped customisable model, once each', () => {
    expect(models.filter((m) => m.source === 'prop')).toHaveLength(offeredBundledProps().length);
    expect(models.filter((m) => m.source === 'customisable')).toHaveLength(libraryAssets().length);
    expect(new Set(models.map((m) => m.id)).size).toBe(models.length);
  });

  it('never lists DEV-only demo content', () => {
    expect(models.some((m) => m.id === 'demo-reference-bust')).toBe(false);
  });

  it('points every tile at a file that actually ships under public/', () => {
    for (const m of models) {
      expect(m.url, m.id).not.toBeNull();
      if (m.url !== null) {
        expect(m.url.startsWith('/'), m.id).toBe(true);
        expect(existsSync(join(PUBLIC, m.url)), `${m.id} model ${m.url}`).toBe(true);
      }
      if (m.thumb !== null) expect(existsSync(join(PUBLIC, m.thumb)), `${m.id} thumb ${m.thumb}`).toBe(true);
    }
  });

  it('ships a real picture for every built-in', () => {
    for (const m of models) expect(m.thumb, m.id).not.toBeNull();
  });

  it('gives every tile something to show: a thumbnail or a swatch', () => {
    for (const m of models) expect(m.thumb !== null || m.swatch !== null, m.id).toBe(true);
  });

  it('carries the Christmas collection through', () => {
    expect(models.some((m) => m.collection === 'christmas')).toBe(true);
  });

  it('puts hand-worn pieces on the hand, not the head', () => {
    expect(models.find((m) => m.id === 'wizard-wand')?.sitsOn).toBe('Hand');
    expect(models.find((m) => m.id === 'power-gauntlet')?.sitsOn).toBe('Wrist');
    expect(models.find((m) => m.id === 'cyclops-visor')?.sitsOn).toBe('Eyes');
  });
});

describe('sitsOnLabel', () => {
  it('prefers the hand anchor and falls back for unknown ids', () => {
    expect(sitsOnLabel('crown', 'grip')).toBe('Hand');
    expect(sitsOnLabel('noseTip')).toBe('Nose');
    expect(sitsOnLabel(undefined)).toBe('Top of head');
    expect(sitsOnLabel('somethingNew')).toBe('Top of head');
    expect(sitsOnLabel('crown', 'unknownHand')).toBe('Hand');
  });
});

describe('isLibrary3dKind', () => {
  it('counts props and scenes, not flat frames or filters', () => {
    expect(isLibrary3dKind('3d_attachment')).toBe(true);
    expect(isLibrary3dKind('composite')).toBe(true);
    expect(isLibrary3dKind('frame')).toBe(false);
    expect(isLibrary3dKind('filter')).toBe(false);
  });
});

describe('existingModelNamed', () => {
  const names = ['Royal Crown', "Queen's Tiara", 'Santa Hat'];

  it('matches ignoring case, spaces and punctuation', () => {
    expect(existingModelNamed('royal-crown', names)).toBe('Royal Crown');
    expect(existingModelNamed('Queens Tiara', names)).toBe("Queen's Tiara");
    expect(existingModelNamed('SANTA_HAT', names)).toBe('Santa Hat');
  });

  it('returns null for a new name or a name with no letters', () => {
    expect(existingModelNamed('Wizard Wand', names)).toBeNull();
    expect(existingModelNamed('___', names)).toBeNull();
    expect(modelNameKey('  ')).toBe('');
  });
});
