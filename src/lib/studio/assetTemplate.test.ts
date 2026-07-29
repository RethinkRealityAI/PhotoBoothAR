/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_BOUNDS,
  LABEL_FONT_CSS,
  readVec3,
  unitVec3,
  orthogonalUp,
  normalizeTemplate,
  isConfigurable,
  regionIdsSource,
  normalizeCustomization,
  resolveLabelText,
  configuratorKey,
  type AssetTemplate,
  type Vec3,
} from './assetTemplate';
import { MAX_REGIONS, packRegionIds } from './regionTint';
import { ASSET_CUSTOMIZATION } from './controlSpecs';

/** A descriptor that passes cleanly — tests mutate copies of this. */
function goodTemplate(): Record<string, unknown> {
  return {
    id: 'six-panel-cap',
    name: 'Six Panel Cap',
    glbUrl: '/models/cap.glb',
    fitCm: 22,
    frontAxis: [0, 0, 1],
    regions: [
      { id: 'crown', label: 'Crown', recolourable: true, defaultHex: '#22304f', refLuminance: 0.09 },
      { id: 'brim', label: 'Brim', recolourable: true, defaultHex: '#b98b57', refLuminance: 0.31 },
      { id: 'badge', label: 'Badge', recolourable: false, defaultHex: '#c0392b', refLuminance: 0.2 },
    ],
    textSlots: [
      {
        id: 'front', label: 'Front panel',
        position: [0, 0.4, 0.9], normal: [0, 0, 1], up: [0, 1, 0],
        maxWidthCm: 9, regionId: 'crown', decalDepth: 0.35,
      },
    ],
    preparedBy: 'human',
  };
}

describe('readVec3', () => {
  it('accepts exactly three finite numbers', () => {
    expect(readVec3([1, 2, 3])).toEqual([1, 2, 3]);
    expect(readVec3([0, -0.5, 1e-9])).toEqual([0, -0.5, 1e-9]);
  });

  it('rejects a 4-long array rather than silently dropping w', () => {
    expect(readVec3([0, 0, 0, 1])).toBeNull();
  });

  it('rejects anything else, and never throws', () => {
    for (const bad of [null, undefined, {}, 'a,b,c', [1, 2], [1, 2, '3'], [1, 2, NaN], [1, 2, Infinity], []]) {
      expect(readVec3(bad)).toBeNull();
    }
  });
});

describe('unitVec3', () => {
  it('normalizes', () => {
    const u = unitVec3([0, 3, 4])!;
    expect(u[1]).toBeCloseTo(0.6, 10);
    expect(u[2]).toBeCloseTo(0.8, 10);
  });
  it('refuses a zero-length vector — it carries no direction', () => {
    expect(unitVec3([0, 0, 0])).toBeNull();
    expect(unitVec3([1e-12, 0, 0])).toBeNull();
    expect(unitVec3(null)).toBeNull();
  });
});

describe('orthogonalUp', () => {
  it('leaves an already-perpendicular up alone', () => {
    const up = orthogonalUp([0, 1, 0], [0, 0, 1]);
    expect(up[0]).toBeCloseTo(0, 10);
    expect(up[1]).toBeCloseTo(1, 10);
    expect(up[2]).toBeCloseTo(0, 10);
  });

  it('projects a skewed up back onto the surface plane', () => {
    const normal: Vec3 = [0, 0, 1];
    const up = orthogonalUp([0, 1, 0.5], normal);
    const dot = up[0] * normal[0] + up[1] * normal[1] + up[2] * normal[2];
    expect(Math.abs(dot)).toBeLessThan(1e-9);
    expect(Math.hypot(...up)).toBeCloseTo(1, 10);
  });

  it('SUBSTITUTES an axis when up is parallel to the normal — the singular basis a cap button hits', () => {
    const normal: Vec3 = [0, 1, 0];
    const up = orthogonalUp([0, 1, 0], normal);
    const dot = up[0] * normal[0] + up[1] * normal[1] + up[2] * normal[2];
    expect(Math.abs(dot)).toBeLessThan(1e-9);
    expect(Math.hypot(...up)).toBeCloseTo(1, 10);
  });

  it('always returns a usable unit vector for any unit normal', () => {
    const normals: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0.577, 0.577, 0.577]];
    for (const n of normals) {
      const unit = unitVec3(n)!;
      const up = orthogonalUp(null, unit);
      expect(Math.hypot(...up)).toBeCloseTo(1, 6);
      expect(Math.abs(up[0] * unit[0] + up[1] * unit[1] + up[2] * unit[2])).toBeLessThan(1e-6);
    }
  });
});

