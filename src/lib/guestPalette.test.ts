import { describe, expect, it } from 'vitest';
import { applyGuestColor, guestColorSlot, swatchFill } from './guestPalette';
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

describe('guestColorSlot — a template with its own named swatches', () => {
  const mask = (hostHex?: string): ExperienceLayer => ({
    id: 'mask',
    kind: '3d_attachment',
    anchor: { anchor: 'noseBridge', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
    template: {
      ...template([
        { id: 'lacquer', label: 'Mask', recolourable: true, defaultHex: '#0e6b43', refLuminance: 0.06, guestPick: true },
        { id: 'feathers', label: 'Feathers', recolourable: true, defaultHex: '#0e6b43', refLuminance: 0.06, guestPick: true },
        { id: 'gold', label: 'Gold', recolourable: false, defaultHex: '#a3723a', refLuminance: 0.2 },
      ]),
      guestSwatches: [{ hex: '#0e6b43', name: 'Emerald' }, { hex: '#9b1028', name: 'Ruby' }, { hex: '#1e1e24', name: 'Onyx' }],
    },
    ...(hostHex ? { customization: { parts: { lacquer: { hex: hostHex }, feathers: { hex: hostHex } } } } : {}),
  } as unknown as ExperienceLayer);

  it('offers the template palette in order, named, and recolours every guest-pick region', () => {
    const slot = guestColorSlot([mask()])!;
    expect(slot.swatches).toEqual(['#0e6b43', '#9b1028', '#1e1e24']);
    expect(slot.regionIds).toEqual(['lacquer', 'feathers']);
    expect(slot.names?.['#9b1028']).toBe('Ruby');
    expect(slot.label).toBe('Colour');
  });

  it('leads with the host\'s own colour when it is not in the palette', () => {
    const slot = guestColorSlot([mask('#ff00aa')])!;
    expect(slot.swatches[0]).toBe('#ff00aa');
    expect(slot.names?.['#ff00aa']).toBe('Event colour');
    expect(slot.currentHex).toBe('#ff00aa');
  });

  it('applyGuestColor paints the mask AND the feathers, never the gold', () => {
    const layers = [mask()];
    const slot = guestColorSlot(layers)!;
    const out = applyGuestColor(layers, slot, '#9B1028')!;
    const parts = out[0].customization!.parts!;
    expect(parts.lacquer.hex).toBe('#9b1028');
    expect(parts.feathers.hex).toBe('#9b1028');
    expect(parts.gold).toBeUndefined();
  });
});

describe('colourway swatches — flags and baked variants', () => {
  const regions = [
    { id: 'lacquer', label: 'Mask', recolourable: true, defaultHex: '#0e6b43', refLuminance: 0.06, guestPick: true },
    { id: 'feathers', label: 'Feathers', recolourable: true, defaultHex: '#0e6b43', refLuminance: 0.06, guestPick: true },
    { id: 'gold', label: 'Gold', recolourable: false, defaultHex: '#a3723a', refLuminance: 0.2 },
  ];
  const mask = {
    id: 'mask', kind: '3d_attachment', asset_url: '/models/m.glb',
    anchor: { anchor: 'noseBridge', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
    template: {
      ...template(regions),
      guestSwatches: [
        { hex: '#0e6b43', name: 'Emerald' },
        { hex: '#009b3a', name: 'Jamaica', parts: { lacquer: '#009b3a', feathers: '#111111' }, dot: ['#009b3a', '#fed100', '#111111'] },
      ],
    },
  } as unknown as ExperienceLayer;

  it('a flag swatch paints each region its own colour and gets a striped button', () => {
    const slot = guestColorSlot([mask])!;
    expect(slot.fills?.['#009b3a']).toBe(swatchFill(['#009b3a', '#fed100', '#111111']));
    expect(slot.fills?.['#0e6b43']).toBeUndefined();
    const out = applyGuestColor([mask], slot, '#009b3a')!;
    const parts = out[0].customization!.parts!;
    expect(parts.lacquer.hex).toBe('#009b3a');
    expect(parts.feathers.hex).toBe('#111111');
    expect(parts.gold).toBeUndefined();
    expect(out[0].asset_url).toBe('/models/m.glb');
  });

  const shades = {
    id: 'shades', kind: '3d_attachment', asset_url: '/models/shades.glb',
    anchor: { anchor: 'noseBridge', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
    template: {
      ...template([]),
      glbUrl: '/models/shades.glb',
      guestSwatches: [
        { hex: '#e8742a', name: 'Floral', glbUrl: '/models/shades.glb' },
        { hex: '#009b3a', name: 'Jamaica', glbUrl: '/models/shades-jamaica.glb' },
      ],
    },
  } as unknown as ExperienceLayer;

  it('a template with no paintable region still offers baked variants', () => {
    const slot = guestColorSlot([shades])!;
    expect(slot.regionIds).toEqual([]);
    expect(slot.currentHex).toBe('#e8742a');
    expect(slot.swatches).toEqual(['#e8742a', '#009b3a']);
    // Picking the model that is already on is no change at all.
    const same = [shades];
    expect(applyGuestColor(same, slot, '#e8742a')).toBe(same);
    const out = applyGuestColor([shades], slot, '#009b3a')!;
    expect(out[0].asset_url).toBe('/models/shades-jamaica.glb');
    expect(out[0].customization).toBeUndefined();
  });

  it('a regionless template without variant swatches offers nothing', () => {
    const plain = { ...shades, template: { ...template([]), guestSwatches: [{ hex: '#e8742a', name: 'Floral' }] } } as unknown as ExperienceLayer;
    expect(guestColorSlot([plain])).toBeNull();
  });

  it('swatchFill: a flat colour, or equal stripes', () => {
    expect(swatchFill(['#008751'])).toBe('#008751');
    expect(swatchFill(['#008751', '#ffffff', '#008751'])).toBe(
      'linear-gradient(90deg, #008751 0.00% 33.33%, #ffffff 33.33% 66.67%, #008751 66.67% 100.00%)',
    );
  });
});
