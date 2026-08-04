import { describe, expect, it } from 'vitest';
import {
  POWER_GEAR,
  POWER_PALETTE,
  availableGear,
  buildPowerFxAdditions,
  defaultPowerFxSpec,
  validatePowerFxSpec,
} from './powerFx';
import { parseTriggers } from './triggers';

const VISOR_TEMPLATE = {
  id: 'cyclops-visor',
  name: 'Cyclops Visor',
  glbUrl: '/models/cyclops-visor.glb',
  fitCm: 15,
  regions: [
    { id: 'lens', label: 'Lens', recolourable: true, defaultHex: '#ff3b30', refLuminance: 0.3 },
    { id: 'frame', label: 'Frame', recolourable: true, defaultHex: '#23262e', refLuminance: 0.2 },
  ],
  textSlots: [],
  preparedBy: 'human',
};

describe('POWER_GEAR', () => {
  it('has unique ids, valid swatches, and a none option', () => {
    const ids = POWER_GEAR.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(POWER_GEAR.some((g) => g.refId === '')).toBe(true);
    for (const g of POWER_GEAR) for (const hex of g.swatch) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('availableGear hides library gear whose asset is not registered', () => {
    const none = availableGear([]);
    expect(none.every((g) => g.kind === 'headpiece')).toBe(true);
    const withVisor = availableGear(['cyclops-visor']);
    expect(withVisor.some((g) => g.id === 'cyclops-visor')).toBe(true);
    expect(withVisor.some((g) => g.id === 'wizard-wand')).toBe(false);
  });
});

describe('spec + validation', () => {
  it('default spec adopts the gear pairing', () => {
    const wand = POWER_GEAR.find((g) => g.id === 'wizard-wand');
    expect(wand).toBeDefined();
    if (!wand) return;
    const s = defaultPowerFxSpec(wand);
    expect(s.source).toBe('pinch');
    expect(s.style).toBe('sparkle');
  });

  it('validates gear id and hex', () => {
    const gear = POWER_GEAR[0];
    expect(validatePowerFxSpec(defaultPowerFxSpec(gear)).ok).toBe(true);
    expect(validatePowerFxSpec({ ...defaultPowerFxSpec(gear), hex: 'red' }).ok).toBe(false);
    expect(validatePowerFxSpec({ ...defaultPowerFxSpec(gear), gearId: 'nope' }).ok).toBe(false);
  });

  it('palette is well-formed', () => {
    for (const p of POWER_PALETTE) expect(p.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('buildPowerFxAdditions', () => {
  it('library gear: lens customization + auto beam colour', () => {
    const gear = POWER_GEAR.find((g) => g.id === 'cyclops-visor');
    if (!gear) throw new Error('missing gear');
    const spec = { ...defaultPowerFxSpec(gear), hex: '#00E676' };
    const out = buildPowerFxAdditions(spec, VISOR_TEMPLATE);
    expect(out.gear).toEqual({ kind: 'library', libraryId: 'cyclops-visor' });
    expect(out.customization).toEqual({ parts: { lens: { hex: '#00e676' } } });
    expect(out.triggers).toHaveLength(1);
    expect(out.triggers[0].action).toEqual({ type: 'beam', style: 'optic', color: 'auto' });
    // The built trigger must survive the jsonb validation gate untouched.
    expect(parseTriggers(out.triggers)).toEqual(out.triggers);
  });

  it('headpiece gear: explicit beam colour, no customization', () => {
    const gear = POWER_GEAR.find((g) => g.id === 'cyclops-visor-lite');
    if (!gear) throw new Error('missing gear');
    const out = buildPowerFxAdditions({ ...defaultPowerFxSpec(gear), hex: '#2979FF' }, null);
    expect(out.gear).toEqual({ kind: 'headpiece', pieceId: 'cyclops-visor' });
    expect(out.customization).toBeNull();
    expect(out.triggers[0].action).toEqual({ type: 'beam', style: 'optic', color: '#2979ff' });
  });

  it("gear 'none': no object, beam only, no emitter id", () => {
    const gear = POWER_GEAR.find((g) => g.id === 'none');
    if (!gear) throw new Error('missing gear');
    const out = buildPowerFxAdditions(defaultPowerFxSpec(gear), null);
    expect(out.gear).toBeNull();
    expect(out.triggers[0].action.type).toBe('beam');
    expect('objectId' in out.triggers[0].action).toBe(false);
  });

  it('generates fresh trigger ids per build', () => {
    const gear = POWER_GEAR.find((g) => g.id === 'none');
    if (!gear) throw new Error('missing gear');
    const a = buildPowerFxAdditions(defaultPowerFxSpec(gear), null);
    const b = buildPowerFxAdditions(defaultPowerFxSpec(gear), null);
    expect(a.triggers[0].id).not.toBe(b.triggers[0].id);
  });
});
