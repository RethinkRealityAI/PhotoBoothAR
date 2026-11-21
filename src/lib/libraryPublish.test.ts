/**
 * The library publish engine, run against BOTH copies: src/lib/libraryPublish.ts
 * (the browser's) and supabase/functions/admin-api/library.ts (the hand mirror
 * the edge function actually executes). A one-sided change fails here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as client from './libraryPublish';
import * as edge from '../../supabase/functions/admin-api/library.ts';

const FN_DIR = resolve(__dirname, '../../supabase/functions');
const ORIGIN = 'https://zrtftliozslrjomxbfrr.supabase.co';
const PUB = `${ORIGIN}/storage/v1/object/public/assets`;
const SRC_ID = '0b4f6a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
const NEW_ID = '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b';

type Engine = typeof edge;
const ENGINES: Array<[string, Engine]> = [['src', client], ['edge', edge]];

describe('mirror pins', () => {
  it('vocabularies and constants are identical in both copies', () => {
    expect(edge.LIBRARY_OCCASIONS).toEqual(client.LIBRARY_OCCASIONS);
    expect(edge.LIBRARY_COLORS).toEqual(client.LIBRARY_COLORS);
    expect(edge.LIBRARY_STYLES).toEqual(client.LIBRARY_STYLES);
    expect(edge.LIBRARY_PREFIX).toBe(client.LIBRARY_PREFIX);
    expect(edge.LIBRARY_NAME_MAX).toBe(client.LIBRARY_NAME_MAX);
    expect(edge.LIBRARY_STATES).toEqual(client.LIBRARY_STATES);
  });

  it('occasions are exactly the event types create-event accepts', () => {
    const src = readFileSync(resolve(FN_DIR, 'create-event/index.ts'), 'utf8');
    const m = src.match(/const EVENT_TYPES = new Set\(\[([^\]]*)\]\)/);
    expect(m, 'EVENT_TYPES literal not found in create-event').not.toBeNull();
    const types = [...m![1].matchAll(/'([a-z_-]+)'/g)].map((x) => x[1]);
    expect([...client.LIBRARY_OCCASIONS].sort()).toEqual(types.sort());
  });

  it('styles are the six the product named', () => {
    expect(client.LIBRARY_STYLES).toEqual(['elegant', 'playful', 'neon', 'minimal', 'retro', 'floral']);
  });

  it('admin-api imports the mirror and declares every regex it uses', () => {
    const src = readFileSync(resolve(FN_DIR, 'admin-api/index.ts'), 'utf8');
    expect(src).toMatch(/from '\.\/library\.ts'/);
    expect(src).toMatch(/const UUID_RE = /);
  });

  it('the mirror stays Deno-free (it is imported by vitest and tsc)', () => {
    const src = readFileSync(resolve(FN_DIR, 'admin-api/library.ts'), 'utf8');
    expect(src).not.toMatch(/\bDeno\./);
    expect(src).not.toMatch(/from '(jsr|npm):/);
    expect(src).not.toMatch(/^import /m);
  });
});

describe.each(ENGINES)('%s engine', (_label, L) => {
  describe('tags', () => {
    it('normalises case/space, de-dupes, orders by vocabulary', () => {
      const { tags, invalid } = L.normalizeLibraryTags({
        occasions: [' Wedding', 'gala', 'wedding'],
        colors: ['GOLD', 'blue'],
        styles: ['neon', 'elegant'],
      });
      expect(invalid).toEqual([]);
      expect(tags).toEqual({ occasions: ['wedding', 'gala'], colors: ['gold', 'blue'], styles: ['elegant', 'neon'] });
    });

    it('reports out-of-vocabulary values instead of dropping them silently', () => {
      const { tags, invalid } = L.normalizeLibraryTags({ occasions: ['bar-mitzvah'], colors: [7], styles: ['neon'] });
      expect(invalid).toEqual(['occasions:bar-mitzvah', 'colors:7']);
      expect(tags.styles).toEqual(['neon']);
    });

    it('treats missing / malformed groups as empty, never throws', () => {
      for (const raw of [undefined, null, 'x', [], { occasions: 'wedding' }]) {
        expect(L.normalizeLibraryTags(raw)).toEqual({ tags: L.emptyLibraryTags(), invalid: [] });
      }
    });

    it('ignores empty strings', () => {
      expect(L.normalizeLibraryTags({ styles: ['', '  '] }).invalid).toEqual([]);
    });
  });

  describe('name', () => {
    it('trims and collapses whitespace', () => {
      expect(L.normalizeLibraryName('  Gold   leaf  frame ')).toBe('Gold leaf frame');
    });
    it('rejects empty, non-string and over-long', () => {
      expect(L.normalizeLibraryName('   ')).toBeNull();
      expect(L.normalizeLibraryName(42)).toBeNull();
      expect(L.normalizeLibraryName('x'.repeat(L.LIBRARY_NAME_MAX))).toHaveLength(L.LIBRARY_NAME_MAX);
      expect(L.normalizeLibraryName('x'.repeat(L.LIBRARY_NAME_MAX + 1))).toBeNull();
    });
  });

  describe('uuid', () => {
    it('accepts a uuid, rejects near-misses and the empty string', () => {
      expect(L.isUuid(SRC_ID)).toBe(true);
      expect(L.isUuid(SRC_ID.toUpperCase())).toBe(true);
      expect(L.isUuid(`${SRC_ID}x`)).toBe(false);
      expect(L.isUuid(SRC_ID.slice(1))).toBe(false);
      expect(L.isUuid('')).toBe(false);
      expect(L.isUuid(null)).toBe(false);
    });
  });

  describe('state machine', () => {
    const row = (is_published: boolean, listed?: boolean) => ({
      is_published,
      config: listed === undefined ? {} : { library: { listed } },
    });

    it('reads listed / retired / withdrawn', () => {
      expect(L.libraryStateOf(row(true))).toBe('listed'); // no meta = listed (listed !== false)
      expect(L.libraryStateOf(row(true, true))).toBe('listed');
      expect(L.libraryStateOf(row(true, false))).toBe('retired');
      expect(L.libraryStateOf(row(false, true))).toBe('withdrawn');
      expect(L.libraryStateOf(row(false, false))).toBe('withdrawn');
    });

    it('maps each target to its row patch', () => {
      expect(L.planStateChange('listed', 'retired', 3)).toEqual({ ok: true, action: 'update', isPublished: true, listed: false });
      expect(L.planStateChange('listed', 'withdrawn', 3)).toEqual({ ok: true, action: 'update', isPublished: false, listed: false });
      expect(L.planStateChange('retired', 'listed', 3)).toEqual({ ok: true, action: 'update', isPublished: true, listed: true });
      expect(L.planStateChange('withdrawn', 'listed', 0)).toEqual({ ok: true, action: 'update', isPublished: true, listed: true });
      expect(L.planStateChange('withdrawn', 'retired', 0)).toEqual({ ok: true, action: 'update', isPublished: true, listed: false });
    });

    it('refuses no-ops and unknown targets', () => {
      expect(L.planStateChange('listed', 'listed', 0)).toEqual({ ok: false, reason: 'same_state' });
      expect(L.planStateChange('listed', 'archived', 0)).toEqual({ ok: false, reason: 'invalid_state' });
      expect(L.planStateChange('listed', undefined, 0)).toEqual({ ok: false, reason: 'invalid_state' });
    });

    it('hard delete only when unlisted AND zero links', () => {
      expect(L.planStateChange('listed', 'deleted', 0)).toEqual({ ok: false, reason: 'unlist_first' });
      expect(L.planStateChange('retired', 'deleted', 1)).toEqual({ ok: false, reason: 'has_links' });
      expect(L.planStateChange('withdrawn', 'deleted', Number.NaN)).toEqual({ ok: false, reason: 'has_links' });
      expect(L.planStateChange('retired', 'deleted', 0)).toEqual({ ok: true, action: 'delete' });
      expect(L.planStateChange('withdrawn', 'deleted', 0)).toEqual({ ok: true, action: 'delete' });
    });
  });

  describe('meta + versions', () => {
    it('reads config.library totally', () => {
      expect(L.readLibraryMeta(null)).toBeNull();
      expect(L.readLibraryMeta({ library: 'x' })).toBeNull();
      expect(L.readLibraryMeta({ library: { version: 0, tags: { styles: ['neon', 'bogus'] } } })).toEqual({
        version: 1, sourceExperienceId: '', publishedAt: '', publishedBy: '', listed: true,
        tags: { occasions: [], colors: [], styles: ['neon'] },
      });
    });
    it('patchLibraryMeta changes only the library block, never mutates', () => {
      const cfg = { layers: [{ url: 'u' }], library: { version: 2, listed: true } };
      const out = L.patchLibraryMeta(cfg, { listed: false });
      expect(out).toEqual({ layers: [{ url: 'u' }], library: { version: 2, listed: false } });
      expect(out.layers).toBe(cfg.layers);
      expect(cfg.library.listed).toBe(true);
      expect(L.patchLibraryMeta(null, { listed: true })).toEqual({ library: { listed: true } });
    });
    it('next version is one past the max, 1 when there is none', () => {
      expect(L.nextLibraryVersion([])).toBe(1);
      expect(L.nextLibraryVersion([{ library: { version: 1 } }, { library: { version: 3 } }, null])).toBe(4);
    });
  });

  describe('lineage', () => {
    const LINE = '5d1c2b3a-4f5e-4a6b-8c7d-9e0f1a2b3c4d';
    it('readLibraryMeta keeps a uuid lineageId and drops anything else (it goes into a filter)', () => {
      expect(L.readLibraryMeta({ library: { lineageId: LINE } })?.lineageId).toBe(LINE);
      for (const bad of ['', 'x', `${LINE},id.neq.0`, 7, null]) {
        const meta = L.readLibraryMeta({ library: { lineageId: bad } });
        expect(meta).not.toBeNull();
        expect('lineageId' in (meta as object)).toBe(false);
      }
    });
    it('lineageOf: explicit lineage, then the source scene, then the row itself', () => {
      expect(L.lineageOf({ id: NEW_ID, config: { library: { lineageId: LINE, sourceExperienceId: SRC_ID } } })).toBe(LINE);
      // A row published before lineage existed: its chain is the scene it came from.
      expect(L.lineageOf({ id: NEW_ID, config: { library: { sourceExperienceId: SRC_ID } } })).toBe(SRC_ID);
      // A bulk import (sourceExperienceId '') is the root of its own chain.
      expect(L.lineageOf({ id: NEW_ID, config: { library: { sourceExperienceId: '' } } })).toBe(NEW_ID);
      expect(L.lineageOf({ id: NEW_ID, config: { library: { lineageId: 'junk', sourceExperienceId: 'junk' } } })).toBe(NEW_ID);
      expect(L.lineageOf({ id: NEW_ID, config: null })).toBe(NEW_ID);
    });
    it('every version of a chain resolves to one lineage, so a version count spans them all', () => {
      // v1 published the classic way from SRC_ID; v2 and v3 from workshop copies.
      const v1 = { id: NEW_ID, config: { library: { version: 1, sourceExperienceId: SRC_ID } } };
      const v2 = { id: 'a', config: { library: { version: 2, sourceExperienceId: LINE, lineageId: SRC_ID } } };
      const v3 = { id: 'b', config: { library: { version: 3, sourceExperienceId: NEW_ID, lineageId: SRC_ID } } };
      expect(new Set([v1, v2, v3].map(L.lineageOf))).toEqual(new Set([SRC_ID]));
      expect(L.nextLibraryVersion([v1, v2, v3].map((r) => r.config))).toBe(4);
    });
    it('buildLibraryRow stamps the lineage when given and writes no key when not', () => {
      const base = {
        newId: NEW_ID, name: 'Crown', tags: L.emptyLibraryTags(), listed: true, version: 3,
        sourceExperienceId: SRC_ID, publishedBy: 'u', publishedAt: 't', origin: ORIGIN, mapping: new Map<string, string>(),
      };
      const src = { kind: 'shader', asset_url: null, thumbnail_url: null, config: { library: { lineageId: 'stale' } } };
      const withLine = L.buildLibraryRow(src, { ...base, lineageId: LINE }).config as { library: Record<string, unknown> };
      expect(withLine.library.lineageId).toBe(LINE);
      expect(withLine.library.sourceExperienceId).toBe(SRC_ID);
      const without = L.buildLibraryRow(src, base).config as { library: Record<string, unknown> };
      // The source's own (stale) library block never leaks through.
      expect('lineageId' in without.library).toBe(false);
    });
  });

  describe('thumbnail requirement', () => {
    it('3D, composite and layered items need one; flat 2D does not', () => {
      expect(L.needsThumbnail({ kind: '3d_attachment', config: {} })).toBe(true);
      expect(L.needsThumbnail({ kind: 'composite', config: {} })).toBe(true);
      expect(L.needsThumbnail({ kind: 'border', config: { layers: [{}] } })).toBe(true);
      expect(L.needsThumbnail({ kind: 'border', config: { layers: [] } })).toBe(false);
      expect(L.needsThumbnail({ kind: '2d_filter', config: {} })).toBe(false);
      expect(L.needsThumbnail({ kind: 'shader', config: null })).toBe(false);
    });
  });

  describe('stripLibraryMeta', () => {
    it('drops only the library block and never mutates', () => {
      const cfg = { opacity: 0.5, library: { version: 2 } };
      const out = L.stripLibraryMeta(cfg);
      expect(out).toEqual({ opacity: 0.5 });
      expect(cfg.library).toEqual({ version: 2 });
    });
    it('returns non-objects and library-free configs as-is', () => {
      const cfg = { opacity: 1 };
      expect(L.stripLibraryMeta(cfg)).toBe(cfg);
      expect(L.stripLibraryMeta(null)).toBeNull();
    });
  });

  describe('media', () => {
    const row = {
      asset_url: `${PUB}/gala-21/uploads/abc-crown.glb?t=1`,
      thumbnail_url: `${PUB}/gala-21/icon-crown.png`,
      config: {
        layers: [
          { url: `${PUB}/gala-21/uploads/abc-crown.glb` }, // same key as asset_url (query dropped)
          { url: `${PUB}/other-ev/x/icon-crown.png` },     // basename collides with the thumbnail
          { url: 'data:image/png;base64,AAAA' },
          { url: 'https://evil.example/storage/v1/object/public/assets/a/b.png' },
          { url: `${ORIGIN}/storage/v1/object/public/posts/gala-21/p.jpg` },
          { url: `${PUB}/a/../../secret.png` },
        ],
        procedural: 'royal-crown',
        library: { thumb: `${PUB}/never/copied.png` },
      },
    };

    it('collects distinct assets keys, skipping foreign origins, other buckets, traversal and config.library', () => {
      expect(L.collectAssetKeys(row, ORIGIN)).toEqual([
        'gala-21/uploads/abc-crown.glb',
        'gala-21/icon-crown.png',
        'other-ev/x/icon-crown.png',
      ]);
    });

    it('plans copies into the new item folder, disambiguating basenames', () => {
      const plan = L.planLibraryCopies(L.collectAssetKeys(row, ORIGIN), NEW_ID);
      expect(plan).toEqual([
        { from: 'gala-21/uploads/abc-crown.glb', to: `_platform/library/${NEW_ID}/abc-crown.glb` },
        { from: 'gala-21/icon-crown.png', to: `_platform/library/${NEW_ID}/icon-crown.png` },
        { from: 'other-ev/x/icon-crown.png', to: `_platform/library/${NEW_ID}/2-icon-crown.png` },
      ]);
    });

    it('sanitises odd basenames', () => {
      expect(L.planLibraryCopies(['ev/sp ace&.png', 'ev/...hidden', 'ev/'], NEW_ID).map((p) => p.to)).toEqual([
        `_platform/library/${NEW_ID}/sp_ace_.png`,
        `_platform/library/${NEW_ID}/hidden`,
        `_platform/library/${NEW_ID}/file`,
      ]);
    });

    it('builds the global row with every copied URL rewritten and tenancy forced global', () => {
      const keys = L.collectAssetKeys(row, ORIGIN);
      const mapping = new Map(L.planLibraryCopies(keys, NEW_ID).map((p) => [p.from, p.to] as [string, string]));
      const built = L.buildLibraryRow(
        { ...row, kind: '3d_attachment', source: 'ai_meshy', featured: true },
        {
          newId: NEW_ID, name: 'Royal crown', tags: { occasions: ['gala'], colors: ['gold'], styles: ['elegant'] },
          listed: true, version: 2, sourceExperienceId: SRC_ID, publishedBy: 'admin-uid',
          publishedAt: '2026-11-16T00:00:00.000Z', origin: ORIGIN, mapping,
        },
      );
      const lib = `${PUB}/_platform/library/${NEW_ID}`;
      expect(built).toMatchObject({
        id: NEW_ID, name: 'Royal crown', kind: '3d_attachment', source: 'ai_meshy',
        is_global: true, event_id: null, org_id: null, is_published: true, featured: false,
        asset_url: `${lib}/abc-crown.glb`,
        thumbnail_url: `${lib}/icon-crown.png`,
      });
      const cfg = built.config as { layers: Array<{ url: string }>; procedural: string; library: unknown };
      expect(cfg.layers.map((l) => l.url)).toEqual([
        `${lib}/abc-crown.glb`,
        `${lib}/2-icon-crown.png`,
        'data:image/png;base64,AAAA',
        'https://evil.example/storage/v1/object/public/assets/a/b.png',
        `${ORIGIN}/storage/v1/object/public/posts/gala-21/p.jpg`,
        `${PUB}/a/../../secret.png`,
      ]);
      expect(cfg.procedural).toBe('royal-crown');
      // The source's own library block is replaced, never carried over.
      expect(cfg.library).toEqual({
        version: 2, sourceExperienceId: SRC_ID, publishedAt: '2026-11-16T00:00:00.000Z',
        publishedBy: 'admin-uid', listed: true, tags: { occasions: ['gala'], colors: ['gold'], styles: ['elegant'] },
      });
      // The input row is untouched.
      expect(row.config.layers[0].url).toBe(`${PUB}/gala-21/uploads/abc-crown.glb`);
    });

    it('handles a row with no media at all', () => {
      expect(L.collectAssetKeys({ asset_url: null, thumbnail_url: null, config: null }, ORIGIN)).toEqual([]);
      const built = L.buildLibraryRow(
        { kind: 'shader', asset_url: null, thumbnail_url: null, config: null },
        {
          newId: NEW_ID, name: 'Glow', tags: L.emptyLibraryTags(), listed: false, version: 1,
          sourceExperienceId: SRC_ID, publishedBy: 'u', publishedAt: 't', origin: ORIGIN, mapping: new Map(),
        },
      );
      expect(built.asset_url).toBeNull();
      expect(built.source).toBe('upload');
      expect((built.config as { library: { listed: boolean } }).library.listed).toBe(false);
    });
  });
});

describe('client-only copy', () => {
  it('every state target has a plain-words consequence and a label', () => {
    for (const t of [...client.LIBRARY_STATES, 'deleted'] as const) {
      expect(client.STATE_CONSEQUENCE[t].length).toBeGreaterThan(10);
      expect(client.STATE_ACTION_LABEL[t].length).toBeGreaterThan(2);
    }
  });
});