describe('normalizeTemplate — the happy path', () => {
  it('passes a well-formed descriptor through intact', () => {
    const t = normalizeTemplate(goodTemplate())!;
    expect(t.id).toBe('six-panel-cap');
    expect(t.name).toBe('Six Panel Cap');
    expect(t.glbUrl).toBe('/models/cap.glb');
    expect(t.fitCm).toBe(22);
    expect(t.preparedBy).toBe('human');
    expect(t.regions.map((r) => r.id)).toEqual(['crown', 'brim', 'badge']);
    expect(t.textSlots[0].id).toBe('front');
    expect(t.textSlots[0].regionId).toBe('crown');
    expect(t.textSlots[0].decalDepth).toBe(0.35);
  });

  it('normalizes the front axis to unit length', () => {
    const raw = { ...goodTemplate(), frontAxis: [0, 0, 5] };
    expect(normalizeTemplate(raw)!.frontAxis).toEqual([0, 0, 1]);
  });
});

describe('normalizeTemplate — degrades, never throws', () => {
  it('returns null for non-objects', () => {
    for (const bad of [null, undefined, 0, '', 'x', [], [1, 2], true, NaN]) {
      expect(normalizeTemplate(bad)).toBeNull();
    }
  });

  it('returns null without an id or a glbUrl — nothing to key on, nothing to draw', () => {
    expect(normalizeTemplate({ ...goodTemplate(), id: '' })).toBeNull();
    expect(normalizeTemplate({ ...goodTemplate(), id: '   ' })).toBeNull();
    expect(normalizeTemplate({ ...goodTemplate(), id: 42 })).toBeNull();
    expect(normalizeTemplate({ ...goodTemplate(), glbUrl: '' })).toBeNull();
    expect(normalizeTemplate({ ...goodTemplate(), glbUrl: null })).toBeNull();
  });

  it('survives every field being the wrong type', () => {
    const t = normalizeTemplate({
      id: 'x', glbUrl: 'u',
      name: 999, fitCm: 'huge', frontAxis: 'north',
      regions: 'lots', textSlots: { a: 1 }, regionIds: 12, preparedBy: 'robot',
    })!;
    expect(t.name).toBe('x');            // falls back to the id
    expect(t.fitCm).toBe(20);            // the documented default
    expect(t.frontAxis).toEqual([0, 0, 1]);
    expect(t.regions).toEqual([]);
    expect(t.textSlots).toEqual([]);
    expect(t.regionIds).toBeUndefined();
    expect(t.preparedBy).toBe('auto');   // unknown provenance is never 'human'
  });

  it('clamps fitCm into the authored range instead of accepting a typo', () => {
    expect(normalizeTemplate({ ...goodTemplate(), fitCm: 100000 })!.fitCm).toBe(TEMPLATE_BOUNDS.fitCm.max);
    expect(normalizeTemplate({ ...goodTemplate(), fitCm: -3 })!.fitCm).toBe(TEMPLATE_BOUNDS.fitCm.min);
  });

  it('does NOT read Number(null)/Number([]) as a real 0 for fitCm', () => {
    // Both coerce to 0, which is finite; without an explicit absence check they
    // would clamp to 0.5cm and render the asset as a speck.
    expect(normalizeTemplate({ ...goodTemplate(), fitCm: null })!.fitCm).toBe(20);
    expect(normalizeTemplate({ ...goodTemplate(), fitCm: [] })!.fitCm).toBe(20);
    expect(normalizeTemplate({ ...goodTemplate(), fitCm: '' })!.fitCm).toBe(20);
    // A real 0 typed by an author still clamps to the minimum — it is data.
    expect(normalizeTemplate({ ...goodTemplate(), fitCm: 0 })!.fitCm).toBe(TEMPLATE_BOUNDS.fitCm.min);
  });

  it('drops malformed regions but keeps the good ones', () => {
    const raw = goodTemplate();
    raw.regions = [
      { id: 'crown' },
      null,
      'brim',
      { label: 'no id' },
      { id: '  ' },
      { id: 'button', refLuminance: 0.5 },
    ];
    const t = normalizeTemplate(raw)!;
    expect(t.regions.map((r) => r.id)).toEqual(['crown', 'button']);
    expect(t.regions[0].defaultHex).toBe('#ffffff');
    expect(t.regions[0].recolourable).toBe(true);
  });

  it('keeps the FIRST of two regions sharing an id — a duplicate would shadow a uniform slot', () => {
    const raw = goodTemplate();
    raw.regions = [
      { id: 'crown', label: 'First', refLuminance: 0.1 },
      { id: 'crown', label: 'Second', refLuminance: 0.9 },
    ];
    const t = normalizeTemplate(raw)!;
    expect(t.regions).toHaveLength(1);
    expect(t.regions[0].label).toBe('First');
  });

  it('caps regions at the GLSL array bound', () => {
    const raw = goodTemplate();
    raw.regions = Array.from({ length: MAX_REGIONS + 6 }, (_, i) => ({ id: `r${i}` }));
    expect(normalizeTemplate(raw)!.regions).toHaveLength(MAX_REGIONS);
  });

  it('locks a region only on an EXPLICIT false', () => {
    const raw = goodTemplate();
    raw.regions = [{ id: 'a' }, { id: 'b', recolourable: false }, { id: 'c', recolourable: 0 }];
    const t = normalizeTemplate(raw)!;
    expect(t.regions.map((r) => r.recolourable)).toEqual([true, false, true]);
  });
});

