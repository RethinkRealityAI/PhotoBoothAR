import { describe, expect, it } from 'vitest';
import type { Experience, Post } from '../types';
import {
  draftTone,
  recentWallPhotos,
  rgbTriplet,
  sceneEquals,
  sceneFrameChoices,
  sceneSummary,
  sceneToSave,
  sceneUploadError,
  SCENE_UPLOAD_MAX_BYTES,
} from './scenePage';

const PUBLIC = 'https://x.supabase.co/storage/v1/object/public/assets/sam/uploads/a.png';

function exp(p: Partial<Experience>): Experience {
  return {
    id: 'e1', name: 'Frame', created_at: '', updated_at: '', is_published: true, featured: false,
    sort_order: 0, thumbnail_url: null, kind: 'border', asset_url: PUBLIC, config: {},
    ...p,
  } as Experience;
}

function post(p: Partial<Post>): Post {
  return {
    id: 'p', created_at: '2026-11-19T10:00:00Z', image_url: 'https://x/a.jpg', media_type: 'image',
    duration_ms: null, message: null, guest_name: null, experience_id: null, challenge_id: null,
    session_id: null, approved: true, hidden: false, width: null, height: null,
    ...p,
  };
}

describe('rgbTriplet', () => {
  it('splits a hex', () => expect(rgbTriplet('#D4D6FF')).toBe('212, 214, 255'));
  it('refuses non-hex', () => {
    expect(rgbTriplet('red')).toBeNull();
    expect(rgbTriplet('#fff')).toBeNull();
  });
});

describe('sceneUploadError', () => {
  it('accepts a normal photo', () => expect(sceneUploadError({ type: 'image/jpeg', size: 2_000_000 })).toBeNull());
  it('accepts exactly 10 MB', () => expect(sceneUploadError({ type: 'image/webp', size: SCENE_UPLOAD_MAX_BYTES })).toBeNull());
  it('refuses over 10 MB', () => expect(sceneUploadError({ type: 'image/png', size: SCENE_UPLOAD_MAX_BYTES + 1 })).toMatch(/10 MB/));
  it('refuses svg, gif and non-images', () => {
    expect(sceneUploadError({ type: 'image/svg+xml', size: 10 })).toMatch(/JPG/);
    expect(sceneUploadError({ type: 'image/gif', size: 10 })).toMatch(/JPG/);
    expect(sceneUploadError({ type: 'application/pdf', size: 10 })).toMatch(/JPG/);
  });
  it('refuses an empty file (size 0 is data, not "missing")', () => {
    expect(sceneUploadError({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});

describe('sceneFrameChoices', () => {
  it('keeps published border frames with stored art', () => {
    expect(sceneFrameChoices([exp({ id: 'a', name: 'Gold' })])).toEqual([{ id: 'a', name: 'Gold', url: PUBLIC }]);
  });
  it('drops built-in data: frames, other kinds, unpublished and duplicates', () => {
    const out = sceneFrameChoices([
      exp({ id: 'b', asset_url: 'data:image/svg+xml,<svg/>' }),
      exp({ id: 'c', kind: 'shader' }),
      exp({ id: 'd', is_published: false }),
      exp({ id: 'e' }),
      exp({ id: 'f' }),
      exp({ id: 'g', asset_url: null }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['e']);
  });
  it('accepts a bundled root-relative frame and names a blank one', () => {
    expect(sceneFrameChoices([exp({ asset_url: '/starters/gold-classic.webp', name: ' ' })])).toEqual([
      { id: 'e1', name: 'Frame', url: '/starters/gold-classic.webp' },
    ]);
  });
});

describe('sceneEquals / sceneToSave / sceneSummary', () => {
  it('compares structurally and treats undefined as the default', () => {
    expect(sceneEquals(undefined, undefined)).toBe(true);
    expect(sceneEquals({ kind: 'template', id: 'beamwall' }, undefined)).toBe(false);
    expect(sceneEquals({ kind: 'color', color: '#112233' }, { kind: 'color', color: '#112233' })).toBe(true);
    expect(sceneEquals({ kind: 'color', color: '#112233' }, { kind: 'color', color: '#112234' })).toBe(false);
  });
  it('never saves a half-valid draft', () => {
    expect(sceneToSave({ kind: 'image', url: 'javascript:alert(1)', dim: 0.3, tone: 'dark' })).toBeNull();
    expect(sceneToSave(undefined)).toBeNull();
    expect(sceneToSave({ kind: 'image', url: PUBLIC, dim: 0, tone: 'light' })).toEqual({ kind: 'image', url: PUBLIC, dim: 0, tone: 'light' });
  });
  it('summarises each kind', () => {
    expect(sceneSummary(undefined)).toMatch(/default/);
    expect(sceneSummary({ kind: 'template', id: 'pearl-studio' })).toBe('Pearl template');
    expect(sceneSummary({ kind: 'gradient', paletteId: 'mist' })).toBe('Mist gradient');
    expect(sceneSummary({ kind: 'color', color: '#abcdef' })).toBe('Solid colour #ABCDEF');
    expect(sceneSummary({ kind: 'image', url: PUBLIC, dim: 0.3, tone: 'dark' })).toMatch(/photo/);
    expect(sceneSummary({ kind: 'frame', url: PUBLIC, paletteId: 'dusk' })).toMatch(/frame/);
  });
});

describe('draftTone', () => {
  it('follows the palette, the photo choice and the colour', () => {
    expect(draftTone({ kind: 'template', id: 'pearl-studio' })).toBe('light');
    expect(draftTone({ kind: 'template', id: 'beamwall' })).toBe('dark');
    expect(draftTone({ kind: 'gradient', paletteId: 'sage' })).toBe('light');
    expect(draftTone({ kind: 'frame', url: PUBLIC, paletteId: 'midnight' })).toBe('dark');
    expect(draftTone({ kind: 'image', url: PUBLIC, dim: 0, tone: 'light' })).toBe('light');
    expect(draftTone({ kind: 'color', color: '#FFFFFF' })).toBe('light');
    expect(draftTone({ kind: 'color', color: '#000000' })).toBe('dark');
    expect(draftTone(undefined, 'light')).toBe('light');
  });
});

describe('recentWallPhotos', () => {
  it('keeps visible images, newest first, capped', () => {
    const out = recentWallPhotos([
      post({ id: 'old', created_at: '2026-11-19T09:00:00Z' }),
      post({ id: 'new', created_at: '2026-11-19T11:00:00Z' }),
      post({ id: 'vid', media_type: 'video' }),
      post({ id: 'hid', hidden: true }),
      post({ id: 'unapproved', approved: false }),
      post({ id: 'mid', created_at: '2026-11-19T10:00:00Z' }),
    ], 2);
    expect(out.map((p) => p.id)).toEqual(['new', 'mid']);
  });
  it('returns nothing for a zero limit', () => expect(recentWallPhotos([post({})], 0)).toEqual([]));
  it('does not mutate the store array', () => {
    const list = [post({ id: 'a', created_at: '1' }), post({ id: 'b', created_at: '2' })];
    recentWallPhotos(list, 5);
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
