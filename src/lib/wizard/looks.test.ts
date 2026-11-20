import { describe, expect, it } from 'vitest';
import type { Experience } from '../../types';
import { experienceToDraft } from '../studio/draftMapping';
import { parseTriggers } from '../studio/triggers';
import { BUNDLED_PROPS } from '../studio/bundledProps';
import {
  NO_LOOKS, buildLookCatalog, classicRow, composeDraft, customFilterError, customFilterRow, diffPicks, eventFilters,
  isPicked, picksConfigPatch, picksFromEvent, powerScenes, readyFilters, setCategory, starterRow, togglePick,
  type LookPicks,
} from './looks';
import { powerUpTriggers, powerUpsConfig } from './powerUps';

const asExp = (row: Record<string, unknown>, id: string): Experience =>
  ({ id, event_id: 'ev', created_at: '', thumbnail_url: null, is_published: true, ...row }) as unknown as Experience;

const EMPTY: LookPicks = { frames: [], effects: [], library: [], classics: [] };

describe('look catalogue', () => {
  it('offers frames, classics and effects before any library row loads', () => {
    const c = buildLookCatalog([], new Map());
    expect(c.frames.length).toBeGreaterThan(0);
    expect(c.props.length).toBe(BUNDLED_PROPS.length);
    expect(c.effects.length).toBeGreaterThan(0);
    const keys = [...c.frames, ...c.props, ...c.effects].map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('never offers a library draft', () => {
    const draft = asExp({ name: 'WIP', kind: '3d_attachment', config: { library: { draft: true } } }, 'd1');
    expect(buildLookCatalog([draft], new Map()).props.some((l) => l.ref === 'd1')).toBe(false);
  });
});

describe('picks', () => {
  it('an untouched event reports every non-seasonal built-in as on', () => {
    const p = picksFromEvent({}, [], [], new Map());
    expect(p.frames.length).toBeGreaterThan(0);
    expect(p.effects.length).toBeGreaterThan(0);
    expect(p.classics).toEqual([]);
  });
  it('an empty pick is written as the sentinel, never [] (which means everything)', () => {
    const patch = picksConfigPatch({ arContent: { framePalette: 'x' } }, EMPTY) as { arContent: Record<string, unknown> };
    expect(patch.arContent.borderIds).toEqual([NO_LOOKS]);
    expect(patch.arContent.shaderIds).toEqual([NO_LOOKS]);
    expect(patch.arContent.headPieceIds).toEqual([NO_LOOKS]);
    expect(patch.arContent.framePalette).toBe('x');
    // …and reads back as empty.
    expect(picksFromEvent(patch, [], [], new Map())).toEqual(EMPTY);
  });
  it('toggles and bulk-sets a category', () => {
    const c = buildLookCatalog([], new Map());
    const crown = c.props[0];
    const on = togglePick(EMPTY, crown);
    expect(isPicked(on, crown)).toBe(true);
    expect(isPicked(togglePick(on, crown), crown)).toBe(false);
    const all = setCategory(EMPTY, c.frames, true);
    expect(all.frames).toHaveLength(c.frames.filter((l) => l.source === 'frame').length);
    expect(setCategory(all, c.frames, false).frames).toEqual([]);
  });
  it('reads classics back from tagged rows and diffs to database work', () => {
    const row = classicRow(BUNDLED_PROPS[0])!;
    const p = picksFromEvent({}, ['lib-a', 'lib-comp'], [{ id: 'r1', config: row.config }], new Map([['lib-a', '3d_attachment'], ['lib-comp', 'composite']]));
    expect(p.classics).toEqual([BUNDLED_PROPS[0].id]);
    expect(p.library).toEqual(['lib-a']);
    const d = diffPicks(p, { ...p, library: ['lib-b'], classics: [BUNDLED_PROPS[1].id] });
    expect(d).toMatchObject({ link: ['lib-b'], unlink: ['lib-a'], addClassics: [BUNDLED_PROPS[1].id], removeClassics: [BUNDLED_PROPS[0].id], configChanged: false });
  });
});

describe('rows the wizard writes are normal studio scenes', () => {
  it('a classic prop row reopens in the studio as one 3D prop', () => {
    const row = classicRow(BUNDLED_PROPS[0])!;
    expect(row.kind).toBe('3d_attachment');
    const back = experienceToDraft(asExp(row as unknown as Record<string, unknown>, 'x'));
    expect(back?.objects).toHaveLength(1);
  });
  it('every ready-made and power filter serializes', () => {
    for (const s of [...readyFilters(), ...powerScenes()]) {
      const row = starterRow(s.id);
      expect(row, s.id).not.toBeNull();
      expect((row!.config as Record<string, unknown>).wizardRef).toBe(`starter:${s.id}`);
    }
    expect(powerScenes().length).toBe(3);
  });
  it('a custom filter needs a name and two parts, and caps props', () => {
    const base = { name: 'Party', frameId: null, effectId: null, classics: [], library: [] };
    expect(customFilterError(base)).toMatch(/two/);
    expect(customFilterError({ ...base, name: ' ', classics: ['a', 'b'] })).toMatch(/name/);
    expect(customFilterError({ ...base, classics: BUNDLED_PROPS.slice(0, 5).map((p) => p.id) })).toMatch(/Up to/);
    const c = buildLookCatalog([], new Map());
    const spec = { ...base, frameId: c.frames[0].ref, effectId: c.effects[0].ref, classics: [BUNDLED_PROPS[0].id] };
    expect(customFilterError(spec)).toBeNull();
    const draft = composeDraft(spec);
    expect(draft.objects).toHaveLength(2);
    expect(draft.shaderId).toBe(c.effects[0].ref);
    const row = customFilterRow(spec)!;
    expect((row.config as Record<string, unknown>).wizardRef).toBe('custom');
    const back = experienceToDraft(asExp(row as unknown as Record<string, unknown>, 'y'));
    expect(back?.objects).toHaveLength(2);
  });
  it('lists the filters on an event', () => {
    const ready = asExp(starterRow(readyFilters()[0].id)! as unknown as Record<string, unknown>, 'f1');
    const power = asExp(starterRow('hero-visor')! as unknown as Record<string, unknown>, 'f2');
    const plain = asExp({ name: 'Studio scene', kind: 'shader', config: {} }, 'f3');
    const list = eventFilters([ready, power, plain], [asExp({ name: 'Lib look', kind: 'composite', config: {} }, 'f4')]);
    expect(list.map((f) => [f.id, f.kind])).toEqual([['f1', 'ready'], ['f2', 'power'], ['f4', 'library']]);
  });
  it('power-up triggers validate when carried on a starter row', () => {
    const extra = powerUpTriggers(powerUpsConfig(['smile-sparkles']));
    const row = starterRow(readyFilters()[0].id, extra)!;
    const t = parseTriggers((row.config as Record<string, unknown>).triggers);
    expect(t.some((x) => x.id === extra[0].id)).toBe(true);
  });
});