describe('normalizeTemplate — text slots', () => {
  it('DROPS a slot with no usable normal rather than guessing a direction', () => {
    const raw = goodTemplate();
    raw.textSlots = [
      { id: 'a', position: [0, 0, 1], normal: [0, 0, 0] },
      { id: 'b', position: [0, 0, 1], normal: 'forward' },
      { id: 'c', position: [0, 0, 1] },
      { id: 'd', normal: [0, 0, 1] },
      { id: 'ok', position: [0, 0, 1], normal: [0, 0, 2] },
    ];
    const t = normalizeTemplate(raw)!;
    expect(t.textSlots.map((s) => s.id)).toEqual(['ok']);
    expect(t.textSlots[0].normal).toEqual([0, 0, 1]);
  });

  it('always produces an up perpendicular to the normal', () => {
    const raw = goodTemplate();
    raw.textSlots = [{ id: 'top', position: [0, 1, 0], normal: [0, 1, 0], up: [0, 1, 0] }];
    const s = normalizeTemplate(raw)!.textSlots[0];
    expect(Math.abs(s.up[0] * s.normal[0] + s.up[1] * s.normal[1] + s.up[2] * s.normal[2])).toBeLessThan(1e-9);
  });

  it('drops a regionId that names no region — a stale id would mislead the projector', () => {
    const raw = goodTemplate();
    (raw.textSlots as Record<string, unknown>[])[0].regionId = 'ghost';
    expect(normalizeTemplate(raw)!.textSlots[0].regionId).toBeUndefined();
  });

  it('clamps decalDepth — the one number stopping the name bleeding onto the brim', () => {
    const raw = goodTemplate();
    const slots = raw.textSlots as Record<string, unknown>[];
    slots[0].decalDepth = -1;
    expect(normalizeTemplate(raw)!.textSlots[0].decalDepth).toBe(TEMPLATE_BOUNDS.decalDepth.min);
    slots[0].decalDepth = 1e9;
    expect(normalizeTemplate(raw)!.textSlots[0].decalDepth).toBe(TEMPLATE_BOUNDS.decalDepth.max);
    slots[0].decalDepth = undefined;
    expect(normalizeTemplate(raw)!.textSlots[0].decalDepth).toBe(0.5);
  });

  it('caps the number of slots and de-duplicates ids', () => {
    const raw = goodTemplate();
    raw.textSlots = Array.from({ length: 10 }, () => ({ id: 'same', position: [0, 0, 1], normal: [0, 0, 1] }));
    expect(normalizeTemplate(raw)!.textSlots).toHaveLength(1);
    raw.textSlots = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, position: [0, 0, 1], normal: [0, 0, 1] }));
    expect(normalizeTemplate(raw)!.textSlots).toHaveLength(TEMPLATE_BOUNDS.maxTextSlots);
  });
});

describe('isConfigurable', () => {
  it('is false for null and for an asset with nothing to change', () => {
    expect(isConfigurable(null)).toBe(false);
    const bare = normalizeTemplate({ id: 'a', glbUrl: 'b' })!;
    expect(isConfigurable(bare)).toBe(false);
  });

  it('is false when every region is locked and there is no slot', () => {
    const t = normalizeTemplate({ id: 'a', glbUrl: 'b', regions: [{ id: 'x', recolourable: false }] })!;
    expect(isConfigurable(t)).toBe(false);
  });

  it('is true with a recolourable region or a text slot', () => {
    expect(isConfigurable(normalizeTemplate(goodTemplate()))).toBe(true);
    const textOnly = normalizeTemplate({
      id: 'a', glbUrl: 'b',
      textSlots: [{ id: 's', position: [0, 0, 1], normal: [0, 0, 1] }],
    })!;
    expect(isConfigurable(textOnly)).toBe(true);
  });
});

