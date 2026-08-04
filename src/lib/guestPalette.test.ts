import { describe, expect, it } from 'vitest';
import { applyGuestColor, guestColorSlot } from './guestPalette';
import type { ExperienceLayer } from '../types';

const template = (regions: object[]) => ({
  id: 'visor',
  name: 'Visor',
  glbUrl: '/models/cyclops-visor.glb',
  fitCm: 15,
  regions,
  textSlots: [],
  preparedBy: 'human',
});

const layer = (over: Partial<ExperienceLayer> = {}): ExperienceLayer => ({
  id: 'l1',
  kind: '3d_attachment',
  anchor: { anchor: 'noseBridge', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
  template: template([
    { id: 'lens', label: 'Lens', recolourable: true, defaultHex: '#ff3b30', refLuminance: 0.3, guestPick: true },
    { id: 'frame', label: 'Frame', recolourable: true, defaultHex: '#23262e', refLuminance: 0.2 },
  ]),
  ...over,
});

describe('guestColorSlot', () => {
  it('finds the guestPick region and builds a deduped palette led by the default', () => {
    const slot = guestColorSlot([layer()]);
    expect(slot).not.toBeNull();
    if (slot === null) return;
    expect(slot).toMatchObject({ layerId: 'l1', regionId: 'lens', label: 'Lens', currentHex: '#ff3b30' });
    expect(slot.swatches[0]).toBe('#ff3b30');
    expect(new Set(slot.swatches).size).toBe(slot.swatches.length);
    expect(slot.swatches.length).toBeLessThanOrEqual(7);
  });

  it("falls back to a recolourable region named 'lens' without the flag", () => {
    const l = layer({
      template: template([
        { id: 'lens', label: 'Lens', recolourable: true, defaultHex: '#ff3b30', refLuminance: 0.3 },
      ]),
    });
    expect(guestColorSlot([l])?.regionId).toBe('lens');
  });

  it('never offers a locked region, even when flagged', () => {
    const l = layer({
      template: template([
        { id: 'lens', label: 'Lens', recolourable: false, defaultHex: '#ff3b30', refLuminance: 0.3, guestPick: true },
      ]),
    });
    expect(guestColorSlot([l])).toBeNull();
  });

  it('prefers the host-customized hex as current', () => {
    const l = layer({ customization: { parts: { lens: { hex: '#00e676' } } } });
    const slot = guestColorSlot([l]);
    expect(slot?.currentHex).toBe('#00e676');
    expect(slot?.swatches[0]).toBe('#00e676');
  });

  it('returns null for no layers, 2D layers, or untemplated pieces', () => {
    expect(guestColorSlot(null)).toBeNull();
    expect(guestColorSlot([])).toBeNull();
    expect(guestColorSlot([layer({ kind: 'border', template: undefined })])).toBeNull();
    expect(guestColorSlot([layer({ template: undefined })])).toBeNull();
  });
});

describe('applyGuestColor', () => {
  it('returns the SAME reference when there is nothing to change', () => {
    const layers = [layer()];
    const slot = guestColorSlot(layers);
    expect(applyGuestColor(layers, slot, null)).toBe(layers);
    expect(applyGuestColor(layers, null, '#00e676')).toBe(layers);
    expect(applyGuestColor(layers, slot, '#FF3B30')).toBe(layers); // equals current
  });

  it('overrides only the slot region on the slot layer, without mutating input', () => {
    const layers = [layer(), layer({ id: 'l2', template: undefined })];
    const slot = guestColorSlot(layers);
    const out = applyGuestColor(layers, slot, '#2979FF');
    expect(out).not.toBe(layers);
    if (!out) return;
    expect(out[0].customization?.parts?.lens?.hex).toBe('#2979ff');
    expect(out[1]).toBe(layers[1]); // untouched layer keeps identity
    expect(layers[0].customization?.parts?.lens?.hex).toBeUndefined(); // no mutation
  });

  it('preserves other customized parts on the slot layer', () => {
    const layers = [layer({ customization: { parts: { frame: { hex: '#111111' } } } })];
    const slot = guestColorSlot(layers);
    const out = applyGuestColor(layers, slot, '#2979ff');
    expect(out?.[0].customization?.parts?.frame?.hex).toBe('#111111');
    expect(out?.[0].customization?.parts?.lens?.hex).toBe('#2979ff');
  });
});