describe('regionIdsSource', () => {
  it('decodes packed bytes', () => {
    const packed = packRegionIds([0, 1, 2, 1]);
    const src = regionIdsSource(packed)!;
    expect(src.kind).toBe('packed');
    expect(Array.from((src as { bytes: Uint8Array }).bytes)).toEqual([0, 1, 2, 1]);
  });

  it('recognises a sidecar URL — "/" is a legal base64 char, so this MUST be tested first', () => {
    expect(regionIdsSource('/models/cap.regions.bin')).toEqual({ kind: 'url', url: '/models/cap.regions.bin' });
    expect(regionIdsSource('https://cdn.example.com/r.bin')).toEqual({ kind: 'url', url: 'https://cdn.example.com/r.bin' });
  });

  it('returns null for junk rather than painting the model in stripes', () => {
    for (const bad of [null, undefined, '', '   ', 42, {}, [], 'not base64!!']) {
      expect(regionIdsSource(bad)).toBeNull();
    }
  });
});

describe('normalizeCustomization', () => {
  const template = normalizeTemplate(goodTemplate())!;

  it('returns null for absence — the legacy guarantee', () => {
    for (const bad of [null, undefined, {}, [], 'x', 0, { parts: {} }, { parts: {}, label: null }]) {
      expect(normalizeCustomization(bad, template)).toBeNull();
    }
  });

  it('keeps overrides that name real, unlocked regions', () => {
    const c = normalizeCustomization({ parts: { crown: { hex: '#ff0000' } } }, template)!;
    expect(c.parts).toEqual({ crown: { hex: '#ff0000' } });
  });

  it('DROPS an override naming a region the template does not have', () => {
    expect(normalizeCustomization({ parts: { ghost: { hex: '#ff0000' } } }, template)).toBeNull();
  });

  it('DROPS an override naming a LOCKED region — a licensed badge is not the host\'s to repaint', () => {
    expect(normalizeCustomization({ parts: { badge: { hex: '#ff0000' } } }, template)).toBeNull();
  });

  it('keeps the good parts of a mixed config', () => {
    const c = normalizeCustomization({
      parts: { crown: { hex: '#ff0000' }, badge: { hex: '#00ff00' }, ghost: { hex: '#0000ff' } },
    }, template)!;
    expect(Object.keys(c.parts!)).toEqual(['crown']);
  });

  it('DROPS a label whose slot does not exist', () => {
    const good = normalizeCustomization({
      label: { slotId: 'front', token: 'fixed', text: 'Amara', style: 'serif', hex: '#f4d58d' },
    }, template);
    expect(good?.label?.slotId).toBe('front');
    const stale = normalizeCustomization({
      label: { slotId: 'gone', token: 'fixed', text: 'Amara', style: 'serif', hex: '#f4d58d' },
    }, template);
    expect(stale).toBeNull();
  });

  it('validates shape only when no template is supplied', () => {
    const c = normalizeCustomization({ parts: { anything: { hex: '#ff0000' } } });
    expect(c?.parts).toBeTruthy();
  });

  it('never throws on hostile input', () => {
    const hostile = [
      { parts: { __proto__: { hex: '#ff0000' } } },
      { parts: [1, 2, 3] },
      { label: 'a string' },
      { label: { slotId: 'front' } },
      { parts: { crown: 'red' } },
    ];
    for (const h of hostile) {
      expect(() => normalizeCustomization(h, template)).not.toThrow();
    }
  });
});

describe('resolveLabelText — mirrors StageCanvas.drawGuestLettering', () => {
  const base = { slotId: 'front', style: 'serif', hex: '#ffffff' } as const;

  it('an EMPTY guest name draws nothing — the same rule the 2D booth follows', () => {
    expect(resolveLabelText({ ...base, token: 'guestName' }, '')).toBe('');
    expect(resolveLabelText({ ...base, token: 'guestName' }, '   ')).toBe('');
    expect(resolveLabelText({ ...base, token: 'guestName' }, '\n\t')).toBe('');
  });

  it('a fixed label with no text draws nothing', () => {
    expect(resolveLabelText({ ...base, token: 'fixed' }, 'Amara')).toBe('');
    expect(resolveLabelText({ ...base, token: 'fixed', text: '  ' }, 'Amara')).toBe('');
  });

  it('a fixed label IGNORES the guest name, and guestName ignores the fixed text', () => {
    expect(resolveLabelText({ ...base, token: 'fixed', text: 'Hope Gala' }, 'Amara')).toBe('Hope Gala');
    expect(resolveLabelText({ ...base, token: 'guestName', text: 'Hope Gala' }, 'Amara')).toBe('Amara');
  });

  it('upper-cases ONLY the tracked "label" style, exactly like the 2D path', () => {
    expect(resolveLabelText({ ...base, token: 'guestName', style: 'label' }, 'amara')).toBe('AMARA');
    expect(resolveLabelText({ ...base, token: 'guestName', style: 'script' }, 'amara')).toBe('amara');
    expect(resolveLabelText({ ...base, token: 'guestName', style: 'block' }, 'amara')).toBe('amara');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveLabelText({ ...base, token: 'guestName' }, '  Amara  ')).toBe('Amara');
  });

  it('hard-caps rather than ellipsising — an engraved "…" reads as a defect', () => {
    const long = 'A'.repeat(200);
    const out = resolveLabelText({ ...base, token: 'guestName' }, long);
    expect(out.length).toBe(ASSET_CUSTOMIZATION.maxLabelLength);
    expect(out).not.toContain('…');
  });

  it('returns "" for a missing label instead of throwing', () => {
    expect(resolveLabelText(null, 'Amara')).toBe('');
    expect(resolveLabelText(undefined, 'Amara')).toBe('');
  });
});

describe('LABEL_FONT_CSS', () => {
  it('covers every guest-lettering style the booth offers', () => {
    expect(Object.keys(LABEL_FONT_CSS).sort()).toEqual(['block', 'label', 'script', 'serif']);
  });

  it('names the families index.css actually loads', () => {
    expect(LABEL_FONT_CSS.script(48)).toContain('Pinyon Script');
    expect(LABEL_FONT_CSS.serif(48)).toContain('Cormorant Garamond');
    expect(LABEL_FONT_CSS.block(48)).toContain('Inter');
    expect(LABEL_FONT_CSS.label(48)).toContain('Jost');
  });

  it('interpolates the size it is given', () => {
    expect(LABEL_FONT_CSS.block(120)).toContain('120px');
  });
});

describe('configuratorKey', () => {
  const template = normalizeTemplate(goodTemplate())!;

  it('is empty when there is nothing to configure', () => {
    expect(configuratorKey(null, null)).toBe('');
    expect(configuratorKey(template, null)).toBe('');
    expect(configuratorKey(null, { parts: { crown: { hex: '#ff0000' } } })).toBe('');
  });

  it('is order-independent', () => {
    const a = configuratorKey(template, { parts: { crown: { hex: '#ff0000' }, brim: { hex: '#00ff00' } } });
    const b = configuratorKey(template, { parts: { brim: { hex: '#00ff00' }, crown: { hex: '#ff0000' } } });
    expect(a).toBe(b);
  });

  it('changes when a colour changes', () => {
    const a = configuratorKey(template, { parts: { crown: { hex: '#ff0000' } } });
    const b = configuratorKey(template, { parts: { crown: { hex: '#ff0001' } } });
    expect(a).not.toBe(b);
  });

  it('changes when the RESOLVED label text changes, so typing rebuilds the decal', () => {
    const label = { slotId: 'front', token: 'guestName', style: 'serif', hex: '#fff' } as const;
    const a = configuratorKey(template, { label }, 'Ama');
    const b = configuratorKey(template, { label }, 'Amara');
    expect(a).not.toBe(b);
  });

  it('does NOT change when the guest name changes under a FIXED label', () => {
    const label = { slotId: 'front', token: 'fixed', text: 'Hope Gala', style: 'serif', hex: '#fff' } as const;
    expect(configuratorKey(template, { label }, 'Ama')).toBe(configuratorKey(template, { label }, 'Zed'));
  });

  it('distinguishes two templates carrying the same customization', () => {
    const other = normalizeTemplate({ ...goodTemplate(), id: 'other-cap' })!;
    const c = { parts: { crown: { hex: '#ff0000' } } };
    expect(configuratorKey(template, c)).not.toBe(configuratorKey(other, c));
  });
});

describe('the legacy guarantee, end to end', () => {
  it('an asset with no template and no customization produces NO key and NO overrides', () => {
    expect(configuratorKey(undefined, undefined)).toBe('');
    expect(normalizeCustomization(undefined, null)).toBeNull();
    expect(isConfigurable(normalizeTemplate(undefined))).toBe(false);
  });

  it('a layer carrying an empty customization object is indistinguishable from one carrying none', () => {
    const t: AssetTemplate | null = normalizeTemplate(goodTemplate());
    expect(normalizeCustomization({}, t)).toBe(normalizeCustomization(undefined, t));
  });
});
